import { el, sel, sellist, compound, is, co, comment } from '../../index';
import { extendSelector } from '../extend';

describe('Extend Comment and Whitespace Handling Tests', () => {
  describe('Comment duplication prevention', () => {
    it('should extend compound selector with :is() wrapper preserving comments', () => {
      // Create a target selector with a comment in pre
      const target = el('.b');
      const commentNode = comment('/* brand */');
      target.pre = [commentNode];

      // Create selector that contains the target
      const selector = compound([el('.a'), target]);

      const extendWith = el('.c');

      // Extend with partial matching - this creates :is() wrapper
      const result = extendSelector(selector, target, extendWith, true);

      // toTrimmedString should not show duplicated comments
      const trimmedResult = result.toTrimmedString();

      // Assert the exact output - shows how compound selector extension works with comments
      expect(trimmedResult).toBe('.a/* brand */:is(.b, .c)');

      // Should contain the comment only once, not multiple times
      const commentCount = (trimmedResult.match(/\/\* brand \*\//g) || []).length;
      expect(commentCount).toBe(1);
    });

    it('should extend complex selector creating selector list (comment lost)', () => {
      // Original: .a > /* b */.b
      // Target: .b
      // ExtendWith: .c, .d (selector list)

      const commentNode = comment('/* b */');
      const targetSelector = el('.b');
      targetSelector.pre = [commentNode]; // Comment before .b

      const selector = sel([el('.a'), co('>'), targetSelector]);
      const target = el('.b');
      const extendWith = sel([el('.c'), el('.d')]);

      const result = extendSelector(selector, target, extendWith, true);
      const trimmed = result.toTrimmedString();

      // Assert the exact expected output - this shows how extension preserves comments
      expect(trimmed).toBe('.a > /* b */:is(.b, .c.d)');

      // Verify comment handling - comment should be preserved on the original component
      expect(trimmed).toContain('/* b */');

      // Verify no comment duplication
      const commentCount = (trimmed.match(/\/\* b \*\//g) || []).length;
      expect(commentCount).toBe(1);
    });

    it('should extend complex nested selector creating selector list', () => {
      // target: .a > .b.c > .d.e
      // comment before .b
      const commentNode = comment('/* component */');
      const bSelector = el('.b');
      bSelector.pre = [commentNode];

      const selector = sel([
        el('.a'),
        co('>'),
        compound([bSelector, el('.c')]),
        co('>'),
        compound([el('.d'), el('.e')])
      ]);

      const target = el('.b');
      const extendWith = el('.f');

      const result = extendSelector(selector, target, extendWith, true);
      const trimmed = result.toTrimmedString();

      // Assert the exact output - shows how component-level extension uses :is() wrapper
      expect(trimmed).toBe('.a > /* component */:is(.b, .f).c > .d.e');

      // Verify no comment duplication
      const commentCount = (trimmed.match(/\/\* component \*\//g) || []).length;
      expect(commentCount).toBe(1);
    });
  });

  describe('Whitespace preservation tests', () => {
    it('should extend compound selector preserving pre-comments', () => {
      // Test that whitespace structure around comments is maintained
      const commentNode = comment('/* spacing */');
      const targetSelector = el('.target');

      // Set up: comment + target (simplified)
      targetSelector.pre = [commentNode];

      const selector = compound([el('.prefix'), targetSelector]);
      const target = el('.target');
      const extendWith = el('.extension');

      const result = extendSelector(selector, target, extendWith, true);

      // The result should preserve the original spacing intent
      // without duplicating the comment structure
      const trimmed = result.toTrimmedString();

      // Assert exact output - shows how pre-comment whitespace works with compound selectors
      expect(trimmed).toBe('.prefix/* spacing */:is(.target, .extension)');

      // Should not duplicate comments
      const commentCount = (trimmed.match(/\/\* spacing \*\//g) || []).length;
      expect(commentCount).toBe(1);
    });

    it('should extend compound selector with multiple comments', () => {
      // Create a more complex scenario with multiple comments
      const comment1 = comment('/* first */');
      const comment2 = comment('/* second */');

      const targetA = el('.a');
      const targetB = el('.b');
      targetA.pre = [comment1];
      targetB.pre = [comment2];

      const selector = compound([targetA, targetB]);
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, true);
      const trimmed = result.toTrimmedString();

      // Assert exact output - shows how multiple comments are handled in compound selectors
      expect(trimmed).toBe('/* first */:is(.a, .c)/* second */.b');

      // Verify each comment appears exactly once
      expect((trimmed.match(/\/\* first \*\//g) || []).length).toBe(1);
      expect((trimmed.match(/\/\* second \*\//g) || []).length).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle extend with no pre/post gracefully', () => {
      const selector = compound([el('.a'), el('.b')]);
      const target = el('.b');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, true);
      const trimmed = result.toTrimmedString();

      expect(trimmed).toBe('.a:is(.b, .c)');
    });

    it('should handle nested :is() extension without comment duplication', () => {
      // Test extending a selector that already contains :is()
      const innerComment = comment('/* inner */');
      const innerTarget = el('.inner');
      innerTarget.pre = [innerComment];

      const selector = is(sellist([innerTarget, el('.other')]));
      const target = el('.inner');
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, false);
      const trimmed = result.toTrimmedString();

      // Assert exact output - shows how nested :is() extension works with full matching
      // Original :is() should be preserved since it wasn't created by extend
      expect(trimmed).toBe(':is(/* inner */.inner, .other, .extended)');

      // Should not duplicate the comment
      const commentCount = (trimmed.match(/\/\* inner \*\//g) || []).length;
      expect(commentCount).toBe(1);
    });
  });
});
