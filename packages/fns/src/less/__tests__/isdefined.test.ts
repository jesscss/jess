import { describe, it, expect } from 'vitest';
import { Any } from '@jesscss/core';
import { isdefinedImplementation } from '../isdefined.js';

describe('isdefined()', () => {
  it('returns false for lazy ReferenceError and rethrows non-reference errors', async () => {
    const definedResult = await isdefinedImplementation(() => new Any('ok'));
    const undefinedResult = await isdefinedImplementation(() => {
      throw new ReferenceError('missing');
    });

    expect(definedResult.value).toBe(true);
    expect(undefinedResult.value).toBe(false);

    await expect(isdefinedImplementation(() => {
      throw new TypeError('boom');
    })).rejects.toThrow('boom');
  });
});
