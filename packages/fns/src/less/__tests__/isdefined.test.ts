import { describe, it, expect } from 'vitest';
import { Any, Bool } from '@jesscss/core';
import isdefined from '../isdefined.js';

type LazyBoolInternal = {
  _internal: (value: () => unknown) => Promise<Bool>;
};

describe('isdefined()', () => {
  it('returns false for lazy ReferenceError and rethrows non-reference errors', async () => {
    const isdefinedInternal = (isdefined as unknown as LazyBoolInternal)._internal;

    const definedResult = await isdefinedInternal(() => new Any('ok'));
    const undefinedResult = await isdefinedInternal(() => {
      throw new ReferenceError('missing');
    });

    expect(definedResult.value).toBe(true);
    expect(undefinedResult.value).toBe(false);

    await expect(isdefinedInternal(() => {
      throw new TypeError('boom');
    })).rejects.toThrow('boom');
  });
});
