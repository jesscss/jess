import { describe, expect, it } from 'vitest';
import { Any, Dimension, shouldOperateWithMathFrames } from '../src/index.js';

describe('shouldOperateWithMathFrames', () => {
  const baseState = {
    parenFrames: [],
    calcFrames: 0
  } as const;

  it('preserves slash syntax for Any operands even in always mode', () => {
    const left = new Any('small', { role: 'keyword' });
    const right = new Dimension({ number: 20, unit: 'px' });

    expect(shouldOperateWithMathFrames({
      ...baseState,
      mathMode: 'always'
    }, '/', left, right)).toBe(false);
  });

  it('still allows numeric division in always mode', () => {
    const left = new Dimension({ number: 20, unit: '' });
    const right = new Dimension({ number: 5, unit: '' });

    expect(shouldOperateWithMathFrames({
      ...baseState,
      mathMode: 'always'
    }, '/', left, right)).toBe(true);
  });
});
