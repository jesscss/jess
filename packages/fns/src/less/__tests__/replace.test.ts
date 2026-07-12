import { describe, it, expect } from 'vitest';
import { Any, Context, Quoted, callWithContext } from '@jesscss/core';
import replace from '../replace.js';

describe('replace()', () => {
  it('replaces in quoted input and preserves quote style', async () => {
    const input = new Quoted('hello', { quote: '\'' });
    const result = await callWithContext(new Context(), replace, input, new Quoted('l'), new Quoted('x')) as Quoted;
    expect(result).toBeInstanceOf(Quoted);
    expect(result.valueOf()).toBe('hexlo');
    expect(result.options.quote).toBe('\'');
  });

  it('replaces with flags and returns Any for non-quoted input', async () => {
    const result = await callWithContext(
      new Context(),
      replace,
      new Any('Hello', { role: 'keyword' }),
      new Quoted('h'),
      new Quoted('x'),
      new Quoted('i')
    ) as Any;
    expect(result).toBeInstanceOf(Any);
    expect(result.valueOf()).toBe('xello');
  });

  it('serializes non-quoted replacement values', async () => {
    const result = await callWithContext(
      new Context(),
      replace,
      new Any('alpha-beta', { role: 'keyword' }),
      new Quoted('-'),
      new Any('_', { role: 'keyword' })
    ) as Any;

    expect(result.valueOf()).toBe('alpha_beta');
  });
});
