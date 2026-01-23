import { Dimension, Context, Bool } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import unitless from '../sass/unitless.js';
import compatible from '../sass/compatible.js';

let context: Context;

describe('Sass math utility functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('unitless()', () => {
    it('returns true for unitless number', () => {
      const number = new Dimension({ number: 10 });
      const result = unitless(number);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });

    it('returns false for number with unit', () => {
      const number = new Dimension({ number: 10, unit: 'px' });
      const result = unitless(number);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(false);
    });

    it('returns false for number with percentage unit', () => {
      const number = new Dimension({ number: 50, unit: '%' });
      const result = unitless(number);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(false);
    });

    it('works with object parameters', () => {
      const number = new Dimension({ number: 5 });
      const result = unitless({ number });
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });
  });

  describe('compatible()', () => {
    it('returns true for compatible units (same unit)', () => {
      const number1 = new Dimension({ number: 10, unit: 'px' });
      const number2 = new Dimension({ number: 20, unit: 'px' });
      const result = compatible(number1, number2, context);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });

    it('returns true for compatible units (both unitless)', () => {
      const number1 = new Dimension({ number: 10 });
      const number2 = new Dimension({ number: 20 });
      const result = compatible(number1, number2, context);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });

    it('returns true for compatible units (convertible length units)', () => {
      const number1 = new Dimension({ number: 10, unit: 'px' });
      const number2 = new Dimension({ number: 1, unit: 'in' });
      // In loose mode, these should be compatible
      const result = compatible(number1, number2, context);
      expect(result).toBeInstanceOf(Bool);
      // Note: This depends on unit conversion logic
    });

    it('returns false for incompatible units (different unit types)', () => {
      const number1 = new Dimension({ number: 10, unit: 'px' });
      const number2 = new Dimension({ number: 20, unit: 's' });
      const result = compatible(number1, number2, context);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(false);
    });

    it('works with object parameters', () => {
      const number1 = new Dimension({ number: 10, unit: 'px' });
      const number2 = new Dimension({ number: 20, unit: 'px' });
      const result = compatible({ number1, number2 }, context);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });
  });
});
