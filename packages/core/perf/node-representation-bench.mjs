/*
 * Node-representation microbenchmark: AoS (objects) vs SoA (parallel columns).
 *
 * Standalone. No jess dependencies. Answers the owner's question: "should we be
 * storing nodes as objects in the first place -- 100,000 objects with specific
 * fields vs 100,000 parallel field arrays?"
 *
 * Run:
 *   node --expose-gc --allow-natives-syntax packages/core/perf/node-representation-bench.mjs
 *   node --expose-gc --allow-natives-syntax packages/core/perf/node-representation-bench.mjs --n=1000000
 *
 * Every number is: warmup >= 5, N samples, MEDIAN reported, plus a noise floor
 * computed from an A/A duplicate lane (the same code run as two separate lanes).
 * Treat any delta inside the noise floor as INCONCLUSIVE.
 */

import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { loadavg } from 'node:os';

const argN = process.argv.find(a => a.startsWith('--n='));
const N_RECORDS = argN ? Number(argN.slice(4)) : 100_000;
const argS = process.argv.find(a => a.startsWith('--samples='));
const SAMPLES = argS ? Number(argS.slice(10)) : (N_RECORDS >= 1_000_000 ? 11 : 21);
/*
 * 15, not 5: the A/A duplicate lanes showed the FIRST lane of a group still
 * tiering up (a 14x gap between a lane and its own duplicate at warmup=5).
 * Every group therefore also carries an A/A duplicate so residual ordering bias
 * stays visible rather than being asserted away.
 */
const argW = process.argv.find(a => a.startsWith('--warmup='));
const WARMUP = argW ? Number(argW.slice(9)) : 15;

if (typeof globalThis.gc !== 'function') {
  console.error('Run with --expose-gc');
  process.exit(1);
}

/* ---------------------------------------------------------------- GC stats */

let gcMajorCount = 0;
let gcMajorMs = 0;
let gcMinorCount = 0;
let gcMinorMs = 0;

const gcObserver = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) {
      gcMajorCount += 1;
      gcMajorMs += entry.duration;
    } else if (entry.detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) {
      gcMinorCount += 1;
      gcMinorMs += entry.duration;
    }
  }
});
gcObserver.observe({ entryTypes: ['gc'] });

function resetGcStats() {
  gcMajorCount = 0; gcMajorMs = 0; gcMinorCount = 0; gcMinorMs = 0;
}
function gcSnapshot() {
  return { majorCount: gcMajorCount, majorMs: gcMajorMs, minorCount: gcMinorCount, minorMs: gcMinorMs };
}

/* ------------------------------------------------------------- statistics */

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}
/* Relative interquartile spread -- the per-lane self-noise. */
function spread(xs) {
  const m = median(xs);
  return m === 0 ? 0 : (pct(xs, 0.75) - pct(xs, 0.25)) / m;
}

function forceGc() {
  globalThis.gc();
  globalThis.gc();
}

function heapUsed() {
  forceGc();
  return process.memoryUsage().heapUsed;
}

/*
 * Typed-array BACKING STORES live outside heapUsed (they are ArrayBuffers), so
 * a heapUsed-only reading would score SoA-typed at ~zero and be a lie. Retained
 * cost = heapUsed + arrayBuffers.
 */
function retainedTotal() {
  forceGc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

/*
 * Time `fn` N times. `fn` returns a value that must be kept alive so the
 * optimizer cannot delete the work.
 */
const sink = [];
function timeLane(fn) {
  for (let i = 0; i < WARMUP; i++) { sink[0] = fn(); }
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    forceGc();
    const t0 = performance.now();
    sink[0] = fn();
    times.push(performance.now() - t0);
  }
  sink.length = 0;
  /*
   * MIN is reported alongside MEDIAN deliberately. This machine runs concurrent
   * agent builds; interference can only ADD time to a sample, never subtract,
   * so under contention the minimum is the least-biased estimator of true cost
   * and the median tracks the contention level. When min and median tell the
   * same story the result is safe; when they disagree, say so.
   */
  return {
    median: median(times),
    min: Math.min(...times),
    spread: spread(times),
    samples: times.length
  };
}

/* ============================================================== FLAT LANES */

/*
 * Record shape mirrors a CST node reduced to its measurable essentials:
 * 6 integer-ish fields. `kind` and `flags` stand in for interned type ids.
 */

