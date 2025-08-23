import {
  iif
} from '../less';

import { Bool, Context, Dimension } from '@jesscss/core';
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
    // @ts-expect-error - missing params
    expect(() => iif(true)).toThrow('Required argument \'thenValue\' is missing');
  });
  it('rejects an invalid condition', () => {
    // @ts-expect-error - wrong argument type
    expect(() => iif(new Dimension({ number: 1, unit: 'px' }))).toThrow('Argument \'condition\' must be one of:');
  });

  test('iif (true)', async () => {
    await expect(iif(true, () => new Dimension({ number: 2, unit: 'px' }))).resolves.toMatchObject(new Dimension({ number: 2, unit: 'px' }));
  });

  test('iif (false)', async () => {
    await expect(iif(new Bool(false), () => new Dimension({ number: 2, unit: 'px' }), () => new Dimension({ number: 3, unit: 'px' }))).resolves.toMatchObject(new Dimension({ number: 3, unit: 'px' }));
  });

  test('iif (false) without elseValue', async () => {
    await expect(iif(new Bool(false), () => new Dimension({ number: 2, unit: 'px' }))).resolves.toBeUndefined();
  });

  /** @todo - add tests to make sure iif lazy evaluates true / false */
});