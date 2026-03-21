import { describe, expect, it } from 'vitest';
import { any, block, expr } from '../index.js';
import { Context } from '../../context.js';

describe('Block', () => {
  it('serializes children with the configured wrapper shape', () => {
    const curly = block(any('red'));
    const square = block(any('red'), { type: 'square' });

    expect(curly.toTrimmedString()).toBe('{red}');
    expect(square.toTrimmedString()).toBe('[red]');
  });

  it('evaluates its child while preserving the wrapper shape', async () => {
    const ctx = new Context();
    const node = block(expr(any('red')));

    const evald = await node.eval(ctx);

    expect(evald.toTrimmedString()).toBe('{red}');
  });
});
