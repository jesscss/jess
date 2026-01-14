import { el, compound, sel, sellist, is } from '../../..';
import { extendSelector, tryExtendSelector, ExtendErrorType } from '../extend';

describe('Extend Duplicate Element/ID Validation', () => {
  describe('Should prevent invalid extensions', () => {
    /** @unverified - LLM-generated, needs review */
    it('should return original selector when extending a.info with div.foo (element conflict)', () => {
      // This is the original bug case: a.info with div.foo -> would create "adiv.foo"
      // Use partial: true to allow the match, then conflict detection should catch it
      const selector = compound([el('a'), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('div'), el('.foo')]);

      const result = tryExtendSelector(selector, target, extendWith, true);
      expect(result.value.valueOf()).toBe('a.info'); // Should return original selector unchanged
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ELEMENT_CONFLICT);
      expect(result.error!.message).toContain('Cannot combine different element types');
    });

    /** @unverified - LLM-generated, needs review */
    it('should return original selector when extending compound with conflicting element', () => {
      // Use partial: true to allow the match, then conflict detection should catch it
      const selector = compound([el('div'), el('.class')]);
      const target = el('.class');
      const extendWith = compound([el('span'), el('.other')]);

      const result = tryExtendSelector(selector, target, extendWith, true);
      expect(result.value.valueOf()).toBe('div.class'); // Should return original selector unchanged
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ELEMENT_CONFLICT);
      expect(result.error!.message).toContain('Cannot combine different element types');
    });

    /** @unverified - LLM-generated, needs review */
    it('should return original selector when extending compound with conflicting ID', () => {
      // Use partial: true to allow the match, then conflict detection should catch it
      const selector = compound([el('#first'), el('.class')]);
      const target = el('.class');
      const extendWith = compound([el('#second'), el('.other')]);

      const result = tryExtendSelector(selector, target, extendWith, true);
      expect(result.value.valueOf()).toBe('#first.class'); // Should return original selector unchanged
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ID_CONFLICT);
      expect(result.error!.message).toContain('Cannot combine different ID selectors');
    });
  });

  describe('Should allow valid extensions', () => {
    it('should allow extending #id1 with #id2 (selector list is valid)', () => {
      // Note: #id1,#id2 is valid CSS (selector list), unlike #id1#id2 which would be invalid
      const selector = el('#id1');
      const target = el('#id1');
      const extendWith = el('#id2');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('#id1,#id2'); // Selector list is valid CSS
    });
    it('should allow extending .a with .b (no conflict)', () => {
      const selector = el('.a');
      const target = el('.a');
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.a,.b');
    });

    it('should allow extending div.a with .b (no conflict)', () => {
      // Use partial: true because .a is only part of the compound selector
      const selector = compound([el('div'), el('.a')]);
      const target = el('.a');
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, true);
      // Note: This creates div:is(.a,.b) which is equivalent to div.a,.b but more compact
      expect(result.valueOf()).toBe('div:is(.a,.b)');
    });

    it('should allow extending across different selector contexts', () => {
      // This should be allowed: div:is(a > .foo) - the 'div' and 'a' are in different contexts
      const complexInner = sel([el('a'), el('>'), el('.foo')]);
      const pseudoSelector = compound([el('div'), is(complexInner)]);
      const target = el('.foo');
      const extendWith = el('.bar');

      // This should not throw because 'div' and any element in extendWith are in different compound contexts
      expect(() => {
        extendSelector(pseudoSelector, target, extendWith, false);
      }).not.toThrow();
    });

    it('should allow extending elements in different complex selector parts', () => {
      // a > div.class - extending .class with span.other should be allowed
      // because 'a' and 'span' are in different parts of the complex selector
      const selector = sel([el('a'), el('>'), compound([el('div'), el('.class')])]);
      const target = el('.class');
      const extendWith = compound([el('span'), el('.other')]);

      expect(() => {
        extendSelector(selector, target, extendWith, false);
      }).not.toThrow();
    });

    it('should allow element + class extending with different element + class', () => {
      // div.one extending with span.two should work fine in most contexts
      const selector = compound([el('div'), el('.one')]);
      const target = compound([el('div'), el('.one')]);
      const extendWith = compound([el('span'), el('.two')]);

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('div.one,span.two');
    });
  });

  describe('Edge cases', () => {
    it('should handle extending within :is() pseudo-selector correctly', () => {
      // :is(.a, .b) - extending .a with .c should work fine
      const selector = is(sellist([el('.a'), el('.b')]));
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toContain('.c');
    });

    it('should allow same element type in different selector list items', () => {
      // .a, div.b - should be allowed because they're separate alternatives
      const selector = sellist([el('.a'), compound([el('div'), el('.b')])]);
      const target = el('.a');
      const extendWith = compound([el('span'), el('.c')]);

      expect(() => {
        extendSelector(selector, target, extendWith, false);
      }).not.toThrow();
    });

    it('should allow duplicate same ID selectors for specificity (#foo#foo)', () => {
      // #foo#foo is valid CSS used to increase specificity
      const selector = compound([el('#foo'), el('#foo')]);
      const target = compound([el('#foo'), el('#foo')]);
      const extendWith = el('.bar');

      expect(() => {
        extendSelector(selector, target, extendWith, false);
      }).not.toThrow();

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('#foo#foo,.bar');
    });

    it('should allow extending #foo with #foo (same ID)', () => {
      // Extending #foo with #foo should be allowed - they're the same ID
      // With deduplication, this should result in just #foo since they're identical
      const selector = el('#foo');
      const target = el('#foo');
      const extendWith = el('#foo');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('#foo'); // Deduplication removes identical selectors
    });

    it('should allow compound with same element types (div.a with div.b)', () => {
      // div.a extending with div.b should be allowed - same element type
      // Use partial: true because .a is only part of the compound selector
      const selector = compound([el('div'), el('.a')]);
      const target = el('.a');
      const extendWith = compound([el('div'), el('.b')]);

      expect(() => {
        extendSelector(selector, target, extendWith, true);
      }).not.toThrow();

      const result = extendSelector(selector, target, extendWith, true);
      // Should create div:is(.a,div.b) which normalizes to div:is(.a,.b) since div is redundant
      expect(result.valueOf()).toContain(':is');
    });

    it('should allow compound selector with duplicate IDs for specificity (#foo#foo.class)', () => {
      // #foo#foo.class is valid CSS used to increase specificity
      // Use partial: true because .class is only part of the compound selector
      const selector = compound([el('#foo'), el('#foo'), el('.class')]);
      const target = el('.class');
      const extendWith = el('.bar');

      expect(() => {
        extendSelector(selector, target, extendWith, true);
      }).not.toThrow();

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('#foo#foo:is(.class,.bar)');
    });
  });
});
