#!/usr/bin/env node
/**
 * Rejects a TRUTHINESS test on a value that might be a promise.
 *
 * `MaybePromise<T>` is how this engine keeps a synchronous path synchronous: a
 * value is returned unwrapped when it is already settled, and only an actually-
 * awaitable value becomes a promise. The cost of that design is a failure mode
 * neither the compiler nor `no-unnecessary-condition` can see:
 *
 *     function ruleGuardPasses(...): MaybePromise<boolean>   // was: boolean
 *     ...
 *     if (!ruleGuardPasses(rule, frame, e)) { return; }      // ALWAYS FALSE
 *
 * The condition still typechecks — `Promise<boolean> | boolean` is a legal
 * operand — and it is not a *constant* condition, because the `boolean` arm can
 * genuinely be false. So `no-unnecessary-condition` stays silent too. But when
 * the promise arm is taken, an object is always truthy, and the guard silently
 * inverts. The result is not a crash: it is WRONG CSS, emitted confidently.
 *
 * That hazard appears every time a signature is widened to `MaybePromise`, so it
 * is checked mechanically rather than by review. Widening a return type now
 * fails this command until every truthiness test on it is replaced by an
 * explicit `isThenable` fork (usually `mapMaybe`).
 *
 * A value whose type is ONLY a promise is reported too: `if (somePromise)` is
 * unconditionally true, which is the same bug with the union collapsed.
 *
 * Deliberately NOT flagged, because none of them is a truthiness test:
 *   - `isThenable(x) ? … : …`  (tests the CALL's boolean result)
 *   - `x === undefined`, `x != null`  (comparisons yield a boolean)
 *   - `await x` in any position
 *
 * Follow-up: the durable home for this is a typed ESLint rule
 * (`no-truthy-maybe-promise`), so it reports in-editor at the moment the
 * condition is written. This script is the CI floor until that exists.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// The workspace pins the compiler API package separately from the experimental
// `typescript` package, whose package export intentionally has no CommonJS main.
const ts = require('@typescript/typescript6/lib/typescript.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Packages whose sources carry the `MaybePromise` eval lane. Listed explicitly:
 * a package joins this check when it takes on awaitable evaluation, which is a
 * deliberate decision, not something to inherit by living in the workspace.
 */
const checkedPackages = [
  'packages/core',
  'packages/jess-plugin-less',
  'packages/jess-plugin-js',
  'packages/jess'
];

function sourceFiles(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        sourceFiles(path, out);
      }
      continue;
    }
    if (/\.m?ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** A type is thenable when it carries a CALLABLE `then` member. */
function isThenableType(checker, type) {
  const then = checker.getPropertyOfType(type, 'then');
  if (!then) {
    return false;
  }
  const declaration = then.valueDeclaration ?? then.declarations?.[0];
  if (!declaration) {
    return false;
  }
  return checker.getTypeOfSymbolAtLocation(then, declaration).getCallSignatures().length > 0;
}

/**
 * `Promise<void> | undefined` in a condition is the engine's deliberate "is
 * there anything to await?" idiom — truthiness there asks exactly whether the
 * value is a promise, and answers correctly. It is only a hazard when a
 * MEANINGFUL value shares the union, because then the promise arm masks that
 * value's own falsiness.
 */
function isBenignFalsy(type) {
  return (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0;
}

/**
 * Classify one condition operand: `null` when it is safe, otherwise the reason.
 * `sometimes-a-promise` is the widened-`MaybePromise` hazard; `always-truthy` is
 * the same bug with the union collapsed to a bare promise.
 */
function classify(checker, type) {
  const parts = type.isUnion() ? type.types : [type];
  const thenable = parts.filter(part => isThenableType(checker, part));
  if (thenable.length === 0) {
    return null;
  }
  const others = parts.filter(part => !isThenableType(checker, part));
  if (others.length === 0) {
    return 'always-truthy';
  }
  return others.every(isBenignFalsy) ? null : 'sometimes-a-promise';
}

/** Every expression evaluated for its TRUTHINESS, with a label for the report. */
function truthinessOperands(node) {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
      return [[node.expression, 'if condition']];
    case ts.SyntaxKind.WhileStatement:
      return [[node.expression, 'while condition']];
    case ts.SyntaxKind.DoStatement:
      return [[node.expression, 'do-while condition']];
    case ts.SyntaxKind.ForStatement:
      return node.condition ? [[node.condition, 'for condition']] : [];
    case ts.SyntaxKind.ConditionalExpression:
      return [[node.condition, 'ternary condition']];
    case ts.SyntaxKind.PrefixUnaryExpression:
      return node.operator === ts.SyntaxKind.ExclamationToken
        ? [[node.operand, 'negation (!)']]
        : [];
    case ts.SyntaxKind.BinaryExpression: {
      const op = node.operatorToken.kind;
      // `&&` / `||` test the LEFT operand's truthiness; the right operand is the
      // expression's value, not a test. `??` tests nullishness, not truthiness.
      return op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken
        ? [[node.left, op === ts.SyntaxKind.AmpersandAmpersandToken ? '&& left operand' : '|| left operand']]
        : [];
    }
    default:
      return [];
  }
}

function checkPackage(packageDirectory) {
  const configPath = resolve(root, packageDirectory, 'tsconfig.json');
  if (!existsSync(configPath)) {
    return { findings: [], files: 0 };
  }
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    resolve(root, packageDirectory)
  );
  const files = sourceFiles(resolve(root, packageDirectory, 'src'));
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const findings = [];

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) {
      continue;
    }
    const visit = (node) => {
      for (const [operand, where] of truthinessOperands(node)) {
        const verdict = classify(checker, checker.getTypeAtLocation(operand));
        if (verdict) {
          const { line, character } = source.getLineAndCharacterOfPosition(operand.getStart(source));
          findings.push({
            file: relative(root, file),
            line: line + 1,
            column: character + 1,
            where,
            verdict,
            text: operand.getText(source).replace(/\s+/gu, ' ').slice(0, 100)
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { findings, files: files.length };
}

let total = 0;
let scanned = 0;
const all = [];
for (const packageDirectory of checkedPackages) {
  const { findings, files } = checkPackage(packageDirectory);
  scanned += files;
  total += findings.length;
  all.push(...findings);
}

if (total === 0) {
  console.log(`MaybePromise truthiness check passed (${scanned} files, ${checkedPackages.length} packages).`);
  process.exit(0);
}

console.error(`\nMaybePromise truthiness check FAILED — ${total} condition${total === 1 ? ' tests' : 's test'} a possibly-awaitable value:\n`);
for (const finding of all) {
  console.error(`  ${finding.file}:${finding.line}:${finding.column}`);
  console.error(`    ${finding.where} — ${finding.verdict}`);
  console.error(`    ${finding.text}`);
  console.error('');
}
console.error(
  'A promise is ALWAYS truthy, so each of these silently takes one branch when the\n'
  + 'value is awaitable — wrong output, not a crash. Fork on `isThenable` instead\n'
  + '(usually `mapMaybe(value, settled => …)`), or resolve the value before testing it.\n'
);
process.exit(1);
