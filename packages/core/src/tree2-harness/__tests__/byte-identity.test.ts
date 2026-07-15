import { describe, it, expect } from 'vitest';
import { shapes, renderOld, renderNewFast, renderNewTracked } from '../shapes.js';

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
