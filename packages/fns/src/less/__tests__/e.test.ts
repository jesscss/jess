import { describe, it, expect } from 'vitest';
import { Any, Quoted } from '@jesscss/core';
import e from '../e.js';

describe('e()', () => {
  it('returns unquoted value for Quoted and unchanged node otherwise', () => {
    const quoted = new Quoted('hello');
    const ident = new Any('world', { role: 'keyword' });

    expect(e(quoted)).toBe('hello');
    expect(e(ident)).toBe(ident);
  });
});
