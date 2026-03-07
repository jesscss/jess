import { describe, it, expect } from 'vitest';
import { Any, Color, Context, Dimension, List, Quoted, Sequence } from '@jesscss/core';
import hsl from '../hsl.js';

type HslInternal = {
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

describe('hsl() relative color error paths', () => {
  it('throws when relative hsl has fewer than 3 channels', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([new Any('from', { role: 'keyword' }), new Color('#008000'), new Any('h', { role: 'ident' })]);
    const argsList = new List([seq]);

    await expect(hslInternal.call(makeThis(argsList))).rejects.toThrow(
      'Relative hsl() requires at least 3 channel values (h, s, l)'
    );
  });

  it('throws when slash alpha has invalid unit', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('h', { role: 'ident' }),
      new Any('s', { role: 'ident' }),
      new Any('l', { role: 'ident' })
    ]);
    const argsList = new List([seq, new Dimension({ number: 10, unit: 'px' })], { sep: '/' });

    await expect(hslInternal.call(makeThis(argsList))).rejects.toThrow('Invalid alpha value unit: px');
  });

  it('throws when slash alpha is not a dimension', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('h', { role: 'ident' }),
      new Any('s', { role: 'ident' }),
      new Any('l', { role: 'ident' })
    ]);
    const argsList = new List([seq, new Quoted('bad-alpha')], { sep: '/' });

    await expect(hslInternal.call(makeThis(argsList))).rejects.toThrow(
      'Alpha value separated by / must evaluate to a Dimension'
    );
  });

  it('throws when 4th channel name is not alpha', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('h', { role: 'ident' }),
      new Any('s', { role: 'ident' }),
      new Any('l', { role: 'ident' }),
      new Any('bogus', { role: 'ident' })
    ]);
    const argsList = new List([seq]);

    await expect(hslInternal.call(makeThis(argsList))).rejects.toThrow(
      'Invalid alpha channel reference: bogus. Must be alpha'
    );
  });

  it('accepts explicit 4th-channel alpha dimension', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('h', { role: 'ident' }),
      new Any('s', { role: 'ident' }),
      new Any('l', { role: 'ident' }),
      new Dimension({ number: 50, unit: '%' })
    ]);
    const argsList = new List([seq]);

    const result = await hslInternal.call(makeThis(argsList));
    expect(result).toBeInstanceOf(Color);
    expect(result.alpha).toBe(0.5);
  });

  it('throws when explicit 4th-channel alpha has invalid unit', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('h', { role: 'ident' }),
      new Any('s', { role: 'ident' }),
      new Any('l', { role: 'ident' }),
      new Dimension({ number: 1, unit: 'px' })
    ]);
    const argsList = new List([seq]);

    await expect(hslInternal.call(makeThis(argsList))).rejects.toThrow('Invalid alpha value unit: px');
  });

  it('throws when explicit 4th-channel alpha expression is not a dimension', async () => {
    const hslInternal = (hsl as unknown as HslInternal)._internal;
    const seq = new Sequence([
      new Any('from', { role: 'keyword' }),
      new Color('#008000'),
      new Any('h', { role: 'ident' }),
      new Any('s', { role: 'ident' }),
      new Any('l', { role: 'ident' }),
      new Quoted('not-a-number')
    ]);
    const argsList = new List([seq]);

    await expect(hslInternal.call(makeThis(argsList))).rejects.toThrow(
      'Channel expressions (like calc()) are not yet supported in relative color syntax'
    );
  });
});
