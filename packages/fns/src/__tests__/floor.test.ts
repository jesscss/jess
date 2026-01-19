import { describe, test, expect, beforeEach } from 'vitest';
import { Context, Dimension, Num } from '@jesscss/core';
import floor from '../less/floor.js';

describe('floor function isolated test', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  test('floor with number', () => {
    const result = floor(1.7);
    expect(result).toBeDefined();
  });

  test('floor with number (object)', () => {
    const result = floor({ value: 1.7 });
    expect(result).toBeDefined();
  });

  test('floor with Dimension', () => {
    const dim = new Dimension({ number: 1.7, unit: 'px' });
    const result = floor(dim);
    expect(result).toBeDefined();
  });

  test('floor with Dimension (object)', () => {
    const dim = new Dimension({ number: 1.7, unit: 'px' });
    const result = floor({ value: dim });
    expect(result).toBeDefined();
  });

  test('floor with Num', () => {
    const num = new Num(1.7);
    const result = floor(num);
    expect(result).toBeDefined();
  });
});
