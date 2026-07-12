import { describe, expect, it } from 'vitest';
import { Collection, Declaration } from '@jesscss/core';
import { fromLessNode } from '../../../src/transform/index.js';

describe('fromLessNode', () => {
  it('converts Less declarations without boundary intent metadata', () => {
    const node = fromLessNode({
      type: 'Declaration',
      name: 'color',
      value: { value: 'red' }
    });

    expect(node).toBeInstanceOf(Declaration);
    expect(node.options).not.toHaveProperty('preIntent');
    expect(node.options).not.toHaveProperty('postIntent');
  });

  it('converts Less detached ruleset declarations without boundary intent metadata', () => {
    const node = fromLessNode({
      type: 'DetachedRuleset',
      ruleset: {
        rules: [{
          type: 'Declaration',
          name: 'color',
          value: { value: 'red' }
        }]
      }
    });

    expect(node).toBeInstanceOf(Collection);
    const [declaration] = node.value;
    expect(declaration).toBeInstanceOf(Declaration);
    expect(declaration?.options).not.toHaveProperty('preIntent');
    expect(declaration?.options).not.toHaveProperty('postIntent');
  });
});
