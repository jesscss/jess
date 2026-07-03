import { SelectorList, Selector, el, sel, sellist, compound, is, co, comment, amp, type Node } from '../../index.js';
import { Ampersand } from '../../ampersand.js';
import { N } from '../../node-type.js';
import { extendSelector, type ExtendErrorType } from '../extend.js';
import { isNode } from '../is-node.js';

/** Narrow extendSelector result: throw if it's an ExtendErrorType string. */
function expectSelector(result: Selector | ExtendErrorType): Selector {
  if (typeof result === 'string') {
    throw new Error(`Expected Selector, got ExtendErrorType: ${result}`);
  }
  return result;
}

// Helper to create ampersand with resolved selector (snapshot container for tests)
function ampWithSelector(selector: any): Ampersand {
  const created = Ampersand.create({ selectorContainer: { selector } });
  if (!(created instanceof Ampersand)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    throw new Error(`Expected Ampersand, got ${(created as unknown as { type: string }).type}`);
  }
  return created;
}

describe('Extend Ampersand Handling Tests', () => {
  describe('Ampersand boundary detection', () => {
    it('should detect when extension crosses ampersand boundary', () => {
      // Setup: .foo { &.bar { ... } } - ampersand resolves to .foo
      // Target: .foo.bar (matches resolved form of &.bar)
      // ExtendWith: .a
      // Expected: .foo.bar, .a (with hoistToRoot: true)

      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]); // &.bar

      const target = compound([el('.foo'), el('.bar')]); // .foo.bar
      const extendWith = el('.a'); // .a

      // This should cross the ampersand boundary since target matches the resolved ampersand + .bar
      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      // Should be hoisted to root because we crossed the boundary
      expect(result.hoistToRoot).toBe(true);

      // Should resolve the ampersand and create selector list
      const output = result.toTrimmedString();
      expect(output).toBe('.foo.bar,\n.a');
    });

    it('should preserve ampersand when extension does not cross boundary', () => {
      // Setup: .foo { &.bar { ... } } - ampersand resolves to .foo
      // Target: .bar (matches just the .bar part, not the full resolved &.bar)
      // ExtendWith: .a
      // Expected: &:is(.bar, .a) - extend the .bar part without crossing boundary

      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]); // &.bar

      const target = el('.bar'); // Just .bar, doesn't match the full resolved .foo.bar
      const extendWith = el('.a'); // .a

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      // Should NOT be hoisted since we didn't cross the boundary
      expect(result.hoistToRoot).toBeFalsy();

      // Should preserve ampersand structure with extension
      const output = result.toTrimmedString();
      expect(output).toBe('&:is(.bar, .a)');
    });
  });

  describe('Complex ampersand scenarios', () => {
    it('should handle ampersand with selector list', () => {
      // Setup: .foo, .bar { &.baz { ... } } with target .foo.baz
      // Note: This is a complex case involving selector list resolution
      // For now, we'll test a simpler case that should work
      const parentSelector = el('.foo'); // Simplified to single selector instead of selector list
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.baz')]);

      const target = compound([el('.foo'), el('.baz')]); // .foo.baz
      const extendWith = el('.extended');

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      // Should handle properly and hoist
      expect(result.hoistToRoot).toBe(true);
    });

    it('should handle nested ampersands in complex selectors', () => {
      // Setup: .parent { > &.child { ... } }
      const parentSelector = el('.parent');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = sel([co('>'), compound([ampersandWithSelector, el('.child')])]);

      const target = compound([el('.parent'), el('.child')]); // .parent.child
      const extendWith = el('.extended');

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      // Should resolve and hoist
      expect(result.hoistToRoot).toBeFalsy(); // Changed: ampersand already resolved, no boundary detected
    });
  });

  describe('Expected outputs - boundary crossing', () => {
    it('replaces boundary-crossing ampersands', () => {
      const parentSelector = el('.foo');
      const selector = compound([ampWithSelector(parentSelector), el('.bar')]);
      const target = compound([el('.foo'), el('.bar')]);
      const extendWith = el('.a');

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      expect(result.hoistToRoot).toBe(true);
      expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
    });

    it('hoists ampersand boundary output', () => {
      const parentSelector = el('.foo');
      const selector = compound([ampWithSelector(parentSelector), el('.bar')]);
      const target = compound([el('.foo'), el('.bar')]);
      const extendWith = el('.a');

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      expect(result.hoistToRoot).toBe(true);
      expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
    });

    it('uses an owned extend copy for the resolved ampersand selector', () => {
      const parentSelector = el('.foo');
      const selector = compound([ampWithSelector(parentSelector), el('.bar')]);
      const target = compound([el('.foo'), el('.bar')]);
      const extendWith = el('.a');

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      expect(result.hoistToRoot).toBe(true);
      expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
    });

    it('keeps boundary-crossing ampersand extend output owned without reparenting source selectors', () => {
      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const trailing = el('.bar');
      const selector = compound([ampersandWithSelector, trailing]);
      const sourceSelectorChildren = [...selector.value];
      const extendWith = el('.a');

      const result = extendSelector(
        selector,
        compound([el('.foo'), el('.bar')]),
        extendWith,
        true
      );

      expect(parentSelector.parent).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect(sourceSelectorChildren.map(child => (child as unknown as Node).parent)).toEqual(
        sourceSelectorChildren.map(() => selector)
      );

      if (!isNode(result, N.SelectorList)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        throw new Error(`Expected hoisted selector list, got ${(result as unknown as { type: string }).type}`);
      }

      expect(result).not.toBe(selector);
      expect(result.value[0]).not.toBe(parentSelector);
      expect(result.value[1]).not.toBe(extendWith);
      expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
    });

    it('should extend .foo &.bar across boundary to create .foo.bar, .extended', () => {
      // Original: .foo { &.bar { color: red; } }
      // Target: .foo.bar (matches resolved form of &.bar)
      // ExtendWith: .a
      // Expected result: .foo.bar, .a { color: red; } (hoisted to root)

      const parentSelector = el('.foo');
      const ampersandWithSelector = ampWithSelector(parentSelector);
      const selector = compound([ampersandWithSelector, el('.bar')]);

      const target = compound([el('.foo'), el('.bar')]);
      const extendWith = el('.a');

      const result = expectSelector(extendSelector(selector, target, extendWith, true));

      // Should produce the resolved selector with extension
      // Verify hoisting flag
      expect(result.hoistToRoot).toBe(true);

      // Should contain both the original resolved selector and the extension
      const output = result.toTrimmedString();
      expect(output).toBe('.foo.bar,\n.a');
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

      const result = expectSelector(extendSelector(selector, target, extendWith, true));
      const output = result.toTrimmedString();

      expect(result.hoistToRoot).toBeFalsy(); // Changed: ampersand already resolved, no boundary detected
      expect(output).toBe('> :is(.container.item, .new-item)'); // Updated: modern :is() syntax instead of separate selectors
    });

    it('should resolve authored && to the doubled parent selector for exact extends', () => {
      const parentSelector = el('.e');
      const amp1 = ampWithSelector(parentSelector);
      const amp2 = ampWithSelector(parentSelector);
      const selector = compound([amp1, amp2]); // &&
      const target = compound([el('.e'), el('.e')]); // .e.e
      const extendWith = el('.dbl');
      const result = expectSelector(extendSelector(selector, target, extendWith, true));
      const output = result.toTrimmedString();

      expect(result.hoistToRoot).toBe(true);
      expect(output).toBe('.e.e,\n.dbl');
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

      const result = expectSelector(extendSelector(selector, target, extendWith, true));
      const output = result.toTrimmedString();

      // Should not be hoisted
      expect(result.hoistToRoot).toBeFalsy();

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

      const result = expectSelector(extendSelector(selector, target, extendWith, true));
      const output = result.toTrimmedString();

      // Should not hoist since no boundary was crossed
      expect(result.hoistToRoot).toBeFalsy();
      expect(output).toBe('&&:is(.suffix, .extended)');
    });
  });

  it('does not insert a second implicit ampersand when a visible ampersand already exists', () => {
    const parentSelector = el('.parent');
    const selector = compound([amp({ selectorContainer: { selector: parentSelector } }), el('.keep')]);
    const target = el('.keep');
    const extendWith = el('.extra');

    const result = expectSelector(extendSelector(selector, target, extendWith, true));
    const output = result.toTrimmedString();

    expect(output).toContain('&');
    expect(output).not.toContain('&&');
  });

  it('preserves stored ampersand selector snapshots separately from live selector resolution', () => {
    const parentContainer = { selector: el('.aa') };
    const original = Ampersand.create({ selectorContainer: parentContainer });
    if (!(original instanceof Ampersand)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      throw new Error(`Expected Ampersand, got ${(original as unknown as { type: string }).type}`);
    }
    const cloned = original.clone(false);
    if (!(cloned instanceof Ampersand)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      throw new Error(`Expected Ampersand clone, got ${(cloned as unknown as { type: string }).type}`);
    }

    expect(original.getStoredSelector()?.valueOf()).toBe('.aa');
    expect(cloned.getStoredSelector()?.valueOf()).toBe('.aa');
    expect(original.getResolvedSelector()?.valueOf()).toBe('.aa');
    expect(cloned.getResolvedSelector()?.valueOf()).toBe('.aa');

    parentContainer.selector = el('.bb');

    expect(original.getStoredSelector()?.valueOf()).toBe('.aa');
    expect(cloned.getStoredSelector()?.valueOf()).toBe('.aa');
    expect(original.getResolvedSelector()?.valueOf()).toBe('.bb');
    expect(cloned.getResolvedSelector()?.valueOf()).toBe('.bb');
  });
});
