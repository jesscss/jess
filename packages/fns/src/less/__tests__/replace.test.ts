import { describe, it, expect } from 'vitest';
import { Any, Context, Quoted, callWithContext } from '@jesscss/core';
import replace from '../replace.js';

function expectInstance<T>(value: unknown, ctor: abstract new (...args: never[]) => T): T {
  if (!(value instanceof ctor)) {
    throw new TypeError('Unexpected replace() result.');
  }
  return value;
}

describe('replace()', () => {
  it('replaces in quoted input and preserves quote style', async () => {
    const input = new Quoted('hello', { quote: '\'' });
    const result = expectInstance(
      await callWithContext(new Context(), replace, input, new Quoted('l'), new Quoted('x')),
      Quoted
    );
    expect(result).toBeInstanceOf(Quoted);
    expect(result.valueOf()).toBe('hexlo');
    expect(result.quote).toBe('\'');
  });

  it('replaces with flags and returns Any for non-quoted input', async () => {
    const result = expectInstance(await callWithContext(
      new Context(),
      replace,
      new Any('Hello', { role: 'keyword' }),
      new Quoted('h'),
      new Quoted('x'),
      new Quoted('i')
    ), Any);
    expect(result).toBeInstanceOf(Any);
    expect(result.valueOf()).toBe('xello');
  });

  it('serializes non-quoted replacement values', async () => {
    const result = expectInstance(await callWithContext(
      new Context(),
      replace,
      new Any('alpha-beta', { role: 'keyword' }),
      new Quoted('-'),
      new Any('_', { role: 'keyword' })
    ), Any);

    expect(result.valueOf()).toBe('alpha_beta');
  });
});