/* --- 1. AoS monomorphic: one factory, one hidden class. */
function makeMono(kind, start, end, parent, firstChild, nextSibling) {
  return { kind, start, end, parent, firstChild, nextSibling };
}
function buildAoSMono(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = makeMono(i & 31, i * 7, i * 7 + 5, i >> 1, -1, -1);
  }
  return out;
}

/*
 * --- 2. AoS polymorphic: three construction paths.
 * Path A: base 6 fields.
 * Path B: same 6 fields plus an optional `tags` field (this is EXACTLY what
 *         buildCssCstNode's conditional spread does today).
 * Path C: fields inserted in a different order -> a different map even though
 *         the field SET is identical.
 */
function buildAoSPoly(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = i % 3;
    if (m === 0) {
      out[i] = { kind: i & 31, start: i * 7, end: i * 7 + 5, parent: i >> 1, firstChild: -1, nextSibling: -1 };
    } else if (m === 1) {
      out[i] = { kind: i & 31, start: i * 7, end: i * 7 + 5, parent: i >> 1, firstChild: -1, nextSibling: -1, tags: 1 };
    } else {
      out[i] = { start: i * 7, kind: i & 31, parent: i >> 1, end: i * 7 + 5, nextSibling: -1, firstChild: -1 };
    }
  }
  return out;
}

/*
 * --- 2b. AoS conditional-spread: the literal shape jess's buildCssCstNode uses.
 * Isolated so we can price the SPREAD itself against the branchy equivalent.
 */
function buildAoSSpread(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const tags = (i % 3 === 1) ? 1 : undefined;
    out[i] = {
      kind: i & 31,
      start: i * 7,
      end: i * 7 + 5,
      ...(tags === undefined ? {} : { tags }),
      parent: i >> 1,
      firstChild: -1,
      nextSibling: -1
    };
  }
  return out;
}

/*
 * --- 2c. CONTROL for 2b: the SAME two hidden classes, produced by two explicit
 * branches instead of a conditional spread. Pairing 2b against 2c isolates the
 * cost of the SPREAD from the cost of the POLYMORPHISM -- without this control
 * the two are confounded and the conclusion would be unearned.
 */
function buildAoSTwoBranch(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const tags = (i % 3 === 1) ? 1 : undefined;
    out[i] = tags === undefined
      ? { kind: i & 31, start: i * 7, end: i * 7 + 5, parent: i >> 1, firstChild: -1, nextSibling: -1 }
      : { kind: i & 31, start: i * 7, end: i * 7 + 5, tags, parent: i >> 1, firstChild: -1, nextSibling: -1 };
  }
  return out;
}

/*
 * --- 2d. Faithful replica of buildCssCstNode's returned literal: 8 fields, the
 * conditional `tags` spread in the middle, `rules`/`children` ALIASING one
 * array, plus the per-node `filter` allocation the real builder performs.
 */
function buildCstReplicaSpread(n, rawChildren) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const rules = rawChildren.filter(c => c !== null);
    const tags = (i % 7 === 0) ? ['Selector'] : undefined;
    out[i] = {
      _tag: 'node',
      type: 'Declaration',
      grammarType: 'Declaration',
      ...(tags === undefined || tags.length === 0 ? {} : { tags }),
      span: { start: i * 7, end: i * 7 + 5 },
      state: null,
      rules,
      children: rules
    };
  }
  return out;
}

/* --- 2e. Same replica, spread replaced by two branches. Nothing else changes. */
function buildCstReplicaBranch(n, rawChildren) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const rules = rawChildren.filter(c => c !== null);
    const tags = (i % 7 === 0) ? ['Selector'] : undefined;
    const span = { start: i * 7, end: i * 7 + 5 };
    out[i] = (tags === undefined || tags.length === 0)
      ? { _tag: 'node', type: 'Declaration', grammarType: 'Declaration', span, state: null, rules, children: rules }
      : { _tag: 'node', type: 'Declaration', grammarType: 'Declaration', tags, span, state: null, rules, children: rules };
  }
  return out;
}

/* --- 3. SoA typed: parallel Int32Arrays. */
function buildSoATyped(n) {
  const kind = new Int32Array(n);
  const start = new Int32Array(n);
  const end = new Int32Array(n);
  const parent = new Int32Array(n);
  const firstChild = new Int32Array(n);
  const nextSibling = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    kind[i] = i & 31;
    start[i] = i * 7;
    end[i] = i * 7 + 5;
    parent[i] = i >> 1;
    firstChild[i] = -1;
    nextSibling[i] = -1;
  }
  return { kind, start, end, parent, firstChild, nextSibling };
}

