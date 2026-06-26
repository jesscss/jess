import {
  iif
} from '../less/index.js';

import { Anonymous, Bool, Context, Dimension } from '@jesscss/core';
import { beforeAll, describe, it, test, expect } from 'vitest';

let context: Context;
let dim: Dimension;

describe('iif', () => {
  beforeAll(() => {
    context = new Context();
    dim = new Dimension({ number: 2.4, unit: 'px' });
  });
  /**
   * @todo - refine errors later
   * @see https://github.com/ianstormtaylor/superstruct/issues/1194
   */
  it('rejects a missing thenValue', () => {
    expect(() => iif(true)).toThrow('Required argument \'thenValue\' is missing');
  });
  it('rejects an invalid condition', () => {
    expect(() => iif(new Dimension({ number: 1, unit: 'px' }))).toThrow('Argument \'condition\' must be one of:');
  });

  test('iif (true)', async () => {
    const result = await iif(true, () => new Dimension({ number: 2, unit: 'px' }));
    expect(result).toBeInstanceOf(Dimension);
    if (result) {
      expect(result.compare(new Dimension({ number: 2, unit: 'px' }))).toBe(0);
    }
  });

  test('iif (false)', async () => {
    const result = await iif(new Bool(false), () => new Dimension({ number: 2, unit: 'px' }), () => new Dimension({ number: 3, unit: 'px' }));
    expect(result).toBeInstanceOf(Dimension);
    if (result) {
      expect(result.compare(new Dimension({ number: 3, unit: 'px' }))).toBe(0);
    }
  });

  test('iif (false) without elseValue', async () => {
    await expect(iif(new Bool(false), () => new Dimension({ number: 2, unit: 'px' }))).resolves.toBeInstanceOf(Anonymous);
  });

  /** @todo - add tests to make sure iif lazy evaluates true / false */
});
