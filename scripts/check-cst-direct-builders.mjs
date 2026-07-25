#!/usr/bin/env node
/**
 * Build guard: no module reachable from a CST grammar may contain a DIRECT BUILDER.
 *
 * A parseman `node()` comes in two shapes:
 *
 *   node(combinator)                  STRUCTURAL — the `ctx.build` host builds it
 *   node(combinator, children => …)   DIRECT     — the callback builds it
 *
 * The CST grammars (`packages/*​/src/grammar.ts`) must be all-structural, because
 * `cssCstBuildHost` is what turns a node into a positioned `{_tag:'node', span, …}`.
 * A direct builder returns its OWN object instead, `isCssCstChild` in
 * `packages/css-parser/src/cst.ts` filters that object out of `children`, and the
 * node simply DISAPPEARS from the tree — `ok: true`, no error, no warning.
 *
 * Reproduced on this branch (2026-07-25): giving the css CST's `Declaration` rule a
 * `_children => ({…})` builder made `parseCssCst('.a{color:red}')` return a Ruleset
 * with no Declaration child and `ok: true` — on the pinned 0.32.0 whenever the host
 * does not set `_parsemanCstOutput`, and on 0.40.0+ even when it does.
 *
 * WHY THIS SCRIPT AND NOT PARSEMAN'S OWN GUARD. parseman 0.40.0 added
 * `assertHostModeCompatible`, which throws when an artifact that elided a direct
 * builder's CST branch is driven with a `_parsemanCstOutput` host. It cannot see this
 * case, for two independent reasons:
 *
 *   1. `parseCst` drives the grammar through `run()`, and the assertion is only
 *      reached from `parseDoc` and from a `compile()`d parser's `parseWithContext`.
 *   2. The assertion reads `Symbol.for('parseman.fusedHostElided')` off the rule map.
 *      `fuseRules` (the RUNTIME fuse) stamps it; `emitFusedSource` (the MACRO fuse,
 *      which is how all four grammars are actually built) does not. It therefore
 *      reads `undefined` → `false` → "no direct builder elided" → passes.
 *
 * Both were verified against the built artifacts, with the flag set and a direct
 * builder present. See `docs/architecture/parser/CST-DIRECT-BUILDER-GATE.md`.
 *
 * This matters most at the eight-grammars-to-four collapse, when the AST grammars —
 * which have direct builders by design — start serving both consumers. This gate is
 * what makes that land as a loud failure rather than as missing nodes.
 *
 * Run: `pnpm check:cst-direct-builders`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/*
 * The workspace pins the compiler API package separately from the experimental
 * `typescript` package, whose package export intentionally has no CommonJS main.
 * Same import as `verify-maybe-promise-truthiness.mjs`.
 */
