import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { Dimension } from '../dimension.js';
import { Negative } from '../negative.js';
import { Operation } from '../operation.js';
import { Paren } from '../paren.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

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

  it('keeps the canonical child direct while the cursor can select an alternate child', () => {
    const canonical = new Dimension({ number: 2, unit: 'px' });
    const alternate = new Dimension({ number: 4, unit: 'px' });
    const node = new Negative(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
