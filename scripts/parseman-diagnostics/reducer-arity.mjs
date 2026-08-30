#!/usr/bin/env node
/**
 * Exhaustive per-reducer capture-cost survey for the four dialect grammars.
 *
 * WHY THIS IS NOT VISIBLE IN THE GRAMMAR SOURCE
 * ---------------------------------------------
 * In AST mode parseman's `emitNode` decides, per node, which of five capture
 * facilities to allocate, by STATICALLY READING THE REDUCER'S DECLARED
 * PARAMETER LIST (`confirmedBuildArity`, parseman/dist/index.js):
 *
 *     arity >= 1  → capturesChildren      arity >= 2  → capturesFields
 *     arity >= 4  → capturesRaw           arity >= 5  → capturesTrivia
 *     arity >= 6  → clonesState
 *     arity === null (UNCONFIRMABLE) → ALL FIVE, no diagnostic
 *
 * Consequences that no reader of the grammar would predict:
 *
 *  - Arity is POSITIONAL. `(children, _fields, _span, _rawChildren) => …` pays
 *    for raw capture because the 4th slot exists, underscore or not.
 *  - A parameter parseman cannot confirm — destructuring, a default value, a
 *    rest param, a type annotation containing `,` or `=`, or any use of
 *    `arguments` — FAILS OPEN to maximum cost, silently.
 *  - A zero-arity `() =>` reducer sets `capturesChildren = false`, and the
 *    first-set pre-guard is emitted only `if ((capturesChildren || structural)
 *    && needsFirstSetGuard(...))`. So a `() =>` reducer SILENTLY DELETES that
 *    node's first-set gate — on the single biggest recorded parse lever.
 *
 * CST mode is immune: `cstOut` forces every flag true. The two surfaces ship
 * from ONE host-mode source, so this asymmetry is AST-only by construction.
 *
 * HOW THIS SCRIPT MEASURES IT
 * ---------------------------
 * The macro plugin is `enforce: 'pre'` and parses with oxc-parser, so it sees
 * RAW TypeScript — annotations included. `confirmedBuildArity` is therefore
 * applied here to the raw source slice, byte-for-byte as the macro sees it,
 * using parseman's own regexes (copied verbatim below and asserted against the
 * installed package).
 *
 * The runtime pass (interpreted grammar graph) supplies what source text
 * cannot: each node's actual first-set, so "guard silently disabled" is a
 * measured fact and not a guess.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadInterpreted, GRAMMARS, ROOT } from './_load.mjs';

const { parseSync } = await import(
  resolve(ROOT, 'node_modules/.pnpm/parseman@0.43.0/node_modules/oxc-parser/src-js/index.js')
);

/* ---- parseman's own predicate, verbatim (src/compiler/build-arity.ts) ---- */
const PARAM_LIST_RE = /^(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/;
const CONFIRMABLE_PARAM_RE = /^[A-Za-z_$][\w$]*\s*\??\s*(?::[^,=]+)?$/;

function confirmedBuildArity(src) {
  const s = src.trim();
  const m = PARAM_LIST_RE.exec(s);
  if (!m) {
    return { arity: null, why: 'not-a-recognized-function-form' };
  }
  if (m[3] !== undefined) {
    return { arity: 1, why: null };
  }
  const inner = (m[1] ?? m[2] ?? '').trim();
  if (inner === '') {
    return { arity: 0, why: null };
  }
  const parts = inner.split(',');
  for (const part of parts) {
    if (!CONFIRMABLE_PARAM_RE.test(part.trim())) {
      return { arity: null, why: `unconfirmable-param: ${JSON.stringify(part.trim())}` };
    }
  }
  if (/\barguments\b/.test(s)) {
    return { arity: null, why: 'uses-arguments' };
  }
  return { arity: parts.length, why: null };
}

/** Declared parameter names, in order, as the macro sees them. */
function paramNamesOf(src) {
  const m = PARAM_LIST_RE.exec(src.trim());
  if (!m) {
    return null;
  }
  if (m[3] !== undefined) {
    return [m[3]];
  }
  const inner = (m[1] ?? m[2] ?? '').trim();
  return inner === '' ? [] : inner.split(',').map(p => p.trim().split(/[?:]/)[0].trim());
}

/**
 * The facilities a reducer pays for, and which of them are attributable to
 * TRAILING parameters that are spelled as deliberately unused (`_name`).
 * Deleting those trailing params lowers the arity and drops the facility —
 * this is the only class of overpay that is both free and mechanical to fix.
 */
const SLOT_FACILITY = { 1: 'children', 2: 'fields', 4: 'raw', 5: 'trivia', 6: 'state' };

function trailingUnusedFacilities(paramNames) {
  if (!paramNames) {
    return { droppable: 0, facilities: [] };
  }
  let n = paramNames.length;
  while (n > 0 && /^_/.test(paramNames[n - 1] ?? '')) {
    n--;
  }
  const facilities = [];
  for (let slot = n + 1; slot <= paramNames.length; slot++) {
    if (SLOT_FACILITY[slot]) {
      facilities.push(SLOT_FACILITY[slot]);
    }
  }
  return { droppable: paramNames.length - n, newArity: n, facilities };
}

/** The five capture facilities `emitNode` derives from that arity. */
function flagsFor(arity) {
  const open = arity === null;
  return {
    capturesChildren: open || arity >= 1,
    capturesFields: open || arity >= 2,
    capturesRaw: open || arity >= 4,
    capturesTrivia: open || arity >= 5,
    clonesState: open || arity >= 6
  };
}

/* ---------------- static pass: every node() build in source ---------------- */

const FN_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, visit, parent);
    }
    return;
  }
  if (typeof node.type === 'string') {
    visit(node, parent);
    parent = node;
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'range' || key === 'loc') {
      continue;
    }
    walk(node[key], visit, parent);
  }
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/**
 * Top-level `const NAME = <fn>` declarations, so a reducer passed by BARE NAME
 * can be resolved to the signature that actually sets the cost. Nine such
 * sites exist across the four grammars and none of them read as a cost
 * decision at the call site.
 */