/* --- 4. SoA plain: parallel plain Arrays (the case where a column holds refs). */
function buildSoAPlain(n) {
  const kind = new Array(n);
  const start = new Array(n);
  const end = new Array(n);
  const parent = new Array(n);
  const firstChild = new Array(n);
  const nextSibling = new Array(n);
  for (let i = 0; i < n; i++) {
    kind[i] = i & 31;
    start[i] = i * 7;
    end[i] = i * 7 + 5;
    parent[i] = i >> 1;
    firstChild[i] = -1;
    nextSibling[i] = -1;
  }
  return { kind, start, end, parent, firstChild, nextSibling };
}

/*
 * --- 5. SoA hybrid: ints in typed arrays + ONE plain-Array column for a
 * string/reference field. This is the realistic CST candidate -- a CST node
 * cannot be all-integer (it carries `value`, `state`).
 */
const STRINGS = ['a', 'bb', 'ccc', 'dddd'];
function buildSoAHybrid(n) {
  const kind = new Int32Array(n);
  const start = new Int32Array(n);
  const end = new Int32Array(n);
  const parent = new Int32Array(n);
  const firstChild = new Int32Array(n);
  const nextSibling = new Int32Array(n);
  const value = new Array(n);
  for (let i = 0; i < n; i++) {
    kind[i] = i & 31;
    start[i] = i * 7;
    end[i] = i * 7 + 5;
    parent[i] = i >> 1;
    firstChild[i] = -1;
    nextSibling[i] = -1;
    value[i] = STRINGS[i & 3];
  }
  return { kind, start, end, parent, firstChild, nextSibling, value };
}

/* AoS equivalent of the hybrid (7 fields incl. a string) for a fair pairing. */
function buildAoSHybrid(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      kind: i & 31, start: i * 7, end: i * 7 + 5, parent: i >> 1,
      firstChild: -1, nextSibling: -1, value: STRINGS[i & 3]
    };
  }
  return out;
}

/* ================================================ SPAN-CARRIAGE LANES ==== */

/*
 * Directly prices the three ways a node can carry its source span. The real
 * parse census shows jess's CST allocates ONE separate {start,end} object per
 * tree object (71,301 spans for 71,301 tree objects on benchmark.css), and the
 * AST carries spans in WeakMap side-tables. So this is not hypothetical.
 */

/* A: inline integer fields (the TypeScript/rustc model). */
function buildSpanInline(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { kind: i & 31, start: i * 7, end: i * 7 + 5, value: STRINGS[i & 3] };
  }
  return out;
}
function readSpanInline(a) {
  let acc = 0;
  for (let i = 0; i < a.length; i++) { const r = a[i]; acc += r.end - r.start; }
  return acc;
}

/* B: nested span OBJECT (what buildCssCstNode does today). */
function buildSpanNested(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { kind: i & 31, span: { start: i * 7, end: i * 7 + 5 }, value: STRINGS[i & 3] };
  }
  return out;
}
function readSpanNested(a) {
  let acc = 0;
  for (let i = 0; i < a.length; i++) { const s = a[i].span; acc += s.end - s.start; }
  return acc;
}

/* C: WeakMap side-table (what the AST does today). */
function buildSpanWeakMap(n) {
  const out = new Array(n);
  const starts = new WeakMap();
  const ends = new WeakMap();
  for (let i = 0; i < n; i++) {
    const node = { kind: i & 31, value: STRINGS[i & 3] };
    starts.set(node, i * 7);
    ends.set(node, i * 7 + 5);
    out[i] = node;
  }
  return { nodes: out, starts, ends };
}
function readSpanWeakMap(c) {
  let acc = 0;
  const { nodes, starts, ends } = c;
  for (let i = 0; i < nodes.length; i++) { const node = nodes[i]; acc += ends.get(node) - starts.get(node); }
  return acc;
}

/* D: SoA span columns -- Int32Array indexed by node id. */
function buildSpanSoA(n) {
  const kind = new Int32Array(n);
  const start = new Int32Array(n);
  const end = new Int32Array(n);
  const value = new Array(n);
  for (let i = 0; i < n; i++) {
    kind[i] = i & 31; start[i] = i * 7; end[i] = i * 7 + 5; value[i] = STRINGS[i & 3];
  }
  return { kind, start, end, value };
}
function readSpanSoA(c) {
  let acc = 0;
  const { start, end } = c;
  for (let i = 0; i < start.length; i++) { acc += end[i] - start[i]; }
  return acc;
}

/* ------------------------------------------------------------- read lanes */

