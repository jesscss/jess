import { describe, expect, it } from 'vitest';
import { wouldConflict } from '../extend/conflict.js';

/**
 * Unit test for the pure conflict predicate `wouldConflict(surrounding, extenderTerminal)`.
 * Mirrors tree-v1 `partialWrapMayConflict`'s rule: a conflict is >1 distinct element
 * TYPE selector or >1 distinct ID selector merged into one compound.
 */
describe('wouldConflict predicate', () => {
  it('type + type in one compound → conflict', () => {
    expect(wouldConflict(['a'], ['div', '.foo'])).toBe(true);
    expect(wouldConflict(['div'], ['span', '.other'])).toBe(true);
  });

  it('id + id in one compound → conflict', () => {
    expect(wouldConflict(['#main'], ['#other', '.foo'])).toBe(true);
  });

  it('class + class → no conflict', () => {
    expect(wouldConflict(['.a'], ['.b'])).toBe(false);
  });

  it('type + class → no conflict', () => {
    expect(wouldConflict(['div'], ['.b'])).toBe(false);
    // `.a` (surrounding) + `div` (extender): only one distinct type → no conflict.
    expect(wouldConflict(['.a'], ['div'])).toBe(false);
  });

  it('same type twice → no conflict (div + div)', () => {
    expect(wouldConflict(['div'], ['div', '.b'])).toBe(false);
  });

  it('same type case-insensitively → no conflict (DIV + div)', () => {
    expect(wouldConflict(['DIV'], ['div', '.b'])).toBe(false);
  });

  it('same id twice → no conflict (#foo#foo specificity hack)', () => {
    expect(wouldConflict(['#foo', '#foo'], ['.bar'])).toBe(false);
  });

  it('extender with no type/id → never a conflict (precondition)', () => {
    // Even a surrounding with a type — an extender that adds only classes cannot
    // introduce a second distinct type/id.
    expect(wouldConflict(['a', '#x'], ['.only', '.classes'])).toBe(false);
  });

  it('empty surrounding → no conflict (nothing to merge with)', () => {
    expect(wouldConflict([], ['div', '.foo'])).toBe(false);
    expect(wouldConflict([], ['#a', '#b'])).toBe(true);
  });

  it('id + id via extender alone → conflict', () => {
    expect(wouldConflict([], ['#a', '#b'])).toBe(true);
  });

  it('non-conflicting atoms (attr, pseudo, amp, universal) ignored', () => {
    expect(wouldConflict(['[href]', ':hover', '&', '*'], ['div'])).toBe(false);
    expect(wouldConflict(['div'], ['[href]', ':hover', '&', '*'])).toBe(false);
  });

  it('interpolated-empty simple ("") is ignored', () => {
    expect(wouldConflict([''], ['div'])).toBe(false);
  });
});