const ts = require('@typescript/typescript6/lib/typescript.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The CST grammar entry points. Everything else in the checked set is DISCOVERED by
 * following their imports, so a newly composed input joins the gate automatically —
 * `scss-parser` already pulls in `internal-css-recognition`'s recognition map this
 * way, and that map is shared with the AST grammars, which is precisely where a
 * direct builder would arrive from.
 */
const CST_GRAMMAR_ENTRIES = [
  'packages/css-parser/src/grammar.ts',
  'packages/less-parser/src/grammar.ts',
  'packages/scss-parser/src/grammar.ts',
  'packages/jess-parser/src/grammar.ts'
];

/**
 * Resolve a workspace specifier (`@jesscss/css-parser/grammar`) to the SOURCE file
 * behind it, by reading the target package's `exports` map and mapping the built
 * entry back to `src/*.ts`. Reading `exports` rather than guessing keeps this honest
 * when a package renames or re-points a subpath.
 *
 * Returns null for anything that isn't a workspace package (`parseman`, node
 * builtins) — those are not ours to gate.
 */
function resolveWorkspaceSource(specifier) {
  const match = /^@jesscss\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  if (!match) {
    return null;
  }
  const [, pkgName, subpath] = match;
  const pkgJsonPath = resolve(root, 'packages', pkgName, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  const exportsMap = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).exports ?? {};
  const entry = exportsMap[subpath === undefined ? '.' : `./${subpath}`];
  const built = typeof entry === 'string' ? entry : entry?.import;
  if (typeof built !== 'string') {
    throw new Error(
      `check-cst-direct-builders: "${specifier}" has no resolvable \`import\` entry in `
      + `packages/${pkgName}/package.json — the gate cannot follow it, so it cannot `
      + 'vouch for it. Add the entry, or the export map has drifted.'
    );
  }
  const source = resolve(root, 'packages', pkgName, built.replace(/^\.\/lib\//, 'src/').replace(/\.js$/, '.ts'));
  if (!existsSync(source)) {
    throw new Error(
      `check-cst-direct-builders: "${specifier}" resolves to ${relative(root, source)}, `
      + 'which does not exist. The lib/→src/ mapping this gate relies on has drifted.'
    );
  }
  return source;
}

/** Every source module reachable from the CST grammar entries, entries included. */
function reachableModules() {
  const seen = new Set();
  const queue = CST_GRAMMAR_ENTRIES.map(p => resolve(root, p));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      /* Type-only imports contribute no combinators. */
      if (statement.importClause?.isTypeOnly) {
        continue;
      }
      const next = resolveWorkspaceSource(statement.moduleSpecifier.text);
      if (next !== null) {
        queue.push(next);
      }
    }
  }
  return [...seen].sort();
}

/**
 * The `build` argument's position depends on the overload:
 *
 *   node(combinator, build?, opts?)
 *   node('Type', combinator, build?, opts?)   ← discriminated by a string first arg
 *
 * A present `build` slot is a violation unless it is one of two things:
 *
 *   - an OBJECT LITERAL — the `opts` argument sitting in that position under the
 *     shorter overload;
 *   - a literal `undefined` / `void 0` — the explicit placeholder used to skip the
 *     build slot and reach `opts` on the longer one. The four CST grammars use this
 *     22 times (`node('Operation', …, undefined, { collapse: true })`).
 *
 * Anything else — arrow, function expression, or an identifier we cannot see through
 * — is reported. That is deliberately strict: the CST grammars have ZERO of these, so
 * there is no false positive to trade against, and "I cannot prove this is options"
 * must fail loud in a gate whose whole purpose is that the failure mode is silent.
 */
function isAbsentBuildSlot(n) {
  if (ts.isObjectLiteralExpression(n)) {
    return true;
  }
  if (ts.isIdentifier(n) && n.text === 'undefined') {
    return true;
  }
  return ts.isVoidExpression(n);
}

export function findDirectBuilders(fileName, sourceText) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'node') {
      const typed = n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0]);
      const slot = n.arguments[typed ? 2 : 1];
      if (slot !== undefined && !isAbsentBuildSlot(slot)) {
        const { line } = sf.getLineAndCharacterOfPosition(slot.getStart(sf));
        found.push({ line: line + 1, text: slot.getText(sf).replace(/\s+/g, ' ').slice(0, 60) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function main() {
  const modules = reachableModules();
  let violations = 0;

  for (const file of modules) {
    const found = findDirectBuilders(file, readFileSync(file, 'utf8'));
    const name = relative(root, file);
    if (found.length === 0) {
      console.log(`✓ ${name}: all-structural`);
      continue;
    }
    violations += found.length;
    console.log(`✗ ${name}: ${found.length} direct builder(s)`);
    for (const f of found) {
      console.log(`    ${name}:${f.line}  node(…, ${f.text})`);
    }
  }

  console.log();
  if (violations === 0) {
    console.log(`All ${modules.length} modules reachable from a CST grammar are all-structural.`);
    return 0;
  }
  console.error(
    `check-cst-direct-builders: ${violations} direct builder(s) reachable from a CST grammar.\n`
    + '\n'
    + 'A direct builder returns its own object where the positioned-CST host should have\n'
    + 'built a node. `isCssCstChild` then drops that object and the node vanishes from the\n'
    + 'tree with ok: true and no error — nothing downstream can detect it.\n'
    + '\n'
    + 'Fix: make the node STRUCTURAL — `node(combinator)`, no build callback — and let\n'
    + '`cssCstBuildHost` build it. If this grammar genuinely has to serve BOTH the eval-AST\n'
    + 'and the positioned-CST consumer, that needs two compilations of it\n'
    + '(parseman `hostMode: \'cst\'`), which the macro plugin does not yet support.'
  );
  return 1;
}

/* Importable by `scripts/__tests__/check-cst-direct-builders.test.mjs`; the gate
 * itself runs only when this file is the entry point. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
