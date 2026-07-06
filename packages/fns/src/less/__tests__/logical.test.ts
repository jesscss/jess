import { describe, it, expect } from 'vitest';
import { Bool, createPublicBool, keyword } from '@jesscss/core';
import { boolean, not, and, or } from '../logical.js';

const T = createPublicBool(true);
const F = createPublicBool(false);

describe('logical fns', () => {
  it('boolean() coerces a Bool or true/false keyword to a Bool', () => {
    expect(boolean(T)).toBeInstanceOf(Bool);
    expect(boolean(T).value).toBe(true);
    expect(boolean(F).value).toBe(false);
    expect(boolean(keyword('true')).value).toBe(true);
    expect(boolean(keyword('false')).value).toBe(false);
    // Any non-true value is falsy (matches Condition.getBoolValue).
    expect(boolean(keyword('foo')).value).toBe(false);
  });

  it('not() negates', () => {
    expect(not(T).value).toBe(false);
    expect(not(F).value).toBe(true);
    expect(not(keyword('false')).value).toBe(true);
  });

  it('and() is true only when every arg is truthy', () => {
    expect(and(T, T).value).toBe(true);
    expect(and(T, F).value).toBe(false);
    expect(and(T, T, F).value).toBe(false);
    expect(and(keyword('true'), T).value).toBe(true);
  });

  it('or() is true when any arg is truthy', () => {
    expect(or(F, T).value).toBe(true);
    expect(or(F, F).value).toBe(false);
    expect(or(F, F, keyword('true')).value).toBe(true);
  });
});
