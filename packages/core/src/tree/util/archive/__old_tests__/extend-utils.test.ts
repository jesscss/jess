import { describe, it, expect } from 'vitest';
import { el } from '../../../index.js';
import { applyExtendsToSelector, ExtendInstruction } from '../extend.js';

describe('extend utility helpers - applyExtendsToSelector', () => {
  it('adds the extend selector to a list when a full match occurs', () => {
    const target = el('.foo');
    const extendWith = el('.bar');
    const instructions: ExtendInstruction[] = [
      { target, extendWith, partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    expect(result.valueOf().trim()).toBe('.foo,.bar');
  });

  it('returns the original selector when no extends match', () => {
    const target = el('.foo');
    const instructions: ExtendInstruction[] = [
      { target: el('.other'), extendWith: el('.bar'), partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    expect(result).toBe(target);
  });

  it('supports multiple extends by applying until selectors stabilize', () => {
    const target = el('.foo');
    const instructions: ExtendInstruction[] = [
      { target: el('.foo'), extendWith: el('.bar'), partial: false },
      { target: el('.bar'), extendWith: el('.baz'), partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    expect(result.valueOf().trim()).toBe('.foo,.bar,.baz');
  });
});