function seqReadAoS(a) {
  let acc = 0;
  for (let i = 0; i < a.length; i++) { const r = a[i]; acc += r.end - r.start + r.kind; }
  return acc;
}
function seqReadSoA(c) {
  let acc = 0;
  const { start, end, kind } = c;
  for (let i = 0; i < start.length; i++) { acc += end[i] - start[i] + kind[i]; }
  return acc;
}
function randReadAoS(a, idx) {
  let acc = 0;
  for (let i = 0; i < idx.length; i++) { const r = a[idx[i]]; acc += r.end - r.start + r.kind; }
  return acc;
}
function randReadSoA(c, idx) {
  let acc = 0;
  const { start, end, kind } = c;
  for (let i = 0; i < idx.length; i++) { const j = idx[i]; acc += end[j] - start[j] + kind[j]; }
  return acc;
}
function writeAoS(a) {
  for (let i = 0; i < a.length; i++) { a[i].parent = i ^ 0x5f; }
  return a;
}
function writeSoA(c) {
  const p = c.parent;
  for (let i = 0; i < p.length; i++) { p[i] = i ^ 0x5f; }
  return c;
}

/* ============================================================== TREE LANES */

/*
 * The real shape: nodes with parent/child links. In AoS those are POINTERS
 * (and, as in jess's CST today, a per-node `children` ARRAY). In SoA they are
 * integer indices with no per-node array at all.
 *
 * Branching factor 4, so ~n nodes total. A flat-record benchmark that skips
 * pointer chasing overstates SoA, hence this section.
 */

const BRANCH = 4;

/* AoS tree WITH a per-node children array -- what jess's CST builds today. */
function buildTreeAoSArray(n) {
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = { kind: i & 31, start: i * 7, end: i * 7 + 5, parent: null, children: [] };
  }
  for (let i = 1; i < n; i++) {
    const p = nodes[(i - 1) / BRANCH | 0];
    nodes[i].parent = p;
    p.children.push(nodes[i]);
  }
  return nodes[0];
}

/* AoS tree with firstChild/nextSibling POINTERS -- no per-node array. */
function buildTreeAoSLinked(n) {
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = { kind: i & 31, start: i * 7, end: i * 7 + 5, parent: null, firstChild: null, nextSibling: null };
  }
  for (let i = n - 1; i >= 1; i--) {
    const node = nodes[i];
    const p = nodes[(i - 1) / BRANCH | 0];
    node.parent = p;
    node.nextSibling = p.firstChild;
    p.firstChild = node;
  }
  return nodes[0];
}

/* SoA tree: firstChild/nextSibling as Int32 INDICES. */
function buildTreeSoA(n) {
  const kind = new Int32Array(n);
  const start = new Int32Array(n);
  const end = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const firstChild = new Int32Array(n).fill(-1);
  const nextSibling = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    kind[i] = i & 31; start[i] = i * 7; end[i] = i * 7 + 5;
  }
  for (let i = n - 1; i >= 1; i--) {
    const p = (i - 1) / BRANCH | 0;
    parent[i] = p;
    nextSibling[i] = firstChild[p];
    firstChild[p] = i;
  }
  return { kind, start, end, parent, firstChild, nextSibling };
}

function walkTreeAoSArray(root) {
  let acc = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    acc += node.end - node.start + node.kind;
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) { stack.push(kids[i]); }
  }
  return acc;
}
function walkTreeAoSLinked(root) {
  let acc = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    acc += node.end - node.start + node.kind;
    for (let c = node.firstChild; c !== null; c = c.nextSibling) { stack.push(c); }
  }
  return acc;
}
function walkTreeSoA(c) {
  let acc = 0;
  const { kind, start, end, firstChild, nextSibling } = c;
  /* branch=4 -> max live stack is ~3*depth; 4096 is far beyond any depth here */
  const stack = new Int32Array(4096);
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    const i = stack[--sp];
    acc += end[i] - start[i] + kind[i];
    for (let ch = firstChild[i]; ch !== -1; ch = nextSibling[ch]) { stack[sp++] = ch; }
  }
  return acc;
}

/* ================================================== hidden-class witnesses */

/*
 * %HaveSameMap is only reachable when the process was started with
 * --allow-natives-syntax, and only as literal syntax -- hence the Function
 * constructor rather than a direct call.
 */
function nativeHaveSameMap() {
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('a', 'b', 'return %HaveSameMap(a, b);');
    f({ x: 1 }, { x: 1 });
    return f;
  } catch {
    return null;
  }
}

