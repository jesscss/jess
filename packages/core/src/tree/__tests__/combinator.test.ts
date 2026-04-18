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
    expect(co('>').render(context)).toBe('>');
    expect(co('+').render(context)).toBe('+');
  });

  it('resolves combinators without touching render state', async () => {
    const resolved = await co('>').resolve(context);

    expect(resolved.toTrimmedString()).toBe('>');
    expect(context.printState.writer).toBeUndefined();
  });
});
