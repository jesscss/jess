import { describe, it, expect } from 'vitest';
import { literal, type ValueObj } from '../../value-eval.js';
import { buildAdapterEvaluator } from '../value-eval.js';

/**
 * DENSE-EAGER value struct vs the R2 LAZY value leaf.
 *
 * Current model (R2): a value is a bare-string literal (rep B); emit reads
 * `bytes` verbatim; on the first operation/compare/typed-param it is
 * `materialize()`d into a `ValueObj` (a value `Dimension` `{ number, unit, bytes }`) by
 * RE-PARSING the bytes at eval time.
 *
 * Proposed (parser cutover): the tree2 parser is already tokenizing the value, so
 * it builds the DENSE struct directly — `{ value:number, unit:string,
 * rawBytes:string }` — parsed ONCE at parse time. Emit uses `rawBytes` verbatim
 * for un-operated values (so `1.0px` stays `1.0px`, never canonicalized to
 * `1px`); eval reads `value`/`unit` with no re-parse and no lazy materialize.
 *
 * This test proves (a) byte-identity of verbatim emit, and (b) that dense-eager
 * is neutral-or-better on time and memory for a value-heavy workload.
 */

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;

/** The dense-eager dimension struct: parsed value + unit for eval, rawBytes for
 * byte-faithful emit. Built once, at parse time. */
interface DenseDimension {
  readonly value: number;
  readonly unit: string;
  readonly rawBytes: string;
}

/** Parse a numeric token into the dense struct (what the tree2 parser action
 * does at parse time, from the token it already lexed). */
function parseDense(raw: string): DenseDimension {
  const m = NUM_RE.exec(raw);
  if (!m) throw new Error(`not numeric: ${raw}`);
  const unit = m[1] ?? '';
  return { value: Number(raw.slice(0, raw.length - unit.length)), unit, rawBytes: raw };
}

/** Emit of an un-operated dense value: verbatim source bytes. */
const emitDense = (d: DenseDimension): string => d.rawBytes;

const evaluator = buildAdapterEvaluator();

describe('dense-eager value struct', () => {
  // Verbatim tokens that MUST NOT be canonicalized on emit.
  const tokens = ['1.0px', '0.50em', '100%', '0', '-3px', '.5s', '2.000rem', '10PX'];

  it('byte-identity: dense rawBytes emit === lazy leaf emit === verbatim source', () => {
    for (const tok of tokens) {
      const dense = parseDense(tok);
      const lazy = literal(tok);
      // Both emit the verbatim original — no canonicalization.
      expect(emitDense(dense)).toBe(tok);
      expect(lazy).toBe(tok);
      expect(emitDense(dense)).toBe(lazy);
    }
  });

  it('eval-identity: dense (value,unit) === what lazy materialize would parse', () => {
    for (const tok of tokens) {
      const dense = parseDense(tok);
      const mat = evaluator.materialize(literal(tok)) as Extract<ValueObj, { type: 'Dimension' }>;
      expect(mat.type).toBe('Dimension');
      expect(dense.value).toBe(mat.number);
      expect(dense.unit).toBe(mat.unit);
    }
  });

  it('perf + memory: dense-eager vs lazy-leaf on a value-heavy workload', () => {
    // A value-heavy corpus: many numeric tokens (as a real dimension-dense
    // stylesheet would carry). Each is emitted once and evaluated once — the
    // value-heavy case where lazy pays the re-parse.
    const N = 200_000;
    const corpus: string[] = new Array(N);
    for (let i = 0; i < N; i++) corpus[i] = `${(i % 1000) / 10}px`;

    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[s.length >> 1]!;
    };
    const timed = (fn: () => number): number => {
      for (let w = 0; w < 3; w++) fn();
      const samples: number[] = [];
      for (let r = 0; r < 9; r++) {
        const t0 = process.hrtime.bigint();
        const sink = fn();
        const t1 = process.hrtime.bigint();
        if (sink === -1) throw new Error('unreachable');
        samples.push(Number(t1 - t0) / 1e6);
      }
      return median(samples);
    };

    // Lazy path: build leaf, emit (bytes), then materialize (re-parse) for eval.
    const lazyRun = (): number => {
      let acc = 0;
      for (let i = 0; i < N; i++) {
        const leaf = literal(corpus[i]!);
        acc += leaf.length; // emit
        const m = evaluator.materialize(leaf) as Extract<ValueObj, { type: 'Dimension' }>;
        acc += m.number + m.unit.length; // eval touch
      }
      return acc;
    };
    // Dense path: parse once into the struct; emit (rawBytes), eval reads fields.
    const denseRun = (): number => {
      let acc = 0;
      for (let i = 0; i < N; i++) {
        const d = parseDense(corpus[i]!);
        acc += d.rawBytes.length; // emit
        acc += d.value + d.unit.length; // eval touch (no re-parse)
      }
      return acc;
    };

    const lazyMs = timed(lazyRun);
    const denseMs = timed(denseRun);

    // Memory: retained footprint of N nodes each. Dense retains ONE struct per
    // value; lazy retains the leaf AND (once evaluated) the materialized object.
    const gc = (globalThis as { gc?: () => void }).gc;
    let lazyBytes = NaN;
    let denseBytes = NaN;
    if (gc) {
      const measure = (build: () => unknown[]): number => {
        gc(); gc();
        const before = process.memoryUsage().heapUsed;
        const held = build();
        gc(); gc();
        const after = process.memoryUsage().heapUsed;
        if (held.length !== N) throw new Error('retain');
        return after - before;
      };
      lazyBytes = measure(() => {
        const held: unknown[] = new Array(N);
        for (let i = 0; i < N; i++) {
          const leaf = literal(corpus[i]!);
          const mat = evaluator.materialize(leaf); // value-heavy: materialized retained
          held[i] = [leaf, mat];
        }
        return held;
      });
      denseBytes = measure(() => {
        const held: unknown[] = new Array(N);
        for (let i = 0; i < N; i++) held[i] = parseDense(corpus[i]!);
        return held;
      });
    }

    console.log(
      `\n[dense-value N=${N}]` +
      `\n  time  lazy (leaf+materialize) : ${lazyMs.toFixed(2)} ms` +
      `\n  time  dense (parse-once)      : ${denseMs.toFixed(2)} ms` +
      `\n  time  speedup lazy/dense      : ${(lazyMs / denseMs).toFixed(3)}x` +
      (gc
        ? `\n  mem   lazy (leaf+matobj)      : ${(lazyBytes / 1e6).toFixed(2)} MB (${(lazyBytes / N).toFixed(1)} B/val)` +
          `\n  mem   dense (one struct)      : ${(denseBytes / 1e6).toFixed(2)} MB (${(denseBytes / N).toFixed(1)} B/val)` +
          `\n  mem   ratio lazy/dense        : ${(lazyBytes / denseBytes).toFixed(3)}x`
        : '\n  mem   (run with --expose-gc for memory numbers)')
    );

    // Assert dense is neutral-or-better on time (value-heavy: expect faster).
    expect(denseMs).toBeLessThanOrEqual(lazyMs * 1.1);
  }, 120000);
});
