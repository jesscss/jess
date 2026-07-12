import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { Dimension } from '../dimension.js';
import { Negative } from '../negative.js';
import { Operation } from '../operation.js';
import { Paren } from '../paren.js';

describe('Negative', () => {
  it('serializes with a leading minus sign', () => {
    const node = new Negative(new Dimension({ number: 2, unit: 'px' }));

    expect(node.toTrimmedString()).toBe('-2px');
  });

  it('evaluates its child before applying the negative sign', async () => {
    const ctx = new Context();
    const node = new Negative(new Paren(new Operation([
      new Dimension({ number: 1, unit: 'px' }),
      '+',
      new Dimension({ number: 2, unit: 'px' })
    ])));

    const evald = await node.eval(ctx);

    expect(evald.toTrimmedString()).toBe('-3px');
  });
});