export function countMaps(objects, haveSameMap) {
  const reps = [];
  for (const o of objects) {
    if (!reps.some(r => haveSameMap(r, o))) { reps.push(o); }
  }
  return reps.length;
}

function shapeCensus() {
  const have = nativeHaveSameMap();
  if (!have) { return '(unavailable -- rerun with --allow-natives-syntax)'; }
  const report = (label, arr) => `${label}: ${countMaps(arr, have)} realized map(s)`;
  return [
    report('AoS mono            ', buildAoSMono(64)),
    report('AoS poly (3 paths)  ', buildAoSPoly(64)),
    report('AoS cond-spread     ', buildAoSSpread(64))
  ].join('\n  ');
}

/* ==================================================================== main */

function fmt(ms) { return ms.toFixed(3).padStart(9); }
function fmtPct(x) { return `+/-${(x * 100).toFixed(1)}%`.padStart(8); }
function mb(bytes) { return (bytes / 1048576).toFixed(2).padStart(8); }

function retained(build, n) {
  const before = retainedTotal();
  const held = build(n);
  const after = retainedTotal();
  const bytes = after - before;
  sink[0] = held;
  sink.length = 0;
  return bytes;
}

function measured(label, fn) {
  resetGcStats();
  const r = timeLane(fn);
  const gc = gcSnapshot();
  return { label, ...r, gc };
}

