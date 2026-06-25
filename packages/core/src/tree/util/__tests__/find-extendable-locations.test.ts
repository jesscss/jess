import { describe, it, expect } from 'vitest';
import { findExtendableLocations } from '../find-extendable-locations.js';
import { applyExtensionAtLocation } from '../extend.js';
import { el, pseudo, sellist, compound, Node } from '../../../index.js';

describe('ExtendLocation API Tests', () => {
  describe('findExtendableLocations', () => {
    it('should find target in pseudo-selector argument', () => {
      // Selector: :where(.a), Target: .a
      const selector = pseudo({
        name: ':where',
        arg: el('.a')
      });
      const target = el('.a');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(true);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]!.path).toEqual(['arg']);
      expect(result.locations[0]!.matchedNode.valueOf()).toBe('.a');
      expect(result.locations[0]!.extensionType).toBe('append');
    });

    it('should find target in selector list within pseudo-selector', () => {
      // Selector: :where(.a, .b), Target: .a
      const selector = pseudo({
        name: ':where',
        arg: sellist([el('.a'), el('.b')])
      });
      const target = el('.a');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(true);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]!.path).toEqual(['arg', 0]);
      expect(result.locations[0]!.matchedNode.valueOf()).toBe('.a');
      expect(result.locations[0]!.extensionType).toBe('append');
    });

    it('materializes string-backed selector list items before returning extend matches', () => {
      const selector = sellist(['.a', '.b']);
      const target = el('.a');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(true);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]!.path).toEqual([0]);
      expect(result.locations[0]!.matchedNode).not.toBe('.a');
      expect(result.locations[0]!.matchedNode.valueOf()).toBe('.a');
      expect(result.locations[0]!.extensionType).toBe('replace');
    });

    it('should find target in compound selector component', () => {
      // Selector: .foo:where(.a), Target: .a
      const selector = compound([
        el('.foo'),
        pseudo({ name: ':where', arg: el('.a') })
      ]);
      const target = el('.a');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(true);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]!.path).toEqual([1, 'arg']);
      expect(result.locations[0]!.matchedNode.valueOf()).toBe('.a');
      expect(result.locations[0]!.extensionType).toBe('append');
    });

    it('should find exact match at root level', () => {
      // Selector: .a, Target: .a
      const selector = el('.a');
      const target = el('.a');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(true);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]!.path).toEqual([]);
      expect(result.locations[0]!.matchedNode.valueOf()).toBe('.a');
      expect(result.locations[0]!.extensionType).toBe('replace');
    });

    it('should return no matches when target not found', () => {
      // Selector: :where(.a), Target: .b
      const selector = pseudo({
        name: ':where',
        arg: el('.a')
      });
      const target = el('.b');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(false);
      expect(result.locations).toHaveLength(0);
    });

    it('should find multiple matches in complex selectors', () => {
      // Selector: :where(.a, .b), Target: .a (if .a appeared multiple times)
      const selector = pseudo({
        name: ':where',
        arg: sellist([el('.a'), el('.a')]) // Duplicate for testing
      });
      const target = el('.a');

      const result = findExtendableLocations(selector, target);

      expect(result.hasMatches).toBe(true);
      expect(result.locations).toHaveLength(2);
      expect(result.locations[0]!.path).toEqual(['arg', 0]);
      expect(result.locations[1]!.path).toEqual(['arg', 1]);
    });
  });

  describe('applyExtensionAtLocation', () => {
    it('should apply extension in pseudo-selector argument', () => {
      // Selector: :where(.a), Target: .a, Extend with: .b
      // Expected: :where(.a, .b)
      const sourceArg = el('.a');
      const selector = pseudo({
        name: ':where',
        arg: sourceArg
      });
      const target = el('.a');
      const extendWith = el('.b');

      const result = findExtendableLocations(selector, target);
      expect(result.hasMatches).toBe(true);

      const extended = applyExtensionAtLocation(selector, result.locations[0]!, extendWith);
      expect(extended.valueOf()).toBe(':where(.a,.b)');
      expect(sourceArg.parent).toBe(selector);
      expect(extendWith.parent).toBeUndefined();
    });

    it('should apply extension in selector list within pseudo-selector', () => {
      // Selector: :where(.a, .b), Target: .a, Extend with: .c
      // Expected: :where(.a, .b, .c)
      const sourceList = sellist([el('.a'), el('.b')]);
      const sourceItems = [...sourceList.value];
      const selector = pseudo({
        name: ':where',
        arg: sourceList
      });
      const target = el('.a');
      const extendWith = el('.c');

      const result = findExtendableLocations(selector, target);
      expect(result.hasMatches).toBe(true);

      const extended = applyExtensionAtLocation(selector, result.locations[0]!, extendWith);
      // Just check that it contains the expected selectors, ignore formatting
      const extendedStr = extended.valueOf().replace(/\s+/g, '');
      expect(extendedStr).toBe(':where(.a,.b,.c)');
      expect(selector.arg).toBe(sourceList);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect(sourceItems.map(item => (item as Node).parent)).toEqual(sourceItems.map(() => sourceList));
      expect(extendWith.parent).toBeUndefined();
    });

    it('should apply extension in compound selector', () => {
      // Selector: .foo:where(.a), Target: .a, Extend with: .b
      // Expected: .foo:where(.a, .b)
      const selector = compound([
        el('.foo'),
        pseudo({ name: ':where', arg: el('.a') })
      ]);
      const target = el('.a');
      const extendWith = el('.b');

      const result = findExtendableLocations(selector, target);
      expect(result.hasMatches).toBe(true);

      const extended = applyExtensionAtLocation(selector, result.locations[0]!, extendWith);
      expect(extended.valueOf()).toBe('.foo:where(.a,.b)');
    });

    it('should replace at root level', () => {
      // Selector: .a, Target: .a, Extend with: .b
      // Expected: .b (replace mode)
      const selector = el('.a');
      const target = el('.a');
      const extendWith = el('.b');

      const result = findExtendableLocations(selector, target);
      expect(result.hasMatches).toBe(true);

      const extended = applyExtensionAtLocation(selector, result.locations[0]!, extendWith);
      expect(extended.valueOf()).toBe('.b');
    });
  });

  describe('ExtendLocation integration scenarios', () => {
    it('should handle :is() selectors correctly', () => {
      // Selector: :is(.a), Target: .a, Extend with: .b
      // Expected: :is(.a, .b)
      const selector = pseudo({
        name: ':is',
        arg: el('.a')
      });
      const target = el('.a');
      const extendWith = el('.b');

      const result = findExtendableLocations(selector, target);
      expect(result.hasMatches).toBe(true);

      const extended = applyExtensionAtLocation(selector, result.locations[0]!, extendWith);
      expect(extended.valueOf().replace(/\s+/g, '')).toBe(':is(.a,.b)');
    });

    it('should preserve pseudo-selector types (:where vs :is)', () => {
      // Test that :where stays :where and doesn't become :is
      const selector = pseudo({
        name: ':where',
        arg: el('.original')
      });
      const target = el('.original');
      const extendWith = el('.extended');

      const result = findExtendableLocations(selector, target);
      expect(result.hasMatches).toBe(true);

      const extended = applyExtensionAtLocation(selector, result.locations[0]!, extendWith);
      expect(extended.valueOf()).toContain(':where(');
      expect(extended.valueOf()).not.toContain(':is(');
      expect(extended.valueOf()).toBe(':where(.original,.extended)');
    });
  });
});
