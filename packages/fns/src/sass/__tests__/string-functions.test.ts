import { describe, it, expect } from 'vitest';
import { makeKeyword, makeQuoted, type Keyword, type Quoted } from '@jesscss/core';
import unquote from '../unquote.js';
import quote from '../quote.js';
import toUpperCase from '../to-upper-case.js';
import toLowerCase from '../to-lower-case.js';

const quoted = (value: string, quoteChar = '"'): Quoted => makeQuoted(value, quoteChar, false);
const unquoted = (text: string): Keyword => makeKeyword(text);

describe('Sass string functions', () => {
  describe('unquote()', () => {
    it('removes quotes from quoted string', () => {
      const str = quoted('hello');
      const result = unquote(str);
      expect(result).toMatchObject({ type: 'Keyword', text: 'hello' });
    });

    it('returns unquoted string as-is', () => {
      const str = unquoted('hello');
      const result = unquote(str);
      expect(result).toBe(str);
    });

    it('works with object parameters', () => {
      const str = quoted('test');
      const result = unquote({ string: str });
      expect(result).toMatchObject({ type: 'Keyword', text: 'test' });
    });
  });

  describe('quote()', () => {
    it('adds quotes to unquoted string', () => {
      const str = unquoted('hello');
      const result = quote(str);
      expect(result).toMatchObject({ type: 'Quoted', quote: '"', value: 'hello' });
    });

    it('returns quoted string as-is', () => {
      const str = quoted('hello');
      const result = quote(str);
      expect(result).toMatchObject({ type: 'Quoted', quote: '"', value: 'hello' });
    });

    it('works with object parameters', () => {
      const str = unquoted('test');
      const result = quote({ string: str });
      expect(result).toMatchObject({ type: 'Quoted', quote: '"', value: 'test' });
    });
  });

  describe('to-upper-case()', () => {
    it('converts lowercase string to uppercase', () => {
      const str = quoted('hello');
      const result = toUpperCase(str);
      expect(result).toMatchObject({ type: 'Quoted', value: 'HELLO', quote: '"' });
    });

    it('handles mixed case', () => {
      const str = unquoted('Hello World');
      const result = toUpperCase(str);
      expect(result).toMatchObject({ type: 'Keyword', text: 'HELLO WORLD' });
    });

    it('preserves quote options', () => {
      const str = unquoted('test');
      const result = toUpperCase(str);
      expect(result).toMatchObject({ type: 'Keyword', text: 'TEST' });
    });

    it('works with object parameters', () => {
      const str = quoted('test');
      const result = toUpperCase({ string: str });
      expect(result).toMatchObject({ type: 'Quoted', value: 'TEST' });
    });
  });

  describe('to-lower-case()', () => {
    it('converts uppercase string to lowercase', () => {
      const str = quoted('HELLO');
      const result = toLowerCase(str);
      expect(result).toMatchObject({ type: 'Quoted', value: 'hello', quote: '"' });
    });

    it('handles mixed case', () => {
      const str = unquoted('Hello World');
      const result = toLowerCase(str);
      expect(result).toMatchObject({ type: 'Keyword', text: 'hello world' });
    });

    it('preserves quote options', () => {
      const str = quoted('TEST');
      const result = toLowerCase(str);
      expect(result).toMatchObject({ type: 'Quoted', value: 'test', quote: '"' });
    });

    it('works with object parameters', () => {
      const str = unquoted('TEST');
      const result = toLowerCase({ string: str });
      expect(result).toMatchObject({ type: 'Keyword', text: 'test' });
    });
  });
});
