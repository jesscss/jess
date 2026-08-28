/**
 * MEMO KEY-COLLISION GUARD (extend-matcher pass-scoped memoization)
 *
 * `wouldExtendChange` is memoized for one `processExtends` pass, keyed on
 *   `${partial} ${target} ${find} ${extendWith} ${parentSelector}` (all by valueOf).
 * (commit b09439775). If any term is dropped from the key, two probes that share
 * the remaining terms but must return DIFFERENT results collide — the cache
 * returns the first answer for both, silently corrupting the extend (a missing
 * or extra extend).
 *
 * Each test below issues, WITHIN A SINGLE PASS (so the cache is live), two
 * `wouldExtendChange` probes that agree on every key term EXCEPT one, and asserts
 * they return different results. That difference is only observable if the key
 * distinguishes them — so dropping that term from the key makes the test fail.
 * (Verified: dropping `extendWith` from the key makes the extendWith case return
 * false/false instead of false/true.)
 *
 * These are the strongest, most targeted regression guards for the keying — they
 * exercise the memo directly, no rendering required.
 */
import { describe, it, expect } from 'vitest';
import { el, sel, co } from '../../index.js';
import {
  wouldExtendChange,
  beginExtendMatchPass,
  endExtendMatchPass
} from '../extend-walk.js';

describe('extend-matcher memo keying (no under-keying collisions)', () => {
  it('extendWith is keyed: self-extend (false) vs real extend (true) do not collide', () => {
    /*
     * Same (partial=false, target=.base, find=.base, parent=undefined); only
     * extendWith differs. Self-extend (extendWith===find) short-circuits to
     * false; a real extendWith (.other) yields true. Shared key terms + live
     * cache => a key missing extendWith returns the cached false for both.
     */
    beginExtendMatchPass();
    try {
      const selfExtend = wouldExtendChange(el('.base'), el('.base'), el('.base'), false);
      const realExtend = wouldExtendChange(el('.base'), el('.base'), el('.other'), false);
      expect(selfExtend).toBe(false);
      expect(realExtend).toBe(true);
    } finally {
      endExtendMatchPass();
    }
  });

  it('extendWith is keyed: order-independent (real first, then self-extend)', () => {
    /*
     * Reverse issue order: the real extend (true) is computed first, then the
     * self-extend (false). A key missing extendWith would return cached true for
     * the self-extend probe (an EXTRA/incorrect extend).
     */
    beginExtendMatchPass();
    try {
      const realExtend = wouldExtendChange(el('.base'), el('.base'), el('.other'), false);
      const selfExtend = wouldExtendChange(el('.base'), el('.base'), el('.base'), false);
      expect(realExtend).toBe(true);
      expect(selfExtend).toBe(false);
    } finally {
      endExtendMatchPass();
    }
  });

  it('partial is keyed: whole vs partial of a compound target differ', () => {
    /*
     * target `.a.b`, find `.a`. Whole (partial=false) does NOT match a component
     * of a multi-part compound (find is only a COMPONENT, not the whole node);
     * partial (partial=true) matches the component. Same target/find/extendWith/
     * parent; only `partial` differs.
     */
    const target = sel([el('.a'), el('.b')]); // compound-ish local via sel
    beginExtendMatchPass();
    try {
      const whole = wouldExtendChange(target, el('.a'), el('.c'), false);
      const partial = wouldExtendChange(target, el('.a'), el('.c'), true);
      expect(whole).toBe(false);
      expect(partial).toBe(true);
    } finally {
      endExtendMatchPass();
    }
  });

  it('parentSelector is keyed: root-exact suppressed with parent, allowed without', () => {
    /*
     * Exact (partial=false) extend of `.child` against local `.child`. Without a
     * parentSelector it's a plain root exact match (true). With a parentSelector
     * present (an ancestor `&`-context), the fully-composed selector is longer
     * than the local node, so an exact local hit is invalid at the root (false).
     * Same target/find/extendWith/partial; only parentSelector differs.
     */
    beginExtendMatchPass();
    try {
      const noParent = wouldExtendChange(el('.child'), el('.child'), el('.x'), false);
      const withParent = wouldExtendChange(el('.child'), el('.child'), el('.x'), false, el('.parent'));
      expect(noParent).not.toBe(withParent);
    } finally {
      endExtendMatchPass();
    }
  });

  it('target is keyed: different targets under shared find/extendWith/partial differ', () => {
    /*
     * Sanity: matching target (.hit) vs non-matching (.miss). Trivially different
     * results; guards against a key that omits the target entirely.
     */
    beginExtendMatchPass();
    try {
      const hit = wouldExtendChange(el('.hit'), el('.hit'), el('.x'), false);
      const miss = wouldExtendChange(el('.miss'), el('.hit'), el('.x'), false);
      expect(hit).toBe(true);
      expect(miss).toBe(false);
    } finally {
      endExtendMatchPass();
    }
  });

  it('find is keyed: matching vs non-matching find under shared target differ', () => {
    beginExtendMatchPass();
    try {
      const match = wouldExtendChange(el('.a'), el('.a'), el('.x'), false);
      const noMatch = wouldExtendChange(el('.a'), el('.b'), el('.x'), false);
      expect(match).toBe(true);
      expect(noMatch).toBe(false);
    } finally {
      endExtendMatchPass();
    }
  });

  it('complex-target component match holds under the memo (subsequence descent)', () => {
    /*
     * `.foo .bar` (complex) partial-matched by find `.bar` — a structural descent
     * a string leaf with the same valueOf could not do. Confirms the memoized
     * path returns the descent result, and re-issuing collapses to the same.
     */
    const target = sel([el('.foo'), co(' '), el('.bar')]);
    beginExtendMatchPass();
    try {
      const first = wouldExtendChange(target, el('.bar'), el('.x'), true);
      const second = wouldExtendChange(target, el('.bar'), el('.x'), true);
      expect(first).toBe(true);
      expect(second).toBe(true);
    } finally {
      endExtendMatchPass();
    }
  });
});
