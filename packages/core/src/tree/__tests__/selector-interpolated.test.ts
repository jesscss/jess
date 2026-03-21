import { describe, expect, it } from 'vitest';
import { any, expr, interpolated, interpolatedSelector } from '../index.js';
import { Context } from '../../context.js';

describe('InterpolatedSelector', () => {
  it('serializes the wrapped interpolated selector', () => {
    const node = interpolatedSelector(interpolated({
      source: '.%%',
      replacements: [any('button')]
    }));

    expect(node.toTrimmedString()).toBe('.button');
  });

  it('evaluates the wrapped interpolated selector to a selector node', async () => {
    const ctx = new Context();
    const node = interpolatedSelector(interpolated({
      source: '.%%',
      replacements: [expr(any('button'))]
    }));

    const evald = await node.eval(ctx);

    expect(evald.toTrimmedString()).toBe('.button');
  });
});
