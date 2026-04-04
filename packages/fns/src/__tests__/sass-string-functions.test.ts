import { Quoted, Context } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import unquote from '../sass/unquote.js';
import quote from '../sass/quote.js';
import toUpperCase from '../sass/to-upper-case.js';
import toLowerCase from '../sass/to-lower-case.js';

let context: Context;

describe('Sass string functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('unquote()', () => {
    it('removes quotes from quoted string', () => {
      const str = new Quoted('hello', { quote: '"' });
      const result = unquote(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBeUndefined();
      expect((result as Quoted).valueOf()).toBe('hello');
    });

    it('returns unquoted string as-is', () => {
      const str = new Quoted('hello');
      const result = unquote(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBeUndefined();
      expect((result as Quoted).valueOf()).toBe('hello');
    });

    it('works with object parameters', () => {
      const str = new Quoted('test', { quote: '"' });
      const result = unquote({ string: str });
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBeUndefined();
    });
  });

  describe('quote()', () => {
    it('adds quotes to unquoted string', () => {
      const str = new Quoted('hello');
      const result = quote(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBe('"');
      expect((result as Quoted).valueOf()).toBe('hello');
    });

    it('returns quoted string as-is', () => {
      const str = new Quoted('hello', { quote: '"' });
      const result = quote(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBe('"');
      expect((result as Quoted).valueOf()).toBe('hello');
    });

    it('works with object parameters', () => {
      const str = new Quoted('test');
      const result = quote({ string: str });
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBe('"');
    });
  });

  describe('to-upper-case()', () => {
    it('converts lowercase string to uppercase', () => {
      const str = new Quoted('hello', { quote: '"' });
      const result = toUpperCase(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('HELLO');
      expect((result as Quoted).quote).toBe('"'); // Preserves quotes
    });

    it('handles mixed case', () => {
      const str = new Quoted('Hello World');
      const result = toUpperCase(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('HELLO WORLD');
      expect((result as Quoted).quote).toBeUndefined();
    });

    it('preserves quote options', () => {
      const str = new Quoted('test');
      const result = toUpperCase(str);
      expect((result as Quoted).quote).toBeUndefined();
    });

    it('works with object parameters', () => {
      const str = new Quoted('test', { quote: '"' });
      const result = toUpperCase({ string: str });
      expect((result as Quoted).valueOf()).toBe('TEST');
    });
  });

  describe('to-lower-case()', () => {
    it('converts uppercase string to lowercase', () => {
      const str = new Quoted('HELLO', { quote: '"' });
      const result = toLowerCase(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('hello');
      expect((result as Quoted).quote).toBe('"'); // Preserves quotes
    });

    it('handles mixed case', () => {
      const str = new Quoted('Hello World');
      const result = toLowerCase(str);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('hello world');
      expect((result as Quoted).quote).toBeUndefined();
    });

    it('preserves quote options', () => {
      const str = new Quoted('TEST', { quote: '"' });
      const result = toLowerCase(str);
      expect((result as Quoted).quote).toBe('"');
    });

    it('works with object parameters', () => {
      const str = new Quoted('TEST');
      const result = toLowerCase({ string: str });
      expect((result as Quoted).valueOf()).toBe('test');
    });
  });
});
