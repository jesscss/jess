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
    expect(rest('items').render(context)).toBe('...$$items');
    expect(rest(any('items')).render(context)).toBe('...$items');
  });

  it('resolves rest values without touching render state', async () => {
    const resolved = await rest('items').resolve(context);

    expect(resolved.toTrimmedString()).toBe('...$$items');
    expect(context.printState.writer).toBeUndefined();
  });
});
