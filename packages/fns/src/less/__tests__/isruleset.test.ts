import { describe, it, expect } from 'vitest';
import { Any, Bool, Mixin, Rules } from '@jesscss/core';
import isruleset from '../isruleset.js';

type LazyBoolInternal = {
  _internal: (value: () => unknown) => Promise<Bool>;
};

describe('isruleset()', () => {
  it('returns false for lazy ReferenceError and rethrows non-reference errors', async () => {
    const isrulesetInternal = (isruleset as unknown as LazyBoolInternal)._internal;

    const rulesResult = await isrulesetInternal(() => new Rules([]));
    const mixinResult = await isrulesetInternal(() => new Mixin({ rules: new Rules([]) }));
    const noRulesResult = await isrulesetInternal(() => new Any('nope'));
    const missingRulesResult = await isrulesetInternal(() => {
      throw new ReferenceError('missing');
    });

    expect(rulesResult.value).toBe(true);
    expect(mixinResult.value).toBe(true);
    expect(noRulesResult.value).toBe(false);
    expect(missingRulesResult.value).toBe(false);

    await expect(isrulesetInternal(() => {
      throw new TypeError('boom');
    })).rejects.toThrow('boom');
  });
});
