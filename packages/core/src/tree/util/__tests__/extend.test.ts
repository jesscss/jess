import { el, sel, sellist, compound, is, co } from '../../..';
import { extendSelector } from '../extend';

describe('Extend Selector Tests', () => {
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
    it('should throw when no match is found', () => {
      const selector = el('.a');
      const target = el('.b'); // No match
      const extendWith = el('.c');

      expect(() => {
        extendSelector(selector, target, extendWith, false);
      }).toThrow('No match found for target selector');
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
});
