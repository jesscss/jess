import { describe, it, expect } from 'vitest';
import { any, expr, op } from '../index.js';
import { Context } from '../../context.js';

describe('Operation', () => {
  it('evaluates child expressions before serialization when the operation is preserved', async () => {
    const context = new Context();
    const node = op([
      expr(any('foo')),
      '/',
      expr(any('bar'))
    ]);

    const evald = await node.eval(context);

    expect(evald.toTrimmedString()).toBe('foo / bar');
  });
});
