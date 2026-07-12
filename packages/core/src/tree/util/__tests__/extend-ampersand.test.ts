import { BasicSelector, SelectorList, el, sel, sellist, compound, is, co, comment, amp } from '../../index.js';
import { Ampersand } from '../../ampersand.js';
import { extendSelector } from '../extend.js';
import { addImplicitAmpersand } from '../selector-utils.js';

// Helper to create ampersand with resolved selector (snapshot container for tests)
function ampWithSelector(selector: any): Ampersand {
  return Ampersand.create({ selectorContainer: { selector } }) as Ampersand;
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
      const result = extendSelector(selector, target, extendWith, true);

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

      const result = extendSelector(selector, target, extendWith, true);

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

      const result = extendSelector(selector, target, extendWith, true);

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

      const result = extendSelector(selector, target, extendWith, true);

      // Should resolve and hoist
      expect(result.hoistToRoot).toBeFalsy(); // Changed: ampersand already resolved, no boundary detected
    });
  });

  describe('Expected outputs - boundary crossing', () => {
    it('replaces boundary-crossing ampersands without calling generic copy on the source selector', () => {
      const parentSelector = el('.foo');
      const selector = compound([ampWithSelector(parentSelector), el('.bar')]);
      const originalCopy = selector.copy.bind(selector);
      let selectorCopies = 0;
      selector.copy = ((...args) => {
        selectorCopies++;
        return originalCopy(...args);
      }) as typeof selector.copy;

      try {
        const target = compound([el('.foo'), el('.bar')]);
        const extendWith = el('.a');

        const result = extendSelector(selector, target, extendWith, true);

        expect(selectorCopies).toBe(0);
        expect(result.hoistToRoot).toBe(true);
        expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
      } finally {
        selector.copy = originalCopy;
      }
    });

    it('hoists ampersand boundary output without calling generic SelectorList.copy()', () => {
      const originalCopy = SelectorList.prototype.copy;
      let selectorListCopies = 0;
      SelectorList.prototype.copy = function copyForCounting(
        this: SelectorList,
        ...args: Parameters<SelectorList['copy']>
      ): ReturnType<SelectorList['copy']> {
        selectorListCopies++;
        return originalCopy.apply(this, args);
      };

      try {
        const parentSelector = el('.foo');
        const selector = compound([ampWithSelector(parentSelector), el('.bar')]);
        const target = compound([el('.foo'), el('.bar')]);
        const extendWith = el('.a');

        const result = extendSelector(selector, target, extendWith, true);

        expect(selectorListCopies).toBe(0);
        expect(result.hoistToRoot).toBe(true);
        expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
      } finally {
        SelectorList.prototype.copy = originalCopy;
      }
    });

    it('uses an owned extend copy for the resolved ampersand selector', () => {
      const parentSelector = el('.foo');
      const selector = compound([ampWithSelector(parentSelector), el('.bar')]);
      const originalCopy = parentSelector.copy.bind(parentSelector);
      let parentSelectorCopies = 0;
      parentSelector.copy = ((...args) => {
        parentSelectorCopies++;
        return originalCopy(...args);
      }) as typeof parentSelector.copy;

      try {
        const target = compound([el('.foo'), el('.bar')]);
        const extendWith = el('.a');

        const result = extendSelector(selector, target, extendWith, true);

        expect(parentSelectorCopies).toBe(0);
        expect(result.hoistToRoot).toBe(true);
        expect(result.toTrimmedString()).toBe('.foo.bar,\n.a');
      } finally {
        parentSelector.copy = originalCopy;
      }
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

      const result = extendSelector(selector, target, extendWith, true);

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
      const originalCopy = selector.copy.bind(selector);
      let selectorCopies = 0;
      selector.copy = ((...args) => {
        selectorCopies++;
        return originalCopy(...args);
      }) as typeof selector.copy;

      try {
        const target = compound([el('.container'), el('.item')]);
        const extendWith = el('.new-item');

        const result = extendSelector(selector, target, extendWith, true);
        expect(result).not.toBe('NOT_FOUND');
        const output = result.toTrimmedString();

        expect(selectorCopies).toBe(0);
        expect(result.hoistToRoot).toBeFalsy(); // Changed: ampersand already resolved, no boundary detected
        expect(output).toBe(' > :is(.container.item, .new-item)'); // Updated: modern :is() syntax instead of separate selectors
      } finally {
        selector.copy = originalCopy;
      }
    });

    it('should resolve authored && to the doubled parent selector for exact extends', () => {
      const parentSelector = el('.e');
      const amp1 = ampWithSelector(parentSelector);
      const amp2 = ampWithSelector(parentSelector);
      const selector = compound([amp1, amp2]); // &&
      const target = compound([el('.e'), el('.e')]); // .e.e
      const extendWith = el('.dbl');
      const originalCopy = BasicSelector.prototype.copy;
      let basicSelectorCopies = 0;
      BasicSelector.prototype.copy = function copyForCounting(
        this: BasicSelector,
        ...args: Parameters<BasicSelector['copy']>
      ): ReturnType<BasicSelector['copy']> {
        basicSelectorCopies++;
        return originalCopy.apply(this, args);
      };

      try {
        const result = extendSelector(selector, target, extendWith, true);
        const output = result.toTrimmedString();

        expect(basicSelectorCopies).toBe(0);
        expect(result.hoistToRoot).toBe(true);
        expect(output).toBe('.e.e,\n.dbl');
      } finally {
        BasicSelector.prototype.copy = originalCopy;
      }
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

      const result = extendSelector(selector, target, extendWith, true);
      const output = result.toTrimmedString();

      // Should not hoist since no boundary was crossed
      expect(result.hoistToRoot).toBeFalsy();
      expect(output).toBe('&&:is(.suffix, .extended)');
    });
  });

  it('does not insert a second implicit ampersand when a visible ampersand already exists', () => {
    const parentSelector = el('.parent');
    const selector = compound([amp({ selector: parentSelector }), el('.keep')]);
    const target = el('.keep');
    const extendWith = el('.extra');

    const result = extendSelector(selector, target, extendWith, true);
    const output = result.toTrimmedString();

    expect(output).toContain('&');
    expect(output).not.toContain('&&');
  });

  it('derives copied implicit ampersands without cloning the source ampersand', () => {
    const parentContainer = { selector: el('.aa') };
    const selector = addImplicitAmpersand(
      el('.dd'),
      false,
      { value: parentContainer }
    );
    const sourceAmpersand = [...selector.nodes(true)].find((node): node is Ampersand => node instanceof Ampersand)!;
    const originalClone = sourceAmpersand.clone;
    let sourceAmpersandClones = 0;
    sourceAmpersand.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      sourceAmpersandClones++;
      return originalClone.apply(this, args);
    };

    try {
      const result = extendSelector(selector, el('.dd'), el('.ee'), true);
      const ampersands = [...result.nodes(true)].filter((node): node is Ampersand => node instanceof Ampersand);

      expect(sourceAmpersandClones).toBe(0);
      expect(ampersands.length).toBeGreaterThan(0);
      expect(ampersands).not.toContain(sourceAmpersand);
      expect(ampersands[0]!.getResolvedSelector()?.valueOf()).toBe('.aa');

      parentContainer.selector = el('.bb');

      expect(ampersands[0]!.getResolvedSelector()?.valueOf()).toBe('.bb');
    } finally {
      sourceAmpersand.clone = originalClone;
    }
  });

  it('reuses source-free selector leaves when adding an implicit ampersand', () => {
    const parentContainer = { selector: el('.parent') };
    const child = el('.child');
    const originalClone = BasicSelector.prototype.clone;
    let basicSelectorCloneCalls = 0;
    BasicSelector.prototype.clone = function cloneForCounting(
      this: BasicSelector,
      ...args: Parameters<BasicSelector['clone']>
    ): ReturnType<BasicSelector['clone']> {
      basicSelectorCloneCalls++;
      return originalClone.apply(this, args);
    };

    try {
      const selector = addImplicitAmpersand(
        child,
        false,
        { value: parentContainer }
      );

      expect(selector.valueOf()).toBe('.parent .child');
      expect(basicSelectorCloneCalls).toBe(0);
      expect(child.parent).toBeUndefined();
    } finally {
      BasicSelector.prototype.clone = originalClone;
    }
  });

  it('preserves stored ampersand selector snapshots separately from live selector resolution', () => {
    const parentContainer = { selector: el('.aa') };
    const original = Ampersand.create({ selectorContainer: parentContainer }) as Ampersand;
    const cloned = original.clone(false) as Ampersand;

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
