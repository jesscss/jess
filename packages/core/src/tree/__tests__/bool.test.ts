import { describe, it, expect, beforeEach } from 'vitest';
import { bool } from '../index.js';
import { Context } from '../../context.js';

describe('Bool', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders bool syntax through toTrimmedString()', () => {
    expect(bool(true).toTrimmedString()).toBe('true');
    expect(bool(false).toTrimmedString()).toBe('false');
  });

  it('renders bool values through render(context)', () => {
    expect(bool(true).render(context)).toBe('true');
    expect(bool(false).render(context)).toBe('false');
  });

  it('resolves bool values without touching render state', async () => {
    const resolved = await bool(true).resolve(context);

    expect(resolved).toBeInstanceOf((bool(true)).constructor);
    expect(resolved.value).toBe(true);
    expect(context.printState.writer).toBeUndefined();
  });
});
