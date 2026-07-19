import { describe, expect, it } from 'vitest';
import { isNode, type Node } from '../node.js';
import { selectorCapture } from '../nodes.js';

describe('AST node contract', () => {
  it('admits SelectorCapture through the exported Node union', () => {
    const capture: Node = selectorCapture(
      ['.primary', '.secondary'],
      '*[.primary, .secondary]'
    );

    expect(isNode(capture)).toBe(true);
  });
});
