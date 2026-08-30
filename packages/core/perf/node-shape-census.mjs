/*
 * Realized-hidden-class census for jess AST and CST nodes on a REAL parse.
 *
 * The prior hidden-class-unification experiment assumed 16 maps and observed 2.
 * So: count the maps that V8 actually realizes BEFORE theorizing about them.
 *
 * Method: %HaveSameMap via --allow-natives-syntax (exact, not a proxy). A
 * key-signature census is reported alongside it, because the two disagreeing is
 * itself informative -- identical key sets can still be different maps
 * (insertion order, transition trees, dictionary mode).
 *
 * Run (from a checkout whose parsers are BUILT):
 *   node --allow-natives-syntax --expose-gc \
 *     packages/core/perf/node-shape-census.mjs --root=/abs/path/to/jess --file=/abs/file.css
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const arg = name => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

const ROOT = arg('root') ?? process.cwd();
const FILE = arg('file') ?? join(ROOT, 'packages/jess/benchmark/benchmark.css');

let haveSameMap = null;
try {
  // eslint-disable-next-line no-new-func
  const f = new Function('a', 'b', 'return %HaveSameMap(a, b);');
  f({ x: 1 }, { x: 1 });
  haveSameMap = f;
} catch {
  console.error('WARNING: no --allow-natives-syntax; %HaveSameMap census unavailable.');
}

const cssParserDir = join(ROOT, 'packages/syntax/css/css-parser');
const cstMod = await import(pathToFileURL(join(cssParserDir, 'lib/cst.js')).href);
const idxMod = await import(pathToFileURL(join(cssParserDir, 'lib/index.js')).href);

/*
 * Resolve the parseman actually linked into the built parser and report its
 * version + real path -- stale-pointer failures are silent and clean, so the
 * resolved artifact is evidence that must precede the numbers.
 */
const req = createRequire(join(cssParserDir, 'package.json'));
const parsemanPath = req.resolve('parseman');
let parsemanVersion = '(unknown)';
try {
  const dir = parsemanPath.slice(0, parsemanPath.lastIndexOf('/node_modules/parseman/') + '/node_modules/parseman/'.length);
  parsemanVersion = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
} catch { /* reported as unknown */ }

const source = readFileSync(FILE, 'utf8');

/* ------------------------------------------------------------------ census */

/*
 * Exact map census. Linear scan against realized representatives -- fine
 * because the representative count is small (that is the whole finding).
 */
function mapCensus(objects) {
  if (!haveSameMap) { return null; }
  const reps = [];
  const counts = [];
  for (const o of objects) {
    let hit = -1;
    for (let i = 0; i < reps.length; i++) {
      if (haveSameMap(reps[i], o)) { hit = i; break; }
    }
    if (hit === -1) { reps.push(o); counts.push(1); } else { counts[hit] += 1; }
  }
  return reps.map((r, i) => ({ keys: Object.keys(r), count: counts[i] }))
    .sort((a, b) => b.count - a.count);
}

/* Key-signature census: the shape a reader would GUESS from the source. */
function keyCensus(objects) {
  const m = new Map();
  for (const o of objects) {
    const k = Object.keys(o).join(',');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([keys, count]) => ({ keys, count }))
    .sort((a, b) => b.count - a.count);
}

function report(label, objects) {
  console.log(`\n=== ${label}: ${objects.length.toLocaleString()} objects`);
  const km = keyCensus(objects);
  console.log(`  key-signature census: ${km.length} distinct key set(s)`);
  for (const s of km.slice(0, 40)) {
    console.log(`    ${String(s.count).padStart(7)}  {${s.keys}}`);
  }
  if (km.length > 40) { console.log(`    ... ${km.length - 40} more`); }

  const mm = mapCensus(objects);
  if (mm) {
    console.log(`  %HaveSameMap census: ${mm.length} REALIZED map(s)`);
    for (const s of mm.slice(0, 40)) {
      console.log(`    ${String(s.count).padStart(7)}  {${s.keys.join(',')}}`);
    }
    if (mm.length > 40) { console.log(`    ... ${mm.length - 40} more`); }
  }
}

