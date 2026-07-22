/**
 * COPY of extend-simplified-cases.test.ts, driven through the OWN-CONSTRUCTION engine.
 *
 * Each `extendSelector(...)` is routed through `extendViaOwn`, which asserts the own engine's
 * output is byte-identical to the oracle when it can build the shape, and records UNSUPPORTED
 * otherwise. The suite's original `.toBe(...)` expectations remain the byte oracle.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { el, sel, sellist, compound, is, co, pseudo } from '../../../index.js';
import { extendViaOwn, reportFrontier, resetFrontier } from './corpus-harness.js';

describe('CORPUS (own engine): Simplified Extend Test Cases', () => {
  resetFrontier();
  afterAll(() => reportFrontier('simplified-cases'));

  describe('Basic full-match extensions', () => {
    it('extend simple class selector', () => {
      const r = extendViaOwn(el('.btn'), el('.btn'), el('.primary'), false, 'simple class full');
      expect(r.valueOf()).toBe('.btn,.primary');
    });
    it('extend within selector list', () => {
      const r = extendViaOwn(sellist([el('.btn'), el('.link')]), el('.btn'), el('.primary'), false, 'selector list full');
      expect(r.valueOf()).toBe('.btn,.link,.primary');
    });
  });

  describe('Basic partial-match extensions', () => {
    it('extend partial match with :is()', () => {
      const r = extendViaOwn(sel([el('.a'), co('>'), el('.b')]), el('.b'), el('.c'), true, '.a>.b find .b partial');
      expect(r.valueOf()).toBe('.a>:is(.b,.c)');
    });
    it('extend compound partial match', () => {
      const r = extendViaOwn(
        sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]),
        el('.b'), el('.d'), true, '.a>.b.c find .b partial'
      );
      expect(r.valueOf()).toBe('.a>:is(.b,.d).c');
    });
  });

  describe('Modern CSS features', () => {
    it('extend within :is() selector', () => {
      const r = extendViaOwn(is(sellist([el('.a'), el('.b')])), el('.a'), el('.c'), false, ':is(.a,.b) find .a full');
      expect(r.valueOf()).toBe(':is(.a,.b,.c)');
    });
    it('extend simple pseudo-class', () => {
      const r = extendViaOwn(
        compound([el('.btn'), pseudo({ name: ':hover' })]),
        el('.btn'), el('.primary'), true, '.btn:hover find .btn partial'
      );
      expect(r.valueOf()).toBe(':is(.btn,.primary):hover');
    });
    it('extend with multiple pseudo-classes', () => {
      const r = extendViaOwn(
        compound([el('.btn'), pseudo({ name: ':hover' }), pseudo({ name: ':focus' })]),
        el('.btn'), el('.primary'), true, '.btn:hover:focus find .btn partial'
      );
      expect(r.valueOf()).toBe(':is(.btn,.primary):hover:focus');
    });
    it('extend across combinators correctly', () => {
      const r = extendViaOwn(sel([el('.parent'), co('>'), el('.child')]), el('.parent'), el('.container'), true, '.parent>.child find .parent partial');
      expect(r.valueOf()).toBe(':is(.parent,.container)>.child');
    });
    it('extend with :is() selector - extract selectors from :is()', () => {
      const r = extendViaOwn(el('.foo'), el('.foo'), is(sellist([el('.ext3'), el('.ext4')])), false, '.foo find .foo ext :is() full');
      expect(r.valueOf()).toBe('.foo,.ext3,.ext4');
    });
    it('extend with :is() selector in partial mode', () => {
      const r = extendViaOwn(
        sel([el('.foo'), co(' '), el('.bar')]),
        el('.bar'), is(sellist([el('.ext3'), el('.ext4')])), true, '.foo .bar find .bar ext :is() partial'
      );
      expect(r.valueOf()).toBe('.foo :is(.bar,.ext3,.ext4)');
    });
  });

  describe('Error conditions', () => {
    it('NOT_FOUND when no match', () => {
      const r = extendViaOwn(el('.a'), el('.b'), el('.c'), false, '.a find .b NOT_FOUND');
      expect(r).toBe('NOT_FOUND');
    });
  });
});
