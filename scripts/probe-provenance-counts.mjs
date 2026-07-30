/*
 * PROBE (branch `provenance-span-investigation`, not for landing).
 *
 * Counts provenance side-map calls and WeakMap entry creations per render on
 * the exact PostCSS-derived Less workload used by the CPU profile. Counts have
 * no noise floor and no denominator, so they answer "did absolute work grow?"
 * in a way that share-of-profile cannot.
 *
 *   JESS_PROVENANCE_PROBE=1 node scripts/probe-provenance-counts.mjs \
 *     --upstream=/tmp/postcss-benchmark --renders=1
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Compiler } from '../packages/jess/lib/index.js';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find(value => value.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const upstreamRoot = resolve(arg('upstream', '/tmp/postcss-benchmark'));
const renders = Number(arg('renders', '1'));

/* Same derivation as packages/jess/benchmark/postcss-preprocessors.mjs. */
const origin = readFileSync(join(upstreamRoot, 'cache', 'bootstrap.css'), 'utf8');
const css = origin
  .replace(/\s+filter:[^;}]+;?/g, '')
  .replace('/*# sourceMappingURL=bootstrap.css.map */', '');
let lessSource = css.replace(/--[-\w]+:\s*;/g, '');
lessSource += '\n@size: 100px;\n';
lessSource += '.icon() { width: 16px; height: 16px; }\n';
for (let i = 0; i < 100; i++) {
  lessSource += '\nbody { h1 { a { color: black; } } }\n';
  lessSource += 'h2 { width: @size; }\n';
  lessSource += '.search { fill: black; .icon(); }\n';
}

console.log(`source bytes: ${Buffer.byteLength(lessSource)}`);
console.log(`renders: ${renders}`);

const report = globalThis[Symbol.for('jess.ast.provenance-probe')];
if (typeof report !== 'function') {
  console.error('PROBE NOT ACTIVE: rebuild core with the probe and set JESS_PROVENANCE_PROBE=1');
  process.exit(1);
}

const compiler = new Compiler({
  suppressWarnings: true,
  output: { collapseNesting: true }
});
for (let i = 0; i < renders; i++) {
  await compiler.renderString(lessSource, {
    filePath: 'postcss-preprocessors.less',
    extension: '.less',
    config: { suppressWarnings: true }
  });
}

const rows = report();
const totals = new Map();
for (const row of rows) {
  const t = totals.get(row.family) ?? { writes: 0, newEntries: 0, reads: 0, readHits: 0 };
  t.writes += row.writes;
  t.newEntries += row.newEntries;
  t.reads += row.reads;
  t.readHits += row.readHits;
  totals.set(row.family, t);
}

const per = n => (n / renders).toFixed(1);
console.log('\n=== FAMILY TOTALS (per render) ===');
console.log('family        writes  newEntries  reads  readHits');
let grandWrites = 0;
let grandReads = 0;
for (const [family, t] of totals) {
  grandWrites += t.writes;
  grandReads += t.reads;
  console.log(
    `${family.padEnd(13)} ${per(t.writes).padStart(7)} ${per(t.newEntries).padStart(11)}`
    + ` ${per(t.reads).padStart(6)} ${per(t.readHits).padStart(9)}`
  );
}
console.log(`TOTAL calls/render: ${per(grandWrites + grandReads)}`
  + ` (writes ${per(grandWrites)}, reads ${per(grandReads)})`);

console.log('\n=== PER NODE KIND (per render, writes desc) ===');
console.log('family        kind                      writes  newEntries   reads  readHits  read/write');
const sorted = rows.slice().sort((a, b) => b.writes - a.writes);
for (const row of sorted) {
  if (row.writes === 0 && row.reads === 0) {
    continue;
  }
  const ratio = row.writes === 0 ? '-' : (row.readHits / row.writes).toFixed(2);
  console.log(
    `${row.family.padEnd(13)} ${String(row.kind).padEnd(25)}`
    + ` ${per(row.writes).padStart(6)} ${per(row.newEntries).padStart(11)}`
    + ` ${per(row.reads).padStart(7)} ${per(row.readHits).padStart(9)} ${ratio.padStart(11)}`
  );
}
