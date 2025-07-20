import { el, sel, sellist, compound, is, co, comment, amp } from '../../index';
import { Ampersand } from '../../ampersand';
import { extendSelector } from '../extend';

// Helper to create ampersand with resolved selector
function ampWithSelector(selector: any): Ampersand {
  const ampersand = new Ampersand();
  ampersand.value.selector = selector;
  return ampersand;
}

describe('Extend Ampersand Handling Tests', () => {
  describe('Ampersand boundary detection', () => {
    it('should detect when extension crosses ampersand boundary', () => {
      // Setup: .foo { &.bar { ... } } with target .foo.bar
      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]);

      const target = compound([el('.foo'), el('.bar')]); // .foo.bar
      const extendWith = el('.extended');

      // This should cross the ampersand boundary since target matches the resolved ampersand + .bar
      const result = extendSelector(selector, target, extendWith, true);

      // Should be hoisted to root
      expect(result.options.hoistToRoot).toBe(true);

      console.log('Ampersand boundary crossing result:', result.toTrimmedString());
    });

    it('should preserve ampersand when extension does not cross boundary', () => {
      // Setup: .foo { &.bar { ... } } with target .bar (only matches part within ampersand context)
      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]);

      const target = el('.bar'); // Just .bar, not crossing boundary
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, true);

      // Should preserve ampersand structure, not hoist
      expect(result.options.hoistToRoot).toBeFalsy();

      console.log('Ampersand preservation result:', result.toTrimmedString());
    });
  });

  describe('Complex ampersand scenarios', () => {
    it('should handle ampersand with selector list', () => {
      // Setup: .foo, .bar { &.baz { ... } } with target .foo.baz
      const parentSelectors = sellist([el('.foo'), el('.bar')]);
      const ampersandWithSelectorList = ampWithSelector(parentSelectors);
      const selector = compound([ampersandWithSelectorList, el('.baz')]);

      const target = compound([el('.foo'), el('.baz')]); // .foo.baz
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, true);

      // Should handle the selector list properly and hoist
      expect(result.options.hoistToRoot).toBe(true);

      console.log('Ampersand with selector list result:', result.toTrimmedString());
    });

    it('should handle nested ampersands in complex selectors', () => {
      // Setup: .parent { > &.child { ... } }
      const parentSelector = el('.parent');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = sel([co('>'), compound([ampersandWithSelector, el('.child')])]);

      const target = compound([el('.parent'), el('.child')]); // .parent.child
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, true);

      // Should resolve and hoist
      expect(result.options.hoistToRoot).toBe(true);

      console.log('Nested ampersand result:', result.toTrimmedString());
    });
  });

  describe('Expected outputs - boundary crossing', () => {
    it('should extend .foo &.bar across boundary to create .foo.bar, .extended', () => {
      // Original: .foo { &.bar { color: red; } }
      // Target: .foo.bar
      // ExtendWith: .extended
      // Expected result: .foo.bar, .extended { color: red; } (hoisted to root)

      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]);

      const target = compound([el('.foo'), el('.bar')]);
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, true);

      // Should produce the resolved selector with extension
      // The exact output depends on implementation but should show both selectors
      console.log('Final boundary crossing output:', result.toTrimmedString());

      // Verify hoisting flag
      expect(result.options.hoistToRoot).toBe(true);

      // Should contain both the original resolved selector and the extension
      const output = result.toTrimmedString();
      expect(output).toBe('.foo.bar,\n.extended');
    });

    it('should extend complex ampersand selector across boundary', () => {
      // Original: .container { > &.item { ... } }
      // Target: .container.item (after > combinator resolves)
      // ExtendWith: .new-item

      const parentSelector = el('.container');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = sel([co('>'), compound([ampersandWithSelector, el('.item')])]);

      const target = compound([el('.container'), el('.item')]);
      const extendWith = el('.new-item');

      const result = extendSelector(selector, target, extendWith, true);
      const output = result.toTrimmedString();

      console.log('Complex ampersand boundary output:', output);

      expect(result.options.hoistToRoot).toBe(true);
      expect(output).toBe(' > &.item,\n > .new-item');
    });
  });

  describe('Expected outputs - boundary preservation', () => {
    it('should preserve ampersand when extending within boundary', () => {
      // Original: .foo { &.bar { ... } }
      // Target: .bar (only matches part, doesn't cross boundary)
      // ExtendWith: .extended
      // Expected: .foo { :is(&.bar, .extended) { ... } } (preserved structure)

      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]);

      const target = el('.bar');
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, true);
      const output = result.toTrimmedString();

      console.log('Boundary preservation output:', output);

      // Should not be hoisted
      expect(result.options.hoistToRoot).toBeFalsy();

      // Should preserve ampersand structure
      expect(output).toBe('&:is(.bar, .extended)');
    });

    it('should handle multiple ampersands without boundary crossing', () => {
      // Test that we can have multiple ampersands and only cross boundaries when appropriate
      const parentSelector = compound([el('.foo'), el('.bar')]);
      const amp1 = ampWithSelector(parentSelector);
      const amp2 = ampWithSelector(el('.baz'));

      const selector = compound([amp1, amp2, el('.suffix')]);
      const target = el('.suffix'); // Only matches suffix, no boundary crossing
      const extendWith = el('.extended');

      const result = extendSelector(selector, target, extendWith, true);
      const output = result.toTrimmedString();

      console.log('Multiple ampersands output:', output);

      // Should not hoist since no boundary was crossed
      expect(result.options.hoistToRoot).toBeFalsy();
      expect(output).toBe('&&:is(.suffix, .extended)');
    });
  });
});