function namedFunctionTable(program, text) {
  const table = new Map();
  walk(program, (n) => {
    /*
     * Both spellings matter and they are NOT interchangeable to the diagnostic:
     * `const x = (…) => …` and `function x(…) {…}` are matched by different
     * branches of parseman's PARAM_LIST_RE. The reducers actually passed by name
     * in these grammars are function DECLARATIONS.
     */
    if (n.type === 'FunctionDeclaration' && n.id?.type === 'Identifier') {
      table.set(n.id.name, { src: text.slice(n.start, n.end), start: n.start, form: 'function-declaration' });
      return;
    }
    if (n.type !== 'VariableDeclarator' || n.id?.type !== 'Identifier' || !n.init) {
      return;
    }
    if (FN_TYPES.has(n.init.type)) {
      table.set(n.id.name, { src: text.slice(n.init.start, n.init.end), start: n.init.start, form: 'const-arrow' });
    }
  });
  return table;
}

function staticSurvey(file) {
  const abs = resolve(ROOT, file);
  const text = readFileSync(abs, 'utf8');
  const { program, errors } = parseSync(abs, text, { sourceType: 'module', lang: 'ts' });
  if (errors?.length) {
    throw new Error(`${file}: ${errors.length} parse error(s): ${errors[0]?.message}`);
  }
  const named = namedFunctionTable(program, text);
  const rows = [];

  walk(program, (n) => {
    if (n.type !== 'CallExpression' || n.callee?.type !== 'Identifier' || n.callee.name !== 'node') {
      return;
    }
    const args = n.arguments ?? [];

    /*
     * `node(type, parser, build?, opts?)` and `node(parser, build?, opts?)`.
     * The build is whichever argument is a function (or a bare identifier
     * naming one); an object literal in that slot is `opts`, not a reducer.
     */
    let buildArg = null;
    let via = 'inline';
    for (const a of args.slice(1)) {
      if (FN_TYPES.has(a.type)) {
        buildArg = { src: text.slice(a.start, a.end), start: a.start };
        break;
      }
      if (a.type === 'Identifier' && named.has(a.name)) {
        const ref = named.get(a.name);
        buildArg = { src: ref.src, start: ref.start, name: a.name };
        via = `named-ref:${a.name}(${ref.form})`;
        break;
      }
    }

    const typeArg = args[0]?.type === 'Literal' || args[0]?.type === 'StringLiteral' ? args[0].value : null;

    if (buildArg === null) {
      /* No reducer at all → `structural`, which force-enables everything by design. */
      rows.push({ file, line: lineOf(text, n.start), nodeType: typeArg, kind: 'structural', arity: null, why: null, via: null, flags: null, src: null });
      return;
    }

    const { arity, why } = confirmedBuildArity(buildArg.src);
    rows.push({
      file,
      line: lineOf(text, buildArg.start),
      nodeType: typeArg,
      kind: 'build',
      via,
      arity,
      why,
      flags: flagsFor(arity),

      /* Params only — the body is irrelevant and would swamp the report. */
      params: /^[^)]*\)?/.exec(buildArg.src.trim())?.[0] ?? null,
      paramNames: paramNamesOf(buildArg.src)
    });
  });

  return rows;
}

