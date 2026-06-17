import { describe, it, expect } from 'vitest';
import { Any, Context, Dimension, Quoted, callWithContext } from '@jesscss/core';
import format from '../format.js';

describe('format() / %()', () => {
  it('formats quoted templates and preserves quote style', async () => {
    const context = new Context();
    const template = new Quoted('/users/%S?name=%s%%', { quote: '\'' });
    const result = await callWithContext(
      context,
      format,
      template,
      new Quoted('a b'),
      new Quoted('x y')
    );
    expect(result).toBeInstanceOf(Quoted);
    expect((result as Quoted).valueOf()).toBe('/users/a%20b?name=x y%');
    expect((result as Quoted).quote).toBe('\'');
  });

  it('returns Any for non-quoted templates', async () => {
    const context = new Context();
    const result = await callWithContext(
      context,
      format,
      new Any('value=%d', { role: 'keyword' }),
      new Dimension({ number: 12, unit: 'px' })
    );
    expect(result).toBeInstanceOf(Any);
    expect(result.valueOf()).toBe('value=12px');
  });
});
