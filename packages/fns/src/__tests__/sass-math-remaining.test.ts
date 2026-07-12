import { Dimension, Context, Quoted, Any } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import percentage from '../sass/percentage.js';
import unit from '../sass/unit.js';
import random from '../sass/random.js';

let context: Context;

describe('Sass remaining math functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('percentage()', () => {
    it('converts unitless number to percentage', () => {
      const number = new Dimension({ number: 0.5 });
      const result = percentage(number);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).data.number).toBe(50);
      expect((result as Dimension).data.unit).toBe('%');
    });

    it('converts 1 to 100%', () => {
      const number = new Dimension({ number: 1 });
      const result = percentage(number);
      expect((result as Dimension).data.number).toBe(100);
      expect((result as Dimension).data.unit).toBe('%');
    });

    it('converts 0 to 0%', () => {
      const number = new Dimension({ number: 0 });
      const result = percentage(number);
      expect((result as Dimension).data.number).toBe(0);
      expect((result as Dimension).data.unit).toBe('%');
    });

    it('throws error for number with unit', () => {
      const number = new Dimension({ number: 0.5, unit: 'px' });
      expect(() => percentage(number)).toThrow('Expected unitless number');
    });

    it('works with object parameters', () => {
      const number = new Dimension({ number: 0.25 });
      const result = percentage({ number });
      expect((result as Dimension).data.number).toBe(25);
      expect((result as Dimension).data.unit).toBe('%');
    });
  });

  describe('unit()', () => {
    it('returns unit as quoted string', () => {
      const number = new Dimension({ number: 10, unit: 'px' });
      const result = unit(number);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('px');
    });

    it('returns empty string for unitless number', () => {
      const number = new Dimension({ number: 10 });
      const result = unit(number);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('');
    });

    it('changes unit when second argument provided', () => {
      const number = new Dimension({ number: 10, unit: 'px' });
      const newUnit = new Any('em', 'keyword');
      const result = unit(number, newUnit);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).data.number).toBe(10);
      expect((result as Dimension).data.unit).toBe('em');
    });

    it('preserves number when changing unit', () => {
      const number = new Dimension({ number: 20, unit: 'px' });
      const newUnit = new Any('rem', 'keyword');
      const result = unit(number, newUnit);
      expect((result as Dimension).data.number).toBe(20);
      expect((result as Dimension).data.unit).toBe('rem');
    });

    it('works with object parameters', () => {
      const number = new Dimension({ number: 10, unit: 'px' });
      const result = unit({ number });
      expect((result as Quoted).valueOf()).toBe('px');
    });
  });

  describe('random()', () => {
    it('returns random number between 0 and 1 when no limit', () => {
      const result = random();
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).data.unit).toBeUndefined();
      const value = (result as Dimension).data.number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('returns random integer between 1 and limit (inclusive)', () => {
      const limit = new Dimension({ number: 10 });
      const result = random(limit);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).data.unit).toBeUndefined();
      const value = (result as Dimension).data.number;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
      expect(Number.isInteger(value)).toBe(true);
    });

    it('returns 1 when limit is 1', () => {
      const limit = new Dimension({ number: 1 });
      const result = random(limit);
      expect((result as Dimension).data.number).toBe(1);
    });

    it('throws error for limit less than 1', () => {
      const limit = new Dimension({ number: 0 });
      expect(() => random(limit)).toThrow('Must be greater than 0');
    });

    it('works with object parameters', () => {
      const limit = new Dimension({ number: 5 });
      const result = random({ limit });
      const value = (result as Dimension).data.number;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
    });
  });
});