/* ------------- runtime pass: which guards are actually deleted ------------- */

function firstSetKind(fs) {
  return fs?.kind ?? 'unknown';
}

/**
 * `parserHasOwnFields`, ported from parseman/dist/index.js. The `fields` slot is
 * the ONLY one of the five that is not arity-alone: `capturesFields` also
 * requires the node's own parser to contain a `field()`. Without this, a report
 * counting "arity >= 2" as fields cost overstates every arity-3 reducer.
 */
function parserHasOwnFields(p, seen = new Set()) {
  if (!p || typeof p !== 'object' || seen.has(p)) {
    return false;
  }
  seen.add(p);
  const d = p._def;
  if (!d) {
    return false;
  }
  switch (d.tag) {
    case 'field':
      return true;
    case 'node':
      return false;
    case 'lazy':
      try {
        return parserHasOwnFields(d.thunk(), seen);
      } catch {
        return false;
      }
    case 'sequence':
    case 'choice':
      return (d.parsers ?? []).some(x => parserHasOwnFields(x, seen));
    case 'dispatch':
      return parserHasOwnFields(d.selector, seen)
        || (d.cases ?? []).some(x => parserHasOwnFields(x.parser, seen))
        || (d.matchers ?? []).some(e => parserHasOwnFields(e.parser, seen))
        || (d.otherwise ? parserHasOwnFields(d.otherwise, seen) : false);
    case 'sepBy':
      return parserHasOwnFields(d.parser, seen) || parserHasOwnFields(d.separator, seen);
    case 'skip':
      return parserHasOwnFields(d.main, seen) || parserHasOwnFields(d.skipped, seen);
    case 'grammar':
      return parserHasOwnFields(d.parser, seen) || (d.triviaParser ? parserHasOwnFields(d.triviaParser, seen) : false);
    case 'scanTo':
      return parserHasOwnFields(d.sentinel, seen) || (d.skip ?? []).some(x => parserHasOwnFields(x, seen));
    case 'recover':
      return parserHasOwnFields(d.parser, seen) || parserHasOwnFields(d.sentinel, seen);
    default:
      return parserHasOwnFields(d.parser, seen);
  }
}

/** `needsFirstSetGuard`: a non-`any` first set on a parser that can't match empty. */
function guardWorthEmitting(parser) {
  const fs = parser?._meta?.firstSet;
  return !!fs && fs.kind !== 'any' && fs.kind !== 'empty';
}