function printRows(title, rows) {
  console.log(`\n### ${title}`);
  console.log('  lane                          median(ms)   min(ms)    noise   majorGC  minorGC');
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(28)}${fmt(r.median)}${fmt(r.min)} ${fmtPct(r.spread)}  ${String(r.gc.majorCount).padStart(6)}   ${String(r.gc.minorCount).padStart(6)}`);
  }
}

function main() {
  const n = N_RECORDS;
  console.log(`node ${process.version}  records=${n.toLocaleString()}  warmup=${WARMUP}  samples=${SAMPLES}  median reported`);
  console.log(`  os.loadavg=${loadavg().map(x => x.toFixed(1)).join(' ')}`);
  console.log(`\n### realized hidden classes (%HaveSameMap over 64 constructions)`);
  console.log('  ' + shapeCensus());

  /* ---- CONSTRUCTION (includes the A/A noise-floor duplicate) */
  printRows('construction', [
    measured('AoS mono', () => buildAoSMono(n)),
    measured('AoS mono (A/A dup)', () => buildAoSMono(n)),
    measured('AoS poly (3 paths)', () => buildAoSPoly(n)),
    measured('AoS cond-spread', () => buildAoSSpread(n)),
    measured('SoA typed', () => buildSoATyped(n)),
    measured('SoA plain', () => buildSoAPlain(n)),
    measured('AoS hybrid (+string)', () => buildAoSHybrid(n)),
    measured('SoA hybrid (+string)', () => buildSoAHybrid(n))
  ]);

  /*
   * ---- The confound-breaking 2x2. Rows: 2 shapes via SPREAD vs via BRANCH.
   * If spread and branch cost the same, the earlier cond-spread result was
   * really about polymorphism; if they differ, it is the spread itself.
   */
  const kids = [{ _tag: 'leaf' }, { _tag: 'leaf' }, null];
  printRows('conditional spread vs branch (same 2 hidden classes)', [
    measured('6-field spread', () => buildAoSSpread(n)),
    measured('6-field spread (A/A)', () => buildAoSSpread(n)),
    measured('6-field 2-branch', () => buildAoSTwoBranch(n)),
    measured('cst replica: spread', () => buildCstReplicaSpread(n, kids)),
    measured('cst replica: 2-branch', () => buildCstReplicaBranch(n, kids))
  ]);

  /* ---- READ / WRITE over pre-built structures */
  const aosMono = buildAoSMono(n);
  const aosPoly = buildAoSPoly(n);
  const soaTyped = buildSoATyped(n);
  const soaPlain = buildSoAPlain(n);
  const idx = new Int32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; idx[i] = seed % n; }

  printRows('sequential read', [
    measured('AoS mono', () => seqReadAoS(aosMono)),
    measured('AoS mono (A/A dup)', () => seqReadAoS(aosMono)),
    measured('AoS poly', () => seqReadAoS(aosPoly)),
    measured('SoA typed', () => seqReadSoA(soaTyped)),
    measured('SoA plain', () => seqReadSoA(soaPlain))
  ]);

  printRows('random read', [
    measured('AoS mono', () => randReadAoS(aosMono, idx)),
    measured('AoS mono (A/A dup)', () => randReadAoS(aosMono, idx)),
    measured('AoS poly', () => randReadAoS(aosPoly, idx)),
    measured('SoA typed', () => randReadSoA(soaTyped, idx)),
    measured('SoA plain', () => randReadSoA(soaPlain, idx))
  ]);

  printRows('field write', [
    measured('AoS mono', () => writeAoS(aosMono)),
    measured('AoS mono (A/A dup)', () => writeAoS(aosMono)),
    measured('AoS poly', () => writeAoS(aosPoly)),
    measured('SoA typed', () => writeSoA(soaTyped)),
    measured('SoA plain', () => writeSoA(soaPlain))
  ]);

  /* ---- SPAN CARRIAGE (speaks to the in-flight inline-span decision) */
  const spanInline = buildSpanInline(n);
  const spanNested = buildSpanNested(n);
  const spanWeak = buildSpanWeakMap(n);
  const spanSoa = buildSpanSoA(n);

  printRows('span carriage: construction', [
    measured('inline start/end', () => buildSpanInline(n)),
    measured('inline start/end (A/A)', () => buildSpanInline(n)),
    measured('nested span object', () => buildSpanNested(n)),
    measured('WeakMap side-table', () => buildSpanWeakMap(n)),
    measured('SoA Int32 columns', () => buildSpanSoA(n))
  ]);

  printRows('span carriage: read start+end', [
    measured('inline start/end', () => readSpanInline(spanInline)),
    measured('inline start/end (A/A)', () => readSpanInline(spanInline)),
    measured('nested span object', () => readSpanNested(spanNested)),
    measured('WeakMap side-table', () => readSpanWeakMap(spanWeak)),
    measured('SoA Int32 columns', () => readSpanSoA(spanSoa))
  ]);

  /* ---- TREE (pointer chasing / index chasing) */
  const treeArr = buildTreeAoSArray(n);
  const treeLnk = buildTreeAoSLinked(n);
  const treeSoa = buildTreeSoA(n);

  printRows('tree construction', [
    measured('AoS + children[]', () => buildTreeAoSArray(n)),
    measured('AoS + children[] (A/A)', () => buildTreeAoSArray(n)),
    measured('AoS firstChild ptr', () => buildTreeAoSLinked(n)),
    measured('SoA firstChild idx', () => buildTreeSoA(n))
  ]);

  printRows('tree DFS walk', [
    measured('AoS + children[]', () => walkTreeAoSArray(treeArr)),
    measured('AoS + children[] (A/A)', () => walkTreeAoSArray(treeArr)),
    measured('AoS firstChild ptr', () => walkTreeAoSLinked(treeLnk)),
    measured('SoA firstChild idx', () => walkTreeSoA(treeSoa))
  ]);

  /* ---- RETAINED HEAP */
  console.log('\n### retained heap (heapUsed delta after forced GC, structure held live)');
  console.log('  lane                            MB      bytes/record');
  const heapLanes = [
    ['AoS mono', buildAoSMono],
    ['AoS poly (3 paths)', buildAoSPoly],
    ['AoS cond-spread', buildAoSSpread],
    ['SoA typed', buildSoATyped],
    ['SoA plain', buildSoAPlain],
    ['AoS hybrid (+string)', buildAoSHybrid],
    ['SoA hybrid (+string)', buildSoAHybrid],
    ['span inline start/end', buildSpanInline],
    ['span nested object', buildSpanNested],
    ['span WeakMap side-table', buildSpanWeakMap],
    ['span SoA Int32 columns', buildSpanSoA],
    ['cst replica: spread', m => buildCstReplicaSpread(m, [{ _tag: 'leaf' }, { _tag: 'leaf' }, null])],
    ['cst replica: 2-branch', m => buildCstReplicaBranch(m, [{ _tag: 'leaf' }, { _tag: 'leaf' }, null])],
    ['tree AoS + children[]', buildTreeAoSArray],
    ['tree AoS firstChild ptr', buildTreeAoSLinked],
    ['tree SoA firstChild idx', buildTreeSoA]
  ];
  for (const [label, build] of heapLanes) {
    const bytes = retained(build, n);
    console.log(`  ${label.padEnd(28)}${mb(bytes)}   ${(bytes / n).toFixed(1).padStart(8)}`);
  }

  sink[0] = [aosMono, aosPoly, soaTyped, soaPlain, treeArr, treeLnk, treeSoa];
  sink.length = 0;
}

main();
