// Reference kind census: count LIVE post-eval Reference instances by kind
// (options.type) and disjoint-field presence (target/rawKey/_rulesLookupHandle).
// Sets the ceiling for a slim: a variable-ref-only slim only pays if variable
// refs are the bulk. Usage: node packages/core/perf/heap/kind-census.mjs
import { Compiler } from '../../../jess/lib/index.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
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
const p = join(here, 'kind-census.less');
writeFileSync(p, src);
const { tree } = await new Compiler().compile(p, { output: { collapseNesting: false } });
const kinds = new Map();
const fieldPresence = { target: 0, rawKey: 0, _rulesLookupHandle: 0, total: 0 };
const seen = new Set();
function walk(n) {
  if (!n || typeof n !== 'object' || seen.has(n)) {
    return;
  }
  seen.add(n);
  if (n.constructor && n.constructor.name === 'Reference') {
    const t = n.options?.type ?? 'variable(undefined)';
    kinds.set(t, (kinds.get(t) || 0) + 1);
    fieldPresence.total++;
    if (n.target !== undefined) {
      fieldPresence.target++;
    }
    if (n.rawKey !== undefined) {
      fieldPresence.rawKey++;
    }
    if (n._rulesLookupHandle !== undefined) {
      fieldPresence._rulesLookupHandle++;
    }
  }
  for (const k in n) {
    const v = n[k];
    if (Array.isArray(v)) {
      for (const x of v) {
        walk(x);
      }
    } else if (v && typeof v === 'object') {
      walk(v);
    }
  }
}
walk(tree);
console.log('Reference kind distribution (live post-eval tree):');
for (const [k, c] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${c}`);
}
console.log('Field presence:', JSON.stringify(fieldPresence));
try {
  unlinkSync(p);
} catch {}