function runtimeSurvey(grammarPieces) {
  const seen = new Set();
  const nodes = [];

  const visit = (c) => {
    if (!c || typeof c !== 'object' || seen.has(c)) {
      return;
    }
    seen.add(c);
    const def = c._def;
    if (!def || typeof def !== 'object') {
      return;
    }
    if (def.tag === 'node') {
      const structural = def.build === undefined && def.project === undefined;
      const src = def.buildSrc ?? (def.build ? def.build.toString() : null);
      const { arity, why } = src === null ? { arity: null, why: 'structural' } : confirmedBuildArity(src);
      const capturesChildren = !structural
        && (def.unwrap === true || def.collapse === true || def.project !== undefined || arity === null || arity >= 1);
      nodes.push({
        nodeType: def.type ?? null,
        structural,
        arity,
        why,
        unwrap: def.unwrap === true,
        collapse: def.collapse === true,
        hasProject: def.project !== undefined,
        capturesChildren,
        hasOwnFields: parserHasOwnFields(def.parser),
        firstSet: firstSetKind(def.parser?._meta?.firstSet),
        guardWorthEmitting: guardWorthEmitting(def.parser),

        /* The finding: a gate the grammar earned, deleted by how a reducer is spelled. */
        guardSilentlyDisabled: !structural && !capturesChildren && guardWorthEmitting(def.parser)
      });
    }
    if (def.tag === 'lazy') {
      try {
        visit(def.thunk());
      } catch { /* an unresolved shared-shape hole; nothing to walk */ }
      return;
    }
    for (const key of Object.keys(def)) {
      const value = def[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
          if (Array.isArray(item)) {
            item.forEach(visit);
          }
        }
      } else {
        visit(value);
      }
    }
  };

  for (const piece of grammarPieces) {
    if (piece && typeof piece === 'object') {
      for (const value of Object.values(piece)) {
        visit(value);
      }
    }
  }
  return nodes;
}

/* --------------------------------- drive --------------------------------- */

const COMPOSE_PIECES_RAW = Symbol.for('jess.diagnostics.composePiecesRaw');
const out = { static: {}, runtime: {} };

for (const g of GRAMMARS) {
  out.static[g.dialect] = staticSurvey(g.file);
}

const interpreted = await loadInterpreted();
try {
  for (const g of GRAMMARS) {
    const mod = await interpreted.load(g.file);
    const pieces = mod[g.exports.ast]?.[COMPOSE_PIECES_RAW] ?? [];
    out.runtime[g.dialect] = runtimeSurvey(pieces);
  }
} finally {
  await interpreted.close();
}

const dir = resolve(ROOT, 'scripts/parseman-diagnostics/out');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'reducer-arity.json'), JSON.stringify(out, null, 2));

/* --------------------------------- report --------------------------------- */

const COST = ['children', 'fields', '(3)', 'raw', 'trivia', 'state'];

console.log('REDUCER CAPTURE-COST SURVEY (AST mode) — parseman 0.43.0\n');
console.log('arity→cost: >=1 children · >=2 fields · >=4 raw · >=5 trivia · >=6 state · null = ALL\n');

let grandUnconfirmable = 0;
let grandOverpay = 0;

