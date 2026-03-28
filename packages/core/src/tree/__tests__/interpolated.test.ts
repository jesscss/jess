import { describe, expect, it } from 'vitest';
import { any, expr, interpolated } from '../index.js';
import { Context } from '../../context.js';
describe('Interpolated', () => {
  it('serializes source and replacements on the public render path', () => {
    const node = interpolated({
      source: '--%%-%%',
      replacements: [any('red'), any('blue')]
    });

    expect(node.toTrimmedString()).toBe('--red-blue');
  });

  it('evaluates to a generic value without overwriting canonical replacements', async () => {
    const ctx = new Context();
    const original = expr(any('red'));
    const node = interpolated({
      source: '--%%',
      replacements: [original]
    });

    const result = await node.eval(ctx);

    expect(result.toTrimmedString()).toBe('--red');
    expect(node.replacements[0]).toBe(original);
  });

  it('evaluates to a selector without overwriting canonical replacements', async () => {
    const ctx = new Context();
    const original = expr(any('button'));
    const node = interpolated({
      source: '.%%',
      replacements: [original]
    });

    const selector = await node.evalToSelector(ctx);

    expect(selector.toTrimmedString()).toBe('.button');
    expect(node.replacements[0]).toBe(original);
  });
});
