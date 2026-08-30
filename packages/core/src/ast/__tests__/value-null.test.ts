import { describe, expect, it } from 'vitest';
import { makeDimension, makeKeyword, makeNull, NULL, NULL_LITERAL } from '../value-factory.js';
import { emitValue, isElided } from '../value-eval.js';
import { serializeValue } from '../serialize-value.js';
import { compare } from '../value-guards.js';
import { operate } from '../value-operate.js';
import { isTruthy } from '../value-truth.js';

/** RESOLVED-SEMANTICS-AND-NAMING.md §4.3 — the value-domain half of `null`. */
describe('Null value (§4.3)', () => {
  it('carries PROVENANCE without a second node type or a second shape', () => {
    expect(makeNull()).toBe(NULL);
    expect(makeNull(true)).toBe(NULL_LITERAL);
    expect(NULL.explicit).toBe(false);
    expect(NULL_LITERAL.explicit).toBe(true);

    /* Non-optional and factory-defaulted: both singletons realize ONE hidden class. */
    expect(Object.keys(NULL)).toEqual(Object.keys(NULL_LITERAL));
    expect(NULL.type).toBe('Null');
  });

  it('emits nothing and drops the separator that would follow it', () => {
    expect(emitValue(NULL)).toBe('');
    expect(isElided(NULL)).toBe(true);
    expect(emitValue([makeDimension(1, 'px'), NULL, makeDimension(2, 'px')])).toBe('1px 2px');
    expect(serializeValue([makeDimension(1, 'px'), NULL, makeDimension(2, 'px')])).toBe('1px 2px');
  });

  it('does not elide a group that merely contains an ordinary empty value', () => {
    expect(isElided([])).toBe(false);
    expect(isElided(makeKeyword(''))).toBe(false);
    expect(isElided([NULL, NULL])).toBe(true);
  });

  it('contributes nothing to arithmetic', () => {
    expect(operate('+', makeDimension(1), NULL, { unitMode: 'preserve' })).toEqual(makeDimension(1));
    expect(operate('+', NULL, makeDimension(1), { unitMode: 'preserve' })).toEqual(makeDimension(1));
    expect(operate('+', NULL, NULL, { unitMode: 'preserve' })).toBe(NULL);
  });

  it('grounds NUMERICALLY against a number and nowhere else (§4.1)', () => {
    expect(compare('=', NULL, makeDimension(0))).toBe(true);
    expect(compare('>', NULL, makeDimension(1))).toBe(false);
    expect(compare('<', NULL, makeDimension(1))).toBe(true);
    expect(compare('==', NULL, makeDimension(0))).toBe(false);
    expect(compare('=', NULL, makeKeyword('false'))).toBe(false);
    expect(compare('=', NULL, NULL)).toBe(true);
  });

  it('is falsy (§4.4)', () => {
    expect(isTruthy(NULL)).toBe(false);
    expect(isTruthy(NULL_LITERAL)).toBe(false);
  });
});
