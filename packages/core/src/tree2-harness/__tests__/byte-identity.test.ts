import { describe, it, expect } from 'vitest';
import { allShapes as shapes, renderOld, renderNewFast, renderNewTracked } from '../shapes.js';
import { buildFlatNew, buildFlatOld, buildCompNew, buildCompOld } from '../generate.js';

/**
 * Triple byte-identity: for every rung, the clean-room tree2 serializer (both
 * the fast path AND the tracked/sourcemap path) must produce bytes identical to
 * the legacy renderer's output AND to the expected literal CSS. The legacy
 * output is the correctness oracle for the bytes.
 */
describe('tree2 vs tree — byte identity', () => {
  for (const shape of shapes) {
    describe(shape.name, () => {
      it('tree (legacy) === expected literal', () => {
        expect(renderOld(shape.buildOld())).toBe(shape.expected);
      });
      it('tree2 fast path === expected literal', () => {
        expect(renderNewFast(shape.buildNew())).toBe(shape.expected);
      });
      it('tree2 tracked path === expected literal', () => {
        expect(renderNewTracked(shape.buildNew())).toBe(shape.expected);
      });
      it('tree2 fast === tree2 tracked === tree', () => {
        const tree = renderOld(shape.buildOld());
        const fast = renderNewFast(shape.buildNew());
        const tracked = renderNewTracked(shape.buildNew());
        expect(fast).toBe(tree);
        expect(tracked).toBe(tree);
      });
    });
  }
});

/**
 * The at-scale generators (small instances) must also be byte-identical, so the
 * perf race compares like-for-like. tree = oracle.
 */
describe('tree2 vs tree — scale generators (byte identity)', () => {
  it('flat generator', () => {
    const oracle = renderOld(buildFlatOld(4));
    expect(renderNewFast(buildFlatNew(4))).toBe(oracle);
    expect(renderNewTracked(buildFlatNew(4))).toBe(oracle);
  });
  it('composition-heavy generator', () => {
    const oracle = renderOld(buildCompOld(3));
    expect(renderNewFast(buildCompNew(3))).toBe(oracle);
    expect(renderNewTracked(buildCompNew(3))).toBe(oracle);
  });
});
