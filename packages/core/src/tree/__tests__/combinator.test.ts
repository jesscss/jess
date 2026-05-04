import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { co } from '../index.js';

describe('Combinator', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders combinator syntax through toTrimmedString()', () => {
    expect(co('>').toTrimmedString()).toBe('>');
    expect(co('+').toTrimmedString()).toBe('+');
  });

  it('renders combinators through render(context)', () => {
    const child = co('>');
    const adjacent = co('+');

    expect(child.render(context)).toBe('>');
    expect(adjacent.render(context)).toBe('+');
    expect(child.evaluated).toBe(false);
    expect(child.preEvaluated).toBe(false);
    expect(adjacent.evaluated).toBe(false);
    expect(adjacent.preEvaluated).toBe(false);
  });

  it('resolves combinators without touching render state', async () => {
    const node = co('>');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('>');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