for (const g of GRAMMARS) {
  const rows = out.static[g.dialect];
  const builds = rows.filter(r => r.kind === 'build');
  const structural = rows.length - builds.length;
  const hist = new Map();
  for (const r of builds) {
    const k = r.arity === null ? 'null' : String(r.arity);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const unconfirmable = builds.filter(r => r.arity === null);
  const namedRefs = builds.filter(r => r.via?.startsWith('named-ref'));
  const zero = builds.filter(r => r.arity === 0);

  /*
   * Interior `_name` params cannot be removed without renumbering the ones
   * after them, so only TRAILING unused params are free to delete — and only
   * those actually buy a facility back.
   */
  const trailing = builds
    .map(r => ({ ...r, drop: trailingUnusedFacilities(r.paramNames) }))
    .filter(r => r.drop.facilities.length > 0);

  grandUnconfirmable += unconfirmable.length;
  grandOverpay += trailing.length;

  console.log(`${'='.repeat(74)}\n${g.dialect}  (${g.file})`);
  console.log(`  node() sites: ${rows.length}  |  with reducer: ${builds.length}  |  structural: ${structural}`);
  console.log(`  arity histogram: ${[...hist].sort((a, b) => (a[0] === 'null' ? 99 : +a[0]) - (b[0] === 'null' ? 99 : +b[0])).map(([k, v]) => `${k}→${v}`).join('  ')}`);
  console.log(`  UNCONFIRMABLE (fails open to all five): ${unconfirmable.length}`);
  for (const r of unconfirmable) {
    console.log(`    ${r.file}:${r.line}  ${r.nodeType ?? '(inferred)'}  ${r.why}  ${r.via}`);
  }
  console.log(`  zero-arity () => (first-set guard DELETED): ${zero.length}`);
  for (const r of zero) {
    console.log(`    ${r.file}:${r.line}  ${r.nodeType ?? '(inferred)'}`);
  }
  console.log(`  reducer passed by BARE NAME (helper signature sets the cost): ${namedRefs.length}`);
  for (const r of namedRefs) {
    console.log(`    ${r.file}:${r.line}  ${r.nodeType ?? '(inferred)'}  ${r.via}  arity=${r.arity}  params=${r.params}`);
  }
  console.log(`  TRAILING unused params buying a facility for nothing: ${trailing.length}`);
  for (const r of trailing) {
    console.log(`    ${r.file}:${r.line}  ${r.nodeType ?? '(inferred)'}  arity ${r.arity}→${r.drop.newArity} frees[${r.drop.facilities.join(',')}]  params=${r.params}`);
  }

  const rt = out.runtime[g.dialect] ?? [];
  const disabled = rt.filter(r => r.guardSilentlyDisabled);
  console.log(`  RUNTIME: ${rt.length} node defs reached | guards silently disabled: ${disabled.length}`);
  for (const r of disabled) {
    console.log(`    ${r.nodeType ?? '(inferred)'}  arity=${r.arity}  firstSet=${r.firstSet}`);
  }

  /* `fields` is the one slot arity alone does not buy — report the real payers. */
  const fieldPayers = rt.filter(r => !r.structural && r.hasOwnFields && (r.arity === null || r.arity >= 2));
  const fieldNonPayers = rt.filter(r => !r.structural && !r.hasOwnFields && (r.arity === null || r.arity >= 2));
  console.log(`  fields slot: ${fieldPayers.length} node(s) actually capture fields; ${fieldNonPayers.length} have arity >= 2 but no field() in the parser (no cost)`);
}

console.log(`\n${'='.repeat(74)}\nTOTALS: unconfirmable=${grandUnconfirmable}  trailing-droppable=${grandOverpay}`);

/*
 * The bottom line: how many nodes per dialect pay each AST-only facility.
 * children/raw/trivia/state are arity-alone; fields additionally needs a
 * field() inside the node's own parser, so it is counted from the runtime walk.
 */
console.log(`\n${'='.repeat(74)}\nAST-ONLY CAPTURE COST BY DIALECT (CST mode pays all of these unconditionally)\n`);
console.log('dialect  nodes  children  raw(>=4)  trivia(>=5)  state(>=6)  fields(real)  guards-deleted');
for (const g of GRAMMARS) {
  const builds = out.static[g.dialect].filter(r => r.kind === 'build');
  const atLeast = n => builds.filter(r => r.arity === null || r.arity >= n).length;
  const rt = out.runtime[g.dialect] ?? [];
  const fields = rt.filter(r => !r.structural && r.hasOwnFields && (r.arity === null || r.arity >= 2)).length;
  const deleted = rt.filter(r => r.guardSilentlyDisabled).length;
  console.log(
    `${g.dialect.padEnd(8)} ${String(builds.length).padStart(5)} ${String(atLeast(1)).padStart(9)} `
    + `${String(atLeast(4)).padStart(9)} ${String(atLeast(5)).padStart(12)} ${String(atLeast(6)).padStart(11)} `
    + `${String(fields).padStart(13)} ${String(deleted).padStart(15)}`
  );
}
