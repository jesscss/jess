import { describe, it, expect } from 'vitest';
import { Any, Color, ColorFormat, Context, Dimension, List, Quoted, Sequence } from '@jesscss/core';
import rgb from '../rgb.js';

type RgbInternal = {
  _internal: (this: {
    context: Context;
    rawArgs: List;
    args: () => Promise<unknown[]>;
  }) => Promise<Color>;
};

function makeThis(rawArgs: List, context = new Context()) {
  return {
    context,
    rawArgs,
    args: async () => rawArgs.eval(context)
  };
}

describe('rgb() relative color error paths', () => {
  it('throws when relative rgb has fewer than 3 channels', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([new Any('from', { role: 'keyword' }), new Color('#008000'), new Any('r', { role: 'ident' })]);
    const argsList = new List([seq]);

    await expect(rgbInternal.call(makeThis(argsList))).rejects.toThrow(
      'Relative rgb() requires at least 3 channel values (r, g, b)'
    );
  });

  it('throws when slash alpha has invalid unit', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' })
    ]);
    const argsList = new List([seq, new Dimension({ number: 10, unit: 'px' })], { sep: '/' });

    await expect(rgbInternal.call(makeThis(argsList))).rejects.toThrow('Invalid alpha value unit: px');
  });

  it('throws when slash alpha is not a dimension', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' })
    ]);
    const argsList = new List([seq, new Quoted('bad-alpha')], { sep: '/' });

    await expect(rgbInternal.call(makeThis(argsList))).rejects.toThrow(
      'Alpha value separated by / must evaluate to a Dimension'
    );
  });

  it('throws when 4th channel name is not alpha', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' }),
      new Any('bogus', { role: 'ident' })
    ]);
    const argsList = new List([seq]);

    await expect(rgbInternal.call(makeThis(argsList))).rejects.toThrow(
      'Invalid alpha channel reference: bogus. Must be alpha'
    );
  });

  it('accepts explicit 4th-channel alpha dimension', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' }),
      new Dimension({ number: 50, unit: '%' })
    ]);
    const argsList = new List([seq]);

    const result = await rgbInternal.call(makeThis(argsList));
    expect(result).toBeInstanceOf(Color);
    expect(result.rgb).toEqual([0, 128, 0]);
    expect(result.alpha).toBe(0.5);
  });

  it('accepts slash alpha as percentage', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' })
    ]);
    const argsList = new List([seq, new Dimension({ number: 40, unit: '%' })], { sep: '/' });

    const result = await rgbInternal.call(makeThis(argsList));
    expect(result.alpha).toBeCloseTo(0.4);
  });

  it('accepts 4th channel alpha keyword reference', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const origin = new Color({
      rgb: [0, 128, 0],
      alpha: 0.3
    }, { format: ColorFormat.RGB });
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      origin,
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' }),
      new Any('alpha', { role: 'ident' })
    ]);
    const argsList = new List([seq]);

    const result = await rgbInternal.call(makeThis(argsList));
    expect(result.alpha).toBeCloseTo(0.3);
  });

  it('accepts 4th channel alpha as unitless dimension', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' }),
      new Dimension({ number: 0.2, unit: '' })
    ]);
    const argsList = new List([seq]);

    const result = await rgbInternal.call(makeThis(argsList));
    expect(result.alpha).toBeCloseTo(0.2);
  });

  it('throws when explicit 4th-channel alpha has invalid unit', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' }),
      new Dimension({ number: 1, unit: 'px' })
    ]);
    const argsList = new List([seq]);

    await expect(rgbInternal.call(makeThis(argsList))).rejects.toThrow('Invalid alpha value unit: px');
  });

  it('throws when explicit 4th-channel alpha expression is not a dimension', async () => {
    const rgbInternal = (rgb as unknown as RgbInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('r', { role: 'ident' }),
      new Any('g', { role: 'ident' }),
      new Any('b', { role: 'ident' }),
      new Quoted('not-a-number')
    ]);
    const argsList = new List([seq]);

    await expect(rgbInternal.call(makeThis(argsList))).rejects.toThrow(
      'Channel expressions (like calc()) are not yet supported in relative color syntax'
    );
  });
});
