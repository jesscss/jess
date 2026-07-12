import { describe, it, expect } from 'vitest';
import { extendSelector } from '../extend';
import { el, pseudo, sellist, compound } from '../../..';

describe('Extend :where() Selector Tests', () => {
  describe('Extensions involving :where() selectors', () => {
    it('should extend within :where() arguments when finding inner selector', () => {
      // Selector: :where(.a), Target: .a (finding inner content), Extend with: .b
      // Result: :where(.a, .b) - extending within the :where() arguments
      const selector = pseudo({
        name: ':where',
        arg: el('.a')
      });
      const target = el('.a');
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':where(.a,.b)');
    });

    it('should extend within :where() arguments when list already exists', () => {
      // Selector: :where(.a, .b), Target: .a (finding inner content), Extend with: .c
      // Result: :where(.a, .b, .c) - extending within the existing :where() argument list
      const selector = pseudo({
        name: ':where',
        arg: sellist([el('.a'), el('.b')])
      });
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':where(.a,.b,.c)');
    });

    it('should create selector list when finding entire :where() selector', () => {
      // Selector: :where(.a), Target: :where(.a) (finding entire pseudo-selector), Extend with: .b
      // Result: :where(.a), .b - creating selector list because we matched the atomic :where() unit
      const selector = pseudo({
        name: ':where',
        arg: el('.a')
      });
      const target = pseudo({
        name: ':where',
        arg: el('.a')
      });
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':where(.a),.b');
    });
  });

  describe('Complex extension scenarios with :where()', () => {
    it('should extend within :where() when target matches inner content', () => {
      // Selector: .foo:where(.a), Target: .a (finding inner content), Extend with: .b
      // Result: .foo:where(.a, .b) - extend within the :where() arguments
      const selector = compound([
        el('.foo'),
        pseudo({ name: ':where', arg: el('.a') })
      ]);
      const target = el('.a');
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.foo:where(.a,.b)');
    });
  });

  describe(':where() vs :is() distinction', () => {
    it('should preserve :where() and not convert to :is()', () => {
      // This test specifically ensures we don't accidentally convert :where() to :is()
      const selector = pseudo({
        name: ':where',
        arg: el('.original')
      });
      const target = el('.original');
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, false);

      // Should be :where(.original, .extended), NOT :is(.original, .extended)
      expect(result.valueOf()).toContain(':where(');
      expect(result.valueOf()).not.toContain(':is(');
      expect(result.valueOf()).toBe(':where(.original,.extended)');
    });
  });
});
