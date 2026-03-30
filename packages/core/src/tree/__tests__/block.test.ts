import { describe, expect, it } from 'vitest';
import { any, block, expr } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

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

    expect(evald.toTrimmedString({ context: ctx })).toBe('{red}');
  });

  it('keeps the canonical child direct while render keys can select alternates', () => {
    const canonical = any('red');
    const alternate = any('blue');
    const node = block(canonical);
    const key = {} as RenderKey;
    const cursor = { node, key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
  });
});