/* -------------------------------------------------------------- collectors */

function collectCst(root) {
  const nodes = [];
  const leaves = [];
  const spans = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n === null || typeof n !== 'object') { continue; }
    if (n._tag === 'node') {
      nodes.push(n);
      if (n.span) { spans.push(n.span); }
      const kids = n.rules ?? [];
      for (let i = 0; i < kids.length; i++) { stack.push(kids[i]); }
    } else if (n._tag === 'leaf') {
      leaves.push(n);
      if (n.span) { spans.push(n.span); }
    } else if (n._tag === 'error') {
      const kids = n.rules ?? [];
      for (let i = 0; i < kids.length; i++) { stack.push(kids[i]); }
    }
  }
  return { nodes, leaves, spans };
}

/*
 * AST collector. The AST is a plain-data node model; walk every own enumerable
 * property that is an object/array so no node type is missed by name.
 */
function collectAst(root) {
  const nodes = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n === null || typeof n !== 'object' || seen.has(n)) { continue; }
    seen.add(n);
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) { stack.push(n[i]); }
      continue;
    }
    nodes.push(n);
    for (const v of Object.values(n)) {
      if (v !== null && typeof v === 'object') { stack.push(v); }
    }
  }
  return nodes;
}

/* -------------------------------------------------------------------- main */

console.log(`root          = ${ROOT}`);
console.log(`file          = ${FILE} (${source.length.toLocaleString()} B)`);
console.log(`parseman      = ${parsemanVersion} @ ${parsemanPath}`);
console.log(`node          = ${process.version}`);

/* Warm the parser so V8 has settled on its real maps before we census. */
for (let i = 0; i < 3; i++) {
  cstMod.parseCssCst(source);
  idxMod.parse(source);
}

const cstResult = cstMod.parseCssCst(source);
const { nodes: cstNodes, leaves: cstLeaves, spans: cstSpans } = collectCst(cstResult.tree);
report('CST nodes (_tag:node)', cstNodes);
report('CST leaves (_tag:leaf)', cstLeaves);
report('CST spans', cstSpans);
console.log(`\nCST total tree objects = ${(cstNodes.length + cstLeaves.length).toLocaleString()} (+ ${cstSpans.length.toLocaleString()} span objects)`);

const ast = idxMod.parse(source);
const astNodes = collectAst(ast);
report('AST nodes (all reachable objects)', astNodes);

/*
 * Retained cost of each structure, measured by holding ONE parse live across a
 * forced GC. Sizes the prize before anyone proposes a rewrite.
 */
function retained(build) {
  if (typeof globalThis.gc !== 'function') { return null; }
  globalThis.gc(); globalThis.gc();
  const before = process.memoryUsage();
  const held = build();
  globalThis.gc(); globalThis.gc();
  const after = process.memoryUsage();
  const bytes = (after.heapUsed + after.arrayBuffers) - (before.heapUsed + before.arrayBuffers);
  if (held === undefined) { throw new Error('unreachable'); }
  return bytes;
}

console.log('\n=== retained heap for ONE live parse (forced GC either side)');
const cstBytes = retained(() => cstMod.parseCssCst(source));
const astBytes = retained(() => idxMod.parse(source));
const fmtKb = b => `${(b / 1024).toFixed(0)} KB`;
console.log(`  CST  ${fmtKb(cstBytes)}  over ${(cstNodes.length + cstLeaves.length).toLocaleString()} tree objects + ${cstSpans.length.toLocaleString()} spans = ${(cstBytes / (cstNodes.length + cstLeaves.length)).toFixed(1)} B/tree-object`);
console.log(`  AST  ${fmtKb(astBytes)}  over ${astNodes.length.toLocaleString()} nodes = ${(astBytes / astNodes.length).toFixed(1)} B/node`);
console.log(`  source is ${source.length.toLocaleString()} B -> CST = ${(cstBytes / source.length).toFixed(1)}x source, AST = ${(astBytes / source.length).toFixed(1)}x source`);
