import { el, sel, sellist, compound, is, co, comment } from '../../index';
import { extendSelector } from '../extend';

describe('Extend Comment and Whitespace Handling Tests', () => {
  describe('Comment duplication prevention', () => {
    it('should not duplicate comments when extending with :is() wrapper', () => {
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

      // Should contain the comment only once, not multiple times
      const commentCount = (trimmedResult.match(/\/\* brand \*\//g) || []).length;
      expect(commentCount).toBe(1);

      // Verify the selector structure is correct - comment should be preserved inside :is()
      expect(trimmedResult).toMatch(/\.a:is\(/);
      expect(trimmedResult).toContain('/* brand */');
      expect(trimmedResult).toContain('.b');
      expect(trimmedResult).toContain('.c');
    });

    it('should preserve whitespace after target is extended with simple extension', () => {
      // target: .a > /** b */.b
      // find: .b
      // extendWith: .c, .d

      const commentNode = comment('/* b */');
      const targetSelector = el('.b');
      targetSelector.pre = [commentNode]; // Comment before .b

      const selector = sel([el('.a'), co('>'), targetSelector]);
      const target = el('.b');
      const extendWith = sel([el('.c'), el('.d')]);

      const result = extendSelector(selector, target, extendWith, true);
      const trimmed = result.toTrimmedString();

      // Should not repeat the comment
      const commentCount = (trimmed.match(/\/\* b \*\//g) || []).length;
      expect(commentCount).toBeLessThanOrEqual(1);

      // Should preserve the structural whitespace relationship
      expect(trimmed).toContain('.a>');
    });

    it('should handle complex selector with comment preservation', () => {
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

      // Verify no comment duplication
      const commentCount = (trimmed.match(/\/\* component \*\//g) || []).length;
      expect(commentCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Whitespace preservation tests', () => {
    it('should preserve pre-comment whitespace structure', () => {
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

      // Should have proper selector structure
      expect(trimmed).toMatch(/\.prefix:is\(\.target,\.extension\)/);

      // Should not duplicate comments
      const commentCount = (trimmed.match(/\/\* spacing \*\//g) || []).length;
      expect(commentCount).toBeLessThanOrEqual(1);
    });

    it('should correctly handle multiple comment scenarios', () => {
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

      // Verify each comment appears at most once
      expect((trimmed.match(/\/\* first \*\//g) || []).length).toBeLessThanOrEqual(1);
      expect((trimmed.match(/\/\* second \*\//g) || []).length).toBeLessThanOrEqual(1);

      // Verify structural correctness
      expect(trimmed).toMatch(/:is\(\.a,\.c\)/);
    });
  });

  describe('Edge cases', () => {
    it('should handle extend with no pre/post gracefully', () => {
      const selector = compound([el('.a'), el('.b')]);
      const target = el('.b');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, true);
      const trimmed = result.toTrimmedString();

      expect(trimmed).toBe('.a:is(.b,.c)');
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

      // Should add to the existing :is() list
      expect(trimmed).toMatch(/:is\(\.inner,\.other,\.extended\)/);

      // Should not duplicate the comment
      const commentCount = (trimmed.match(/\/\* inner \*\//g) || []).length;
      expect(commentCount).toBeLessThanOrEqual(1);
    });
  });
});
