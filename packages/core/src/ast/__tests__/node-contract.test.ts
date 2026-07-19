import { describe, expect, it } from 'vitest';
import { isNode, selectorCapture, type Node } from '../index.js';

describe('AST node contract', () => {
  it('admits SelectorCapture through the exported Node union', () => {
    const capture: Node = selectorCapture(
      ['.primary', '.secondary'],
      '*[.primary, .secondary]'
    );

    expect(isNode(capture)).toBe(true);
  });
});
