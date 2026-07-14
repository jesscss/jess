// Dynamic heap census: snapshot the LIVE post-eval tree of the mixin/ref/extend
// workload, count tree-node instances by constructor, compute avg self-size.
// Usage: node --expose-gc packages/core/perf/heap/dyn-census.mjs
import { Compiler } from '../../../jess/lib/index.js';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { writeHeapSnapshot } from 'node:v8';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Extend/mixin/ref-heavy source (adds Extend + Reference surface the dyn-bench lacks).
let src = `@base: 10px; @c1: #336699; @c2: #99ccff;
.mx(@n,@col) when (@n>0){ pad-@{n}:(@n*@base); color:lighten(@col,(@n*2%)); .inner{ margin:(@base+@n); border-color:darken(@col,5%);} }
.theme { color: red; background: white; }
.pill { border-radius: 4px; }
`;
for (let i = 1; i <= 1200; i++) {
  src += `.block-${i}{ .mx(${i % 20 + 1},@c${(i % 2) + 1}); &:extend(.theme); width:(@base*${i % 10 + 1}); color:mix(@c1,@c2,${i % 100}%);}\n`;
  if (i % 3 === 0) {
    src += `.pill-${i}:extend(.pill all){ padding: ${i % 5}px; }\n`;
  }
}
const p = join(here, 'dyn-census.less');
writeFileSync(p, src);

// Hold the live tree in scope so the snapshot captures it.
const { tree, context } = await new Compiler().compile(p, { output: { collapseNesting: false } });

// Constructor names are minified in the production bundle. Keep a live-tree
// census keyed by Jess's stable node discriminant so this script remains useful
// after bundling; the constructor-labeled heap table below is historical when
// run against a minified bundle.
const liveByType = new Map();
const liveSeen = new Set();
function censusLiveNode(value) {
  if (!value || typeof value !== 'object' || liveSeen.has(value)) {
    return;
  }
  liveSeen.add(value);
  if (value._tag === 'node' && typeof value.type === 'string') {
    const row = liveByType.get(value.type) ?? { count: 0, ownKeys: 0 };
    row.count++;
    row.ownKeys += Object.keys(value).length;
    liveByType.set(value.type, row);
  }
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        censusLiveNode(item);
      }
    } else {
      censusLiveNode(child);
    }
  }
}
censusLiveNode(tree);
console.log('Live node shape census (stable type / own enumerable keys):');
console.log('| type | count | avg own keys |');
console.log('|---|---:|---:|');
for (const [type, row] of [...liveByType.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`| ${type} | ${row.count} | ${(row.ownKeys / row.count).toFixed(1)} |`);
}

if (global.gc) {
  global.gc();
  global.gc();
}

const snapPath = join(here, 'dyn-census.heapsnapshot');
writeHeapSnapshot(snapPath);

// Keep references live past the snapshot.
globalThis.__keep = { tree, context };

// ---- Parse the snapshot: count instances by constructor name, sum self_size ----
const raw = JSON.parse(readFileSync(snapPath, 'utf8'));
const { snapshot, nodes, strings } = raw;
const fields = snapshot.meta.node_fields;
const types = snapshot.meta.node_types[fields.indexOf('type')];
const NF = fields.length;
const TYPE = fields.indexOf('type');
const NAME = fields.indexOf('name');
const SELF = fields.indexOf('self_size');

const byClass = new Map(); // name -> {count, bytes}
for (let i = 0; i < nodes.length; i += NF) {
  const typeIdx = nodes[i + TYPE];
  if (types[typeIdx] !== 'object') {
    continue;
  }
  const name = strings[nodes[i + NAME]];
  const self = nodes[i + SELF];
  let e = byClass.get(name);
  if (!e) {
    e = { count: 0, bytes: 0 };
    byClass.set(name, e);
  }
  e.count++;
  e.bytes += self;
}

// Tree node class names of interest (constructors in packages/core/src/tree).
const TREE = new Set([
  'Ruleset', 'Rules', 'Declaration', 'DeclarationCustom', 'VarDeclaration', 'Dimension',
  'CompoundSelector', 'ComplexSelector', 'SelectorList', 'Color', 'Ampersand',
  'PseudoSelector', 'BasicSelector', 'SimpleSelector', 'InterpolatedSelector', 'AttrSelector',
  'CaptureSelector', 'Combinator', 'Selector', 'Extend', 'ExtendList', 'Reference', 'Mixin',
  'Call', 'Function', 'Expression', 'Operation', 'List', 'Paren', 'Quoted', 'Anonymous', 'Any',
  'Comment', 'AtRule', 'AtRuleStatement', 'Number', 'Bool', 'Nil', 'Negative', 'Range',
  'Condition', 'QueryCondition', 'Control', 'Interpolated', 'Sequence', 'Stylesheet',
  'Block', 'Collection', 'ScopeFrame', 'Rest', 'DefaultGuard', 'Value', 'Node'
]);

const rows = [...byClass.entries()]
  .filter(([n]) => TREE.has(n))
  .map(([name, e]) => ({ name, count: e.count, avg: e.bytes / e.count, total: e.bytes }))
  .sort((a, b) => b.total - a.total);

const fmt = b => b >= 1e6 ? (b / 1e6).toFixed(2) + 'MB' : b >= 1e3 ? (b / 1e3).toFixed(1) + 'KB' : b + 'B';
let totNodes = 0, totBytes = 0;
console.log('Historical constructor-labeled heap table:');
console.log('| class | count | avg bytes | total |');
console.log('|---|--:|--:|--:|');
for (const r of rows) {
  totNodes += r.count;
  totBytes += r.total;
  console.log(`| ${r.name} | ${r.count} | ${Math.round(r.avg)} | ${fmt(r.total)} |`);
}
console.log(`\nTOTAL tree nodes: ${totNodes}, ${fmt(totBytes)}`);

// cleanup
try {
  unlinkSync(snapPath);
} catch {}
try {
  unlinkSync(p);
} catch {}
