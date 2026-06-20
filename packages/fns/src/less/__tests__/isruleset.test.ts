import { describe, it, expect } from 'vitest';
import { Any, Mixin, Rules } from '@jesscss/core';
import { isrulesetImplementation } from '../isruleset.js';

describe('isruleset()', () => {
  it('returns false for lazy ReferenceError and rethrows non-reference errors', async () => {
    const rulesResult = await isrulesetImplementation(() => new Rules([]));
    const mixinResult = await isrulesetImplementation(() => new Mixin({ rules: [] }));
    const noRulesResult = await isrulesetImplementation(() => new Any('nope'));
    const missingRulesResult = await isrulesetImplementation(() => {
      throw new ReferenceError('missing');
    });

    expect(rulesResult.value).toBe(true);
    expect(mixinResult.value).toBe(true);
    expect(noRulesResult.value).toBe(false);
    expect(missingRulesResult.value).toBe(false);

    await expect(isrulesetImplementation(() => {
      throw new TypeError('boom');
    })).rejects.toThrow('boom');
  });
});
