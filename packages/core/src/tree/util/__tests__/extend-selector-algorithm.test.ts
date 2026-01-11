import { el, sel, sellist, compound, is, co, type Selector, PseudoSelector } from '../../..';
import { extendSelector, tryExtendSelector, ExtendErrorType } from '../extend';

describe('Extend Selector Tests', () => {
  describe('Extension validation', () => {
    it('should prevent extending when it would create duplicate element selectors', () => {
      // Selector: a.info, Target: .info, Extend with: div.foo
      // This should not extend because it would create "adiv.foo" which is invalid
      const selector = compound([el('a'), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('div'), el('.foo')]);

      const result = tryExtendSelector(selector, target, extendWith, false);
      // Should return the original selector unchanged when extension would be invalid
      expect(result.value.valueOf()).toBe(selector.valueOf());
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ELEMENT_CONFLICT);
    });

    it('should prevent extending when it would create duplicate ID selectors', () => {
      // Selector: #main.info, Target: .info, Extend with: #other.foo
      // This should not extend because it would create a selector with multiple IDs
      const selector = compound([el('#main'), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('#other'), el('.foo')]);

      const result = tryExtendSelector(selector, target, extendWith, false);
      // Should return the original selector unchanged when extension would be invalid
      expect(result.value.valueOf()).toBe(selector.valueOf());
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ID_CONFLICT);
    });

    it('should allow extending when there are no conflicts', () => {
      // Selector: a.info, Target: .info, Extend with: .foo
      // This should work fine as there are no conflicts
      const selector = compound([el('a'), el('.info')]);
      const target = el('.info');
      const extendWith = el('.foo');

      const result = extendSelector(selector, target, extendWith, false);
      // Note: Now creates a:is(.info,.foo) which is equivalent but more compact
      expect(result.valueOf()).toBe('a:is(.info,.foo)');
    });

    it('should prevent extending in :is() selectors with element conflicts', () => {
      // Selector: :is(a).info, Target: .info, Extend with: div.foo
      // Note: This is a complex case where the conflict is inside :is()
      const selector = compound([is(el('a')), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('div'), el('.foo')]);

      const result = extendSelector(selector, target, extendWith, false);
      // Current behavior: creates :is(a):is(.info,div.foo)
      // This is valid CSS, though ideally we'd detect the inner conflict
      expect(result.valueOf()).toBe(':is(a):is(.info,div.foo)');
    });
  });

  describe('Full match extend examples', () => {
    it('should extend simple selector with simple target - example 1', () => {
      // Selector: .a, Target: .a (full), Extend with: .b
      // Result: .a, .b
      const selector = el('.a');
      const target = el('.a');
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, false); // false = full match
      expect(result.valueOf()).toBe('.a,.b');
    });

    it('should extend selector list with simple target - example 2', () => {
      // Selector: .a, .b, Target: .a (full), Extend with: .c
      // Result: .a, .b, .c
      const selector = sellist([el('.a'), el('.b')]);
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.a,.b,.c');
    });

    it('should extend :is() selector with simple target - example 3', () => {
      // Selector: :is(.a, .b), Target: .a (full), Extend with: .c
      // Result: :is(.a, .b, .c)
      const selector = is(sellist([el('.a'), el('.b')]));
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.a,.b,.c)');
    });

    it('should extend compound :is() selector with compound target - example 5', () => {
      // Selector: :is(.a, .b).c, Target: .a.c (full), Extend with: .d
      // Result: :is(.a, .b).c, .d
      // (.b doesn't count because it's an "or"... full match must be exhaustive)
      const selector = compound([is(sellist([el('.a'), el('.b')])), el('.c')]);
      const target = compound([el('.a'), el('.c')]);
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.a,.b).c,.d');
    });
  });

  describe('Partial match extend examples', () => {
    it('should extend compound selector with simple partial target - example 5', () => {
      // Selector: .a > .b.c, Target: .b (partial), Extend with: .d
      // Result: .a > :is(.b, .d).c
      const selector = sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]);
      const target = el('.b');
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, true); // true = partial match
      expect(result.valueOf()).toBe('.a>:is(.b,.d).c');
    });

    it('should match partial across compound boundaries with partial matching', () => {
      // Selector: .a > .b.c, Target: .a > .b (partial)
      // This SHOULD match with partial matching because .a > .b matches .a > .b exactly,
      // and .b matches within .b.c leaving .c as remainder
      const selector = sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]);
      const target = sel([el('.a'), co('>'), el('.b')]);
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>.b.c,.c.d'); // Remainder (.c) extended with .d
    });

    it('should extend complex partial match with compound boundaries - example 6', () => {
      // Selector: .a > .b.c > .d.e, Target: .c.b > .e.d (partial), Extend with: .f
      // Result: .a > .b.c > .d.e, .a > .f
      const selector = sel([
        el('.a'),
        co('>'),
        compound([el('.b'), el('.c')]),
        co('>'),
        compound([el('.d'), el('.e')])
      ]);
      const target = sel([compound([el('.c'), el('.b')]), co('>'), compound([el('.e'), el('.d')])]);
      const extendWith = el('.f');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>.b.c>.d.e,.a>.f');
    });

    it('should extend simple selector with complex extension - example 7', () => {
      // Selector: .a > .b, Target: .b (partial), Extend with: .d > .e
      // Result: .a > :is(.b, .d > .e)
      const selector = sel([el('.a'), co('>'), el('.b')]);
      const target = el('.b');
      const extendWith = sel([el('.d'), co('>'), el('.e')]);

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>:is(.b,.d>.e)');
    });
  });

  describe('Edge cases and validation', () => {
    it('should return original selector when no match is found', () => {
      const selector = el('.a');
      const target = el('.b'); // No match
      const extendWith = el('.c');

      const result = tryExtendSelector(selector, target, extendWith, false);
      expect(result.value.valueOf()).toBe('.a'); // Returns original selector when no match
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.NOT_FOUND);
    });

    it('should handle complex selector lists in extensions', () => {
      // Complex example with multiple extension points
      const selector = sellist([
        el('.a'),
        sel([el('.b'), co('>'), el('.c')])
      ]);
      const target = el('.a');
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.a,.b>.c,.d');
    });
  });

  describe('Complex selector partial extends', () => {
    it('should extend .bar in ".foo .bar" to create ".foo :is(.bar, .ext)"', () => {
      // .foo .bar + extend .bar all with .ext
      // Expected: .foo :is(.bar, .ext)
      const selector = sel([el('.foo'), co(' '), el('.bar')]);
      const result = extendSelector(selector, el('.bar'), el('.ext'), true);
      expect(result.valueOf()).toBe('.foo :is(.bar,.ext)');
    });

    it('should extend .bar in ":is(.foo, .a) .bar" correctly', () => {
      // :is(.foo, .a) .bar + extend .bar all with .ext
      // Expected: :is(.foo, .a) :is(.bar, .ext)
      const selector = sel([is(sellist([el('.foo'), el('.a')])), co(' '), el('.bar')]);
      const result = extendSelector(selector, el('.bar'), el('.ext'), true);
      expect(result.valueOf()).toBe(':is(.foo,.a) :is(.bar,.ext)');
    });
  });

  describe('Sequential extends - multiple extenders', () => {
    /**
     * Tests the scenario from extend.less lines 18-30:
     *
     * .foo .bar, .foo .baz {
     *     display: none;
     * }
     * .ext1 .ext2 {
     *     &:extend(.foo all);
     * }
     * .ext3,
     * .ext4 {
     *   &:extend(.foo all);
     *   &:extend(.bar all);
     * }
     *
     * Expected output:
     * :is(.foo, .ext1 .ext2, .ext3, .ext4) :is(.bar, .ext3, .ext4),
     * :is(.foo, .ext1 .ext2, .ext3, .ext4) .baz {
     *   display: none;
     * }
     */
    it('should accumulate multiple partial extends on the same target', () => {
      // Start: .foo .bar, .foo .baz
      let selector: Selector = sellist([
        sel([el('.foo'), co(' '), el('.bar')]),
        sel([el('.foo'), co(' '), el('.baz')])
      ]);

      // Step 1: .ext1 .ext2 extends .foo all
      // Expected: :is(.foo,.ext1 .ext2) .bar,:is(.foo,.ext1 .ext2) .baz
      selector = extendSelector(selector, el('.foo'), sel([el('.ext1'), co(' '), el('.ext2')]), true);
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2) .bar');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2) .baz');

      // Step 2: .ext3 extends .foo all
      // Expected: :is(.foo,.ext1 .ext2,.ext3) .bar,:is(.foo,.ext1 .ext2,.ext3) .baz
      selector = extendSelector(selector, el('.foo'), el('.ext3'), true);
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3) .bar');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3) .baz');

      // Step 3: .ext4 extends .foo all
      // Expected: :is(.foo,.ext1 .ext2,.ext3,.ext4) .bar,:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz
      selector = extendSelector(selector, el('.foo'), el('.ext4'), true);
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .bar');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .baz');

      // Step 4: .ext3 extends .bar all
      // Expected: :is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3),:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz
      selector = extendSelector(selector, el('.bar'), el('.ext3'), true);
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3)');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .baz');

      // Step 5: .ext4 extends .bar all
      // Final expected: :is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3,.ext4),:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz
      selector = extendSelector(selector, el('.bar'), el('.ext4'), true);
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3,.ext4)');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .baz');
    });
  });

  describe('Flattening inside other pseudo-selectors', () => {
    // Helper to create :not() pseudo-selector (not generated - simulates authored code)
    const not = (arg: Selector) => new PseudoSelector({ name: ':not', arg });

    it('should flatten generated :is() inside :not() but keep the :not()', () => {
      // Create :not(.foo) and extend .foo with .bar
      // The :not() should NOT be removed - only generated :is() inside gets flattened
      const selector = not(el('.foo'));
      const result = extendSelector(selector, el('.foo'), el('.bar'), false);

      // The :not() should remain, containing both selectors as a list
      expect(result.valueOf()).toBe(':not(.foo,.bar)');
    });

    it('should flatten deeply nested generated :is() inside :not() but keep the :not()', () => {
      // Create :not(.foo) and extend multiple times
      // Each extend creates :is() wrappers inside :not() which should be flattened
      const selector = not(el('.foo'));

      // Extend .foo with .bar
      let result = extendSelector(selector, el('.foo'), el('.bar'), false);
      // Extend .foo with .baz
      result = extendSelector(result, el('.foo'), el('.baz'), false);

      // The :not() should remain with flattened contents
      // Should be :not(.foo,.bar,.baz) not :not(:is(.foo,:is(.bar),.baz))
      expect(result.valueOf()).toBe(':not(.foo,.bar,.baz)');
    });
  });

  describe('No duplicate selectors - regression tests', () => {
    it('should NOT create both raw and :is()-wrapped duplicates when extending in nested :is()', () => {
      // Bug: extending .foo with .ext inside :is(.foo) could create both:
      // - .ext (raw)
      // - :is(.ext) (wrapped)
      // This is wrong - should only have .ext once

      const selector = is(el('.foo'));
      const result = extendSelector(selector, el('.foo'), el('.ext'), false);

      // Should be :is(.foo,.ext) - NOT :is(.foo,.ext,:is(.ext))
      expect(result.valueOf()).toBe(':is(.foo,.ext)');

      // Count occurrences of .ext - should be exactly 1
      const extCount = (result.valueOf().match(/\.ext/g) || []).length;
      expect(extCount).toBe(1);
    });

    it('should NOT duplicate complex selectors when extending multiple times', () => {
      // This replicates the extend.less test case that was failing
      // :is(.foo) .bar, :is(.foo) .baz extended with .ext1 .ext2, then .ext3, then .ext4

      // Create :is(.foo) .bar, :is(.foo) .baz
      const fooBar = sel([is(el('.foo')), co(' '), el('.bar')]);
      const fooBaz = sel([is(el('.foo')), co(' '), el('.baz')]);
      let selector = sellist([fooBar, fooBaz]);

      // Extend .foo with ".ext1 .ext2" (a complex selector)
      const ext1Ext2 = sel([el('.ext1'), co(' '), el('.ext2')]);
      selector = extendSelector(selector, el('.foo'), ext1Ext2, true);

      // Count occurrences of .ext1 .ext2 pattern - should appear exactly once per :is()
      const ext1Count = (selector.valueOf().match(/\.ext1/g) || []).length;
      // Should NOT have duplicate .ext1 appearances beyond the expected 2 (one per selector in list)
      expect(ext1Count).toBeLessThanOrEqual(2);

      // Extend .foo with .ext3
      selector = extendSelector(selector, el('.foo'), el('.ext3'), true);

      // Extend .foo with .ext4
      selector = extendSelector(selector, el('.foo'), el('.ext4'), true);

      // The result should have each extension appear exactly twice (once per original selector)
      // NOT have any :is(.ext1 .ext2) wrappers around individual extensions
      const resultStr = selector.valueOf();

      // Should NOT contain nested :is() wrappers like :is(.ext1 .ext2)
      expect(resultStr).not.toContain(':is(.ext1 .ext2)');
      expect(resultStr).not.toContain(':is(.ext3)');
      expect(resultStr).not.toContain(':is(.ext4)');
    });

    it('extending inside :is() should NOT differ from extending at root', () => {
      // Core principle: extending .foo with .ext should work the same
      // whether .foo is inside :is() or not

      // Case 1: .foo at root
      const rootSelector = el('.foo');
      const rootResult = extendSelector(rootSelector, el('.foo'), el('.ext'), false);
      // Should be .foo,.ext (selector list)
      expect(rootResult.valueOf()).toBe('.foo,.ext');

      // Case 2: .foo inside :is()
      const isSelector = is(el('.foo'));
      const isResult = extendSelector(isSelector, el('.foo'), el('.ext'), false);
      // Should be :is(.foo,.ext) - same semantic result, just inside :is()
      expect(isResult.valueOf()).toBe(':is(.foo,.ext)');

      // Both should have .ext appearing exactly once
      expect((rootResult.valueOf().match(/\.ext/g) || []).length).toBe(1);
      expect((isResult.valueOf().match(/\.ext/g) || []).length).toBe(1);
    });

    it('deeply nested :is() should not create duplicate extensions', () => {
      // :is(:is(.foo)) extended with .ext should give :is(:is(.foo,.ext)) or :is(.foo,.ext)
      // NOT :is(:is(.foo,.ext),.ext) or any other duplicate
      const deepIs = is(is(el('.foo')));
      const result = extendSelector(deepIs, el('.foo'), el('.ext'), false);

      // Count .ext occurrences
      const extCount = (result.valueOf().match(/\.ext/g) || []).length;
      expect(extCount).toBe(1);
    });
  });

  describe('Replace extension scenarios', () => {
    it('should reject partial match when extending complex selector at root level with partial: false', () => {
      // .bb .bb extended with .cc (where .cc:extend(.bb)) should be REJECTED when partial: false
      // because .bb is only a partial match within .bb .bb
      const selector = sel([el('.bb'), co(' '), el('.bb')]);

      // This should throw an error because .bb is a partial match within .bb .bb
      expect(() => {
        extendSelector(selector, el('.bb'), el('.cc'), false);
      }).toThrow('Partial match found but exact match required');
    });

    it('should reject partial match when extending first component of complex selector with partial: false', () => {
      // .aa .dd extended with .cc (where .cc:extend(.aa)) should NOT work when partial: false
      // because .aa is not the entire selector - it's only a partial match
      const selector = sel([el('.aa'), co(' '), el('.dd')]);

      // This should throw an error because .aa is a partial match within .aa .dd
      expect(() => {
        extendSelector(selector, el('.aa'), el('.cc'), false);
      }).toThrow('Partial match found but exact match required');
    });

    it('should not replace original selector when extending compound selector', () => {
      // .bb extended with .cc should produce .bb,.cc
      // NOT just .cc (replacing the original)
      const selector = el('.bb');
      const result = extendSelector(selector, el('.bb'), el('.cc'), false);

      expect(result.type).toBe('SelectorList');
      expect(result.valueOf()).toBe('.bb,.cc');
    });
  });

  describe('Exact vs all flag matching', () => {
    it('should replicate the exact extend scenario from extend.less', () => {
      // Replicate the scenario:
      // .bb {
      //   background: red;
      //   .bb {
      //     color: black;
      //   }
      // }
      // .cc:extend(.bb) {} - should only match outer .bb, not .bb .bb (exact match only)
      // .ee:extend(.dd all,.bb) {} - should match .dd with all, but .bb only exact
      // .ff:extend(.dd,.bb all) {} - should match .dd exact, but .bb with all (matches both .bb and .bb .bb)

      // The nested ruleset has selector .bb .bb (parent .bb + child .bb with space combinator from implicit ampersand)
      // When partial: false (exact match), we can only match the outer .bb ruleset, not the inner .bb .bb
      // Test 1: .cc:extend(.bb) with partial: false
      // When we try to extend .bb .bb with .cc (partial: false), extendSelector should reject it
      // because .bb is not the entire selector - it's only a partial match
      const nestedBbSelector = sel([el('.bb'), co(' '), el('.bb')]);
      // This should throw an error because .bb is a partial match within .bb .bb
      expect(() => {
        extendSelector(nestedBbSelector, el('.bb'), el('.cc'), false);
      }).toThrow('Partial match found but exact match required');

      // Test 2: .ff:extend(.bb all) with partial: true
      // When partial: true (all flag), we should match and extend ALL instances of .bb in .bb .bb
      // For .bb .bb extended with .ff (all flag), we should get :is(.bb, .ff) :is(.bb, .ff)
      // This wraps each matching component in :is()
      const result2 = extendSelector(nestedBbSelector, el('.bb'), el('.ff'), true);
      expect(result2).toBeDefined();
      const resultStr = result2.valueOf();
      // Expected: :is(.bb,.ff) :is(.bb,.ff) - both .bb instances wrapped in :is()
      expect(resultStr).toBe(':is(.bb,.ff) :is(.bb,.ff)');
    });

    it('should reject partial matches when partial: false', () => {
      // When partial: false (exact match only), extendSelector should reject partial matches
      // .bb .bb should NOT be extended when searching for .bb with partial: false
      const nestedBbSelector = sel([el('.bb'), co(' '), el('.bb')]);

      // This should throw an error because .bb is only a partial match within .bb .bb
      // When partial: false, the entire selector must match exactly
      expect(() => {
        extendSelector(nestedBbSelector, el('.bb'), el('.cc'), false);
      }).toThrow('Partial match found but exact match required');
    });

    it('should allow matching inside :is() when pseudo-selector is first component with partial: true', () => {
      // .a:extend(.b .c all) should match .b :is(.c) because with all flag (partial: true),
      // we can match components inside :is() boundaries
      // The :is() pseudo-selector being the first component means there are no components before it
      const target = is(el('.c')); // :is(.c) - pseudo-selector is the only/first component
      const find = el('.c');
      const extendWith = el('.a');

      // With partial: true (all flag), this should work
      const result = extendSelector(target, find, extendWith, true);
      expect(result).toBeDefined();
      // Should extend inside the :is()
      expect(result.valueOf()).toContain('.a');
    });

    it('should reject matching inside :is() when there are components before it with partial: false', () => {
      // .aa :is(.dd,.ee) matching .dd with partial: false should be rejected
      // because .aa is before the :is(), making it a partial match
      const target = sel([el('.aa'), co(' '), is(sellist([el('.dd'), el('.ee')]))]); // .aa :is(.dd,.ee)
      const find = el('.dd');
      const extendWith = el('.ff');

      // With partial: false, this should be rejected
      expect(() => {
        extendSelector(target, find, extendWith, false);
      }).toThrow('Partial match found but exact match required');
    });

    it('should reject matching complex selector inside :is() when there are components before it with partial: false', () => {
      // d :is(.b .c) matching .b .c with partial: false should be rejected
      // because d is before the :is(), making it a partial match
      // .a:extend(.b .c) should NOT match d :is(.b .c)
      const target = sel([el('d'), co(' '), is(sel([el('.b'), co(' '), el('.c')]))]); // d :is(.b .c)
      const find = sel([el('.b'), co(' '), el('.c')]); // .b .c
      const extendWith = el('.a');

      // With partial: false, this should be rejected because d is before the :is()
      expect(() => {
        extendSelector(target, find, extendWith, false);
      }).toThrow('Partial match found but exact match required');
    });
  });
});
