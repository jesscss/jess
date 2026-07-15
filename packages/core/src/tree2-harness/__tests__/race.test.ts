import { describe, it, expect } from 'vitest';
import { shapes, renderOld, renderNewFast, renderNewTracked, type Shape } from '../shapes.js';

/**
 * Per-shape head-to-head race: build+serialize, three lanes.
 *   - tree2 (no tracking)   — the fast path (primary result)
 *   - tree2 (with tracking) — the optional sourcemap feature
 *   - tree (legacy)         — however the legacy renderer does it
 *
 * Reports median wall-clock AND an allocation/GC proxy for each lane. Byte
 * identity is asserted before any timing is reported. Gated behind TREE2_RACE=1
 * so it does not run in the normal suite; run with `--expose-gc` for the
 * memory numbers (falls back gracefully without it).
 *
 * Protocol: warmup >= 10 batches, N >= 21 samples, median of per-render time.
 */

const ENABLED = process.env.TREE2_RACE === '1';
const race = ENABLED ? it : it.skip;

const WARMUP_BATCHES = 12;
const SAMPLES = 25; // N
const BATCH = 4000; // renders per timed sample
const MEM_BATCH = 50_000; // renders for the allocation proxy

const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

interface Lane {
  label: string;
  run: (shape: Shape) => string; // one build+serialize, returns the css
}

const lanes: Lane[] = [
  { label: 'tree2 (no tracking)', run: (s) => renderNewFast(s.buildNew()) },
  { label: 'tree2 (with tracking)', run: (s) => renderNewTracked(s.buildNew()) },
  { label: 'tree (legacy)', run: (s) => renderOld(s.buildOld()) },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median per-render time in ms over N batched samples. */
function timePerRenderMs(fn: () => void): number {
  for (let w = 0; w < WARMUP_BATCHES; w++) {
    for (let i = 0; i < BATCH; i++) fn();
  }
  const samples: number[] = [];
  for (let n = 0; n < SAMPLES; n++) {
    const t0 = performance.now();
    for (let i = 0; i < BATCH; i++) fn();
    const t1 = performance.now();
    samples.push((t1 - t0) / BATCH);
  }
  return median(samples);
}

/** Allocation proxy: net heapUsed growth per render over a large batch (bytes). */
function allocPerRenderBytes(fn: () => void): number {
  gc?.();
  const before = process.memoryUsage().heapUsed;
  let sink = 0;
  for (let i = 0; i < MEM_BATCH; i++) {
    // Touch the result so the call is not optimized away.
    sink += fn() as unknown as number;
  }
  const after = process.memoryUsage().heapUsed;
  void sink;
  return (after - before) / MEM_BATCH;
}

describe('tree2 vs tree — race', () => {
  race('build+serialize race (median ms + alloc proxy)', () => {
    const rows: Array<{
      rung: string;
      lane: string;
      medMs: number;
      allocBytes: number;
    }> = [];

    for (const shape of shapes) {
      // Correctness gate first.
      const oracle = renderOld(shape.buildOld());
      expect(oracle).toBe(shape.expected);
      for (const lane of lanes) {
        expect(lane.run(shape)).toBe(oracle);
      }

      for (const lane of lanes) {
        const fn = (): void => {
          lane.run(shape);
        };
        const medMs = timePerRenderMs(fn);
        // allocPerRenderBytes needs a value-returning fn; wrap to return length.
        const allocBytes = allocPerRenderBytes(() => lane.run(shape).length as unknown as void);
        rows.push({ rung: shape.name, lane: lane.label, medMs, allocBytes });
      }
    }

    // Emit the which-wins table.
    const lines: string[] = [];
    lines.push('');
    lines.push(`tree2 race — warmup=${WARMUP_BATCHES} batches, N=${SAMPLES} samples, batch=${BATCH}, gc=${gc ? 'on' : 'off'}`);
    for (const shape of shapes) {
      const group = rows.filter((r) => r.rung === shape.name);
      const best = Math.min(...group.map((r) => r.medMs));
      lines.push('');
      lines.push(shape.name);
      lines.push('  lane                     median ms/render   x-vs-fastest   alloc proxy B/render');
      for (const r of group) {
        const ratio = (r.medMs / best).toFixed(2);
        const win = r.medMs === best ? '  <= fastest' : '';
        lines.push(
          `  ${r.lane.padEnd(24)} ${r.medMs.toExponential(3).padStart(12)}   ${ratio.padStart(6)}x       ${r.allocBytes.toFixed(1).padStart(8)}${win}`,
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  });
});
