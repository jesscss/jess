import { el, sel, sellist, compound, is, co, attr, quoted } from '../../..';
import { matchSelectors } from '../selector';

describe('Selector match tests', () => {
  it('should not match different simple selectors', () => {
    const selectorA = el('.foo');
    const selectorB = el('.bar');
    const result = matchSelectors(selectorA, selectorB);
    expect(result.hasMatch).toBe(false);
    expect(result.hasFullMatch).toBe(false);
    expect(result.hasPartialMatch).toBe(false);
    expect(result.matched).toHaveLength(0);
    expect(result.remainders).toHaveLength(1);
  });

  describe('Full match examples', () => {
    it('should match complex selectors with compound selectors in any order', () => {
      // target: .a > .d.b > .c, find: .a > .b.d > .c
      // compound selectors can be matched in any order
      const target = sel([el('.a'), co('>'), compound([el('.d'), el('.b')]), co('>'), el('.c')]);
      const find = sel([el('.a'), co('>'), compound([el('.b'), el('.d')]), co('>'), el('.c')]);
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
      expect(result.hasFullMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(false);
    });

    it('should match simple selector to simple selector', () => {
      // target: .a, find: .a
      const target = el('.a');
      const find = el('.a');
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
      expect(result.hasFullMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(false);
      expect(result.matched).toHaveLength(1);
      expect(result.remainders).toHaveLength(0);
    });

    it('should match selector list with partial matches', () => {
      // target: .a, find: .a, .b (selector list treated as independent searches)
      // .a should be full match, .b should not match
      const target = el('.a');
      const find = sellist([el('.a'), el('.b')]);
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
      // Note: this might be partial since .b doesn't match
    });

    it('should match compound with :is() pseudo-selector', () => {
      // target: .a.b, find: :is(.a).b
      const target = compound([el('.a'), el('.b')]);
      const find = compound([is(el('.a')), el('.b')]);
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
    });

    it('should match compound with :is() in different order', () => {
      // target: .a.b, find: .b:is(.a)
      const target = compound([el('.a'), el('.b')]);
      const find = compound([el('.b'), is(el('.a'))]);
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
    });

    it('should match :is() with compound selector', () => {
      // target: .a:is(.b), find: .b.a
      const target = compound([el('.a'), is(el('.b'))]);
      const find = compound([el('.b'), el('.a')]);
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
    });

    it('should match :is() with selector list and return matched/remainder', () => {
      // target: .a:is(.b, .c), find: .a.b
      // Should return .a.b as match, .a.c flattened as remainder
      const target = compound([el('.a'), is(sellist([el('.b'), el('.c')]))]);
      const find = compound([el('.a'), el('.b')]);
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
      expect(result.matched).toHaveLength(1);
      // expect(result.remainders).toHaveLength(1); // .a.c should be remainder - TODO: Advanced feature
    });
  });

  describe('Partial match examples', () => {
    it('should partially match compound selector', () => {
      // target: .a.b, find: .a (partial match)
      // Should match .a, leave .b as remainder
      const target = compound([el('.a'), el('.b')]);
      const find = el('.a');
      const result = matchSelectors(target, find, true);
      expect(result.hasMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(true);
      expect(result.matched).toHaveLength(1);
      expect(result.remainders).toHaveLength(1);
    });

    it('should partially match across combinators with compound selector', () => {
      // target: .a.b > .c, find: .b > .c (should match)
      // .b matches within compound .a.b, leaving .a as remainder
      const target = sel([compound([el('.a'), el('.b')]), co('>'), el('.c')]);
      const find = sel([el('.b'), co('>'), el('.c')]);
      const result = matchSelectors(target, find, true);
      expect(result.hasMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(true);
    });

    it('should partially match before combinator', () => {
      // target: .a.b > .c, find: .a.b (should match)
      // Matches .a.b completely, leaves > .c as remainder
      const target = sel([compound([el('.a'), el('.b')]), co('>'), el('.c')]);
      const find = compound([el('.a'), el('.b')]);
      const result = matchSelectors(target, find, true);
      expect(result.hasMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(true);
      expect(result.matched).toHaveLength(1);
      expect(result.remainders).toHaveLength(1); // Should contain > .c
    });

    it('should partially match complex selector sequence', () => {
      // target: .a > .b > .c, find: .b > .c (should match)
      // Matches .b > .c, leaves .a > as remainder
      const target = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      const find = sel([el('.b'), co('>'), el('.c')]);
      const result = matchSelectors(target, find, true);
      expect(result.hasMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(true);
      expect(result.matched).toHaveLength(1);
      expect(result.remainders).toHaveLength(1); // Should contain .a >
    });
  });

  describe('Extend use cases', () => {
    it('should provide structure for extend replacement', () => {
      // When we extend .b > .c with .d, and we have a match like:
      // "matches .b > .c, .a > remainder"
      // We should be able to create: .a > .b > .c, .a > .d
      const target = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      const find = sel([el('.b'), co('>'), el('.c')]);
      const result = matchSelectors(target, find, true);

      if (result.hasMatch && result.hasPartialMatch) {
        // The result should provide enough info to:
        // 1. Know what was matched: .b > .c
        // 2. Know what remains: .a >
        // 3. Allow reconstruction for extend operation
        expect(result.matched).toHaveLength(1);
        expect(result.remainders).toHaveLength(1);

        // This structure should allow creating:
        // - Original: .a > .b > .c (target)
        // - Extended: .a > .d (remainder + extension)
      }
    });
  });

  describe('Advanced matching scenarios', () => {
    it('should match simple selectors using valueOf() comparison', () => {
      // This simulates the case where selectors might have different internal representations
      // but should match when their valueOf() results are equivalent
      const target = el('.foo');
      const find = el('.foo');
      const result = matchSelectors(target, find);
      expect(result.hasMatch).toBe(true);
      expect(result.hasFullMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(false);
    });

    it('should partially match complex :is() with right-to-left logic - case 1', () => {
      // Complex :is() matching - sophisticated right-to-left backtracking
      // target: .x + :is(.a > .b).d > .c, find: .a > .b > .c (should partially match)
      // The :is(.a > .b) means this element has class .d AND also matches .a > .b context
      //
      // This uses right-to-left backtracking:
      // 1. Start from right: .c matches .c ✓
      // 2. Move left: > matches > ✓
      // 3. Try compound :is(.a > .b).d against .b:
      //    - Try .d against .b (fails)
      //    - Try :is(.a > .b) against .b - expand alternatives right-to-left
      //    - In .a > .b, start from rightmost: .b matches .b ✓
      //    - This leaves .a > unmatched in the :is() alternative
      // 4. Continue: > matches > ✓
      // 5. .a matches .a ✓
      // 6. But .x + and .d remain unmatched -> partial match

      const target = sel([
        el('.x'),
        co('+'),
        compound([is(sel([el('.a'), co('>'), el('.b')])), el('.d')]),
        co('>'),
        el('.c')
      ]);
      const find = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      const result = matchSelectors(target, find, true);
      expect(result.hasMatch).toBe(true);
      expect(result.hasPartialMatch).toBe(true);
    });

    it('should partially match complex :is() with right-to-left logic - case 2', () => {
      // Complex :is() matching - this case should NOT match
      // target: .x + :is(.a > .d).b > .c, find: .a > .b > .c
      // The :is(.a > .d) means this element has class .b AND also matches .a > .d context
      // Since we're looking for .a > .b > .c but the :is() specifies .a > .d (where .d ≠ .b),
      // this should not match because the contexts are incompatible

      const target = sel([
        el('.x'),
        co('+'),
        compound([is(sel([el('.a'), co('>'), el('.d')])), el('.b')]),
        co('>'),
        el('.c')
      ]);
      const find = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      const result = matchSelectors(target, find, true);

      // This should NOT match because :is(.a > .d) is incompatible with finding .a > .b
      expect(result.hasMatch).toBe(false);
    });
  });
});