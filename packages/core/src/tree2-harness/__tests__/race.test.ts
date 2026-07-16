import { describe, it, expect } from 'vitest';
import { renderOld, renderNewFast, renderNewTracked, withLegacyOpCounters } from '../shapes.js';
import {
  buildFlatNew,
  buildFlatOld,
  buildCompNew,
  buildCompOld,
  buildMixinNew,
  buildMixinOld,
  countNodesNew,
} from '../generate.js';
import * as t2 from '../../tree2/index.js';

/**
 * AT-SCALE race (~10k+ node stylesheets). BOTH sides now do eval: tree2 PRODUCES
 * compositions during its eval+emit walk (canonical body + placement overlay,
 * no clone); legacy runs its full resolve/render. So this is a fair fight for
 * the decisive question — can tree2 produce the compositions cheaply?
 *
 * Three variants: flat, composition-heavy (static nesting), and mixin-heavy
 * (one canonical mixin body called under N distinct parents — the benchmark's
 * ~70k-composition pattern). Legacy render is ASYNC for mixins (part of its real
 * cost), so legacy totals are measured async; tree2 is sync.
 *
 * Lanes: tree2 no-tracking, tree2 with-tracking, tree(legacy). Reports total
 * build->CSS ms, creation ms, peak-ish heap MB, and composition-op counts
 * (tree2 compositions vs legacy clone/inherit/withComponents).
 *
 * STILL SYNTHETIC — real benchmark.less is a later gate. Gated behind
 * TREE2_RACE=1; run with `--expose-gc` for memory.
 */

const ENABLED = process.env.TREE2_RACE === '1';
const race = ENABLED ? it : it.skip;

const FLAT_RULES = 3200;
const COMP_BLOCKS = 850;
const MIXIN_CALLS = 1200; // 1200 placements x 2 compositions = 2400 compositions
const WARMUP = 3;
const RUNS = 9;

const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function timeSync(fn: () => void): number {
  for (let w = 0; w < WARMUP; w++) fn();
  const s: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    fn();
    s.push(performance.now() - t0);
  }
  return median(s);
}
async function timeAsync(fn: () => Promise<void>): Promise<number> {
  for (let w = 0; w < WARMUP; w++) await fn();
  const s: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    await fn();
    s.push(performance.now() - t0);
  }
  return median(s);
}
function heapMB(fn: () => unknown): number {
  gc?.();
  const before = process.memoryUsage().heapUsed;
  const held = fn();
  const after = process.memoryUsage().heapUsed;
  void held;
  return (after - before) / (1024 * 1024);
}
async function heapMBAsync(fn: () => Promise<unknown>): Promise<number> {
  gc?.();
  const before = process.memoryUsage().heapUsed;
  const held = await fn();
  const after = process.memoryUsage().heapUsed;
  void held;
  return (after - before) / (1024 * 1024);
}
const ms = (x: number): string => x.toFixed(3);

interface Variant {
  name: string;
  buildNew: () => t2.Root;
  buildOld: () => unknown;
  ops: boolean;
}

const variants: Variant[] = [
  { name: `flat (${FLAT_RULES} rules)`, buildNew: () => buildFlatNew(FLAT_RULES), buildOld: () => buildFlatOld(FLAT_RULES), ops: false },
  { name: `composition (${COMP_BLOCKS} blocks)`, buildNew: () => buildCompNew(COMP_BLOCKS), buildOld: () => buildCompOld(COMP_BLOCKS), ops: true },
  { name: `mixin-heavy (${MIXIN_CALLS} calls)`, buildNew: () => buildMixinNew(MIXIN_CALLS), buildOld: () => buildMixinOld(MIXIN_CALLS), ops: true },
];

describe('tree2 vs tree — at-scale eval race', () => {
  race('build + eval + serialize, three lanes', async () => {
    const out: string[] = [];
    out.push('');
    out.push(`AT-SCALE eval race — warmup=${WARMUP}, runs=${RUNS} (median), gc=${gc ? 'on' : 'off'} [SYNTHETIC]`);

    for (const v of variants) {
      // --- byte-identity (tree = oracle) -----------------------------------
      const oracle = await renderOld(v.buildOld());
      expect(renderNewFast(v.buildNew()), `${v.name} t2-fast bytes`).toBe(oracle);
      expect(renderNewTracked(v.buildNew()), `${v.name} t2-tracked bytes`).toBe(oracle);
      const nodeCount = countNodesNew(v.buildNew());

      // --- timings ----------------------------------------------------------
      const t2Create = timeSync(() => {
        v.buildNew();
      });
      const lgCreate = timeSync(() => {
        v.buildOld();
      });
      const t2Total = timeSync(() => {
        renderNewFast(v.buildNew());
      });
      const t2TotalTrack = timeSync(() => {
        renderNewTracked(v.buildNew());
      });
      const lgTotal = await timeAsync(async () => {
        await renderOld(v.buildOld());
      });

      // --- memory ----------------------------------------------------------
      const t2AstMB = heapMB(() => v.buildNew());
      const lgAstMB = heapMB(() => v.buildOld());
      const t2SerMB = heapMB(() => renderNewFast(v.buildNew()).length);
      const lgTotalMB = await heapMBAsync(async () => (await renderOld(v.buildOld())).length);

      out.push('');
      out.push(`### ${v.name} — tree2 nodes=${nodeCount}, output bytes=${oracle.length}`);
      out.push('  phase          tree2-fast   tree2-track  tree(legacy)  |  heap MB t2/legacy');
      out.push(`  creation       ${ms(t2Create).padStart(9)}    ${'—'.padStart(9)}    ${ms(lgCreate).padStart(9)}  |  AST ${t2AstMB.toFixed(2)} / ${lgAstMB.toFixed(2)}`);
      out.push(`  total(b+e+s)   ${ms(t2Total).padStart(9)}    ${ms(t2TotalTrack).padStart(9)}    ${ms(lgTotal).padStart(9)}  |  ser/total ${t2SerMB.toFixed(2)} / ${lgTotalMB.toFixed(2)}`);
      out.push(`                 => legacy/tree2 total = ${(lgTotal / t2Total).toFixed(1)}x`);

      // --- composition-op counts (scale indicator) -------------------------
      if (v.ops) {
        const t2c = t2.composeStats(v.buildNew());
        const lg = await withLegacyOpCounters(async () => {
          await renderOld(v.buildOld());
        });
        const lgOps = lg.cloneForPlacement + lg.inherit + lg.withComponents;
        out.push(
          `  ops/render     tree2 compose/alloc/distinct = ${t2c.composeOps}/${t2c.selectorAllocs}/${t2c.distinctSelectors}` +
            `   |  legacy clone/inherit/withComponents = ${lg.cloneForPlacement}/${lg.inherit}/${lg.withComponents}`,
        );
        out.push(
          `                 => per composition: tree2 ~1 string op; legacy ~${(lgOps / Math.max(1, t2c.composeOps)).toFixed(1)} node ops`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }, 300_000);
});
