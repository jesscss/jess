/**
 * The exact half of the answer: `count x added_slots x bytes_per_slot`.
 *
 * `bytes_per_slot` is MEASURED by `slotsize.mjs`, not assumed — V8 pointer
 * compression is OFF in the official Node builds this repo runs on, so an
 * in-object slot is 8 bytes, not the 4 a compressed heap would give.
 *
 * The slot counts below are VERIFIED against both built libs by
 * `variantguard.mjs`; they are not read off the source.
 *
 * These value objects are TRANSIENT — the compiled document retains only the
 * 2-key AST `Color`/`Dimension` nodes, never the value-domain objects — so this
 * total is added ALLOCATION CHURN across a compile, not added peak retained heap.
 *
 *   node packages/core/perf/value-shape/memory.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BYTES_PER_SLOT = 8;
const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(here, 'results');

/** In-object slot count with every field written unconditionally. */
const UNIFIED = {
  makeColorRgb: 11, makeColorHsl: 11, makeCollection: 4, makeBlock: 5, makeCompoundDimension: 7
};

/** Slot count of the conditional literal BEFORE any conditional field is added. */
const COND_BASE = {
  makeColorRgb: 5, makeColorHsl: 6, makeCollection: 3, makeBlock: 4, makeCompoundDimension: 6
};

const workloads = ['bootstrap', 'benchmark', 'less-corpus', 'chunk-jess', 'scss-corpus', 'colorspellings'];
const totals = {};

for (const w of workloads) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(RESULTS, `census-${w}.json`), 'utf8'));
  } catch {
    continue;
  }
  console.log(`\n=== ${w} (${data.ok} file(s) compiled, ${data.outBytes} B CSS) ===`);
  console.log('factory                  count   maps   added slots    added bytes');
  let wTotal = 0;
  for (const f of Object.keys(UNIFIED)) {
    const c = data.counts[f];
    if (!c) {
      console.log(`${f.padEnd(23)} ${'0'.padStart(6)}      0              0              0 B`);
      totals[f] ??= 0;
      continue;
    }
    let slots = 0;
    for (const [combo, n] of Object.entries(c.combos)) {
      const present = combo === '-' ? 0 : combo.split('+').length;
      slots += n * (UNIFIED[f] - (COND_BASE[f] + present));
    }
    const bytes = slots * BYTES_PER_SLOT;
    wTotal += bytes;
    totals[f] = (totals[f] ?? 0) + bytes;
    console.log(
      `${f.padEnd(23)} ${String(c.total).padStart(6)}   ${String(c.mapsObserved).padStart(4)}   `
      + `${String(slots).padStart(11)}   ${String(bytes).padStart(12)} B  (${(bytes / 1024).toFixed(1)} KB)`
    );
  }
  console.log(`${'TOTAL'.padEnd(23)} ${' '.repeat(20)}${String(wTotal).padStart(11)} B  (${(wTotal / 1024).toFixed(1)} KB)`);
}

console.log('\n=== added allocation churn per factory, summed over all workloads ===');
for (const [f, b] of Object.entries(totals).sort((a, b2) => b2[1] - a[1])) {
  console.log(`${f.padEnd(23)} ${(b / 1024).toFixed(1)} KB`);
}
