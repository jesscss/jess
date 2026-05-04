import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, rest } from '../index.js';

describe('Rest', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders rest syntax through toTrimmedString()', () => {
    expect(rest('items').toTrimmedString()).toBe('...$$items');
    expect(rest(any('items')).toTrimmedString()).toBe('...$items');
  });

  it('renders rest values through render(context)', () => {
    const named = rest('items');
    const nodeNamed = rest(any('items'));

    expect(named.render(context)).toBe('...$$items');
    expect(nodeNamed.render(context)).toBe('...$items');
    expect(named.evaluated).toBe(false);
    expect(named.preEvaluated).toBe(false);
    expect(nodeNamed.evaluated).toBe(false);
    expect(nodeNamed.preEvaluated).toBe(false);
  });

  it('resolves rest values without touching render state', async () => {
    const node = rest('items');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('...$$items');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
