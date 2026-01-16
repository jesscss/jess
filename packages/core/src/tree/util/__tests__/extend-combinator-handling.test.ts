import { extendSelector, tryExtendSelector } from '../extend';
import { el, sel, compound, co, sellist } from '../../..';
import { isNode } from '../is-node';
import { type Combinator, type Combinators } from '../../combinator';
import { Context } from '../../../context';
import { Rules } from '../../rules';
import { Ruleset } from '../../ruleset';
import { Extend } from '../../extend';
import { processExtends } from '../extend-roots';

/**
 * Test suite to verify that all combinators (>, +, ~, space) are properly preserved
 * during selector extension operations, not hardcoded to '>'
 */
describe('Combinator Preservation in Extensions', () => {
  function createComplexSelector(firstClass: string, combinator: Combinators, secondClass: string) {
    return sel([
      compound([el('.parent'), el(firstClass)]),
      co(combinator as Combinators),
      el(secondClass)
    ]);
  }

  function testCombinatorPreservation(combinator: Combinators, testName: string) {
    it(`should preserve ${combinator} combinator in complex partial extend`, () => {
      const complexSelector = createComplexSelector('.foo', combinator, '.child');
      const target = el('.foo');
      const extendWith = el('.bar');

      const result = extendSelector(complexSelector, target, extendWith, true);

      // Verify the result contains the original combinator
      expect(isNode(result, 'ComplexSelector')).toBe(true);
      if (isNode(result, 'ComplexSelector')) {
        const components = result.value;
        const foundCombinator = components.find(c => isNode(c, 'Combinator'));
        expect(foundCombinator).toBeDefined();
        expect(foundCombinator?.value).toBe(combinator);
      }
    });
  }

  describe('Direct Child Combinator (>)', () => {
    testCombinatorPreservation('>', 'child');
  });

  describe('Adjacent Sibling Combinator (+)', () => {
    testCombinatorPreservation('+', 'adjacent sibling');
  });

  describe('General Sibling Combinator (~)', () => {
    testCombinatorPreservation('~', 'general sibling');
  });

  describe('Descendant Combinator (space)', () => {
    testCombinatorPreservation(' ', 'descendant');
  });

  describe('Multiple Combinator Preservation', () => {
    it('should preserve multiple different combinators in sequence', () => {
      // .a.foo > .b + .c extends (.foo) with .bar
      // Should preserve both '>' and '+' combinators
      const complexSelector = sel([
        compound([el('.a'), el('.foo')]),
        co('>'),
        el('.b'),
        co('+'),
        el('.c')
      ]);

      const target = el('.foo');
      const extendWith = el('.bar');

      const result = extendSelector(complexSelector, target, extendWith, true);

      // Verify both combinators are preserved
      expect(isNode(result, 'ComplexSelector')).toBe(true);
      if (isNode(result, 'ComplexSelector')) {
        const components = result.value;
        const combinators = components.filter(c => isNode(c, 'Combinator')) as Combinator[];
        expect(combinators).toHaveLength(2);
        expect(combinators[0]?.value).toBe('>');
        expect(combinators[1]?.value).toBe('+');
      }
    });
  });

  describe('Selector Matching with Different Combinators', () => {
    it('should match identical complex selectors with > combinator', () => {
      // .parent > .child should match .parent > .child exactly
      const selector1 = sel([el('.parent'), co('>'), el('.child')]);
      const selector2 = sel([el('.parent'), co('>'), el('.child')]);

      const result = extendSelector(selector1, selector2, el('.extended'), false);

      // Should create a selector list with both original and extended
      expect(isNode(result, 'SelectorList')).toBe(true);
    });

    it('should NOT match complex selectors with different combinators', () => {
      // .parent > .child should NOT match .parent + .child
      const selector1 = sel([el('.parent'), co('>'), el('.child')]);
      const selector2 = sel([el('.parent'), co('+'), el('.child')]);

      expect(() => {
        extendSelector(selector1, selector2, el('.extended'), false);
      }).toThrow('No match found for target selector');
    });

    it('should NOT match with tryExtendSelector when combinators differ (space vs +)', () => {
      // .ext8 .ext9 (descendant) should NOT match .ext8 + .ext9 (adjacent sibling)
      const target = sel([el('.ext8'), co(' '), el('.ext9')]);
      const find = sel([el('.ext8'), co('+'), el('.ext9')]);
      const extendWith = el('.zap');

      const result = tryExtendSelector(target, find, extendWith, true);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('NOT_FOUND');
      expect(result.value.valueOf()).toBe(target.valueOf());
    });

    it('should NOT match with tryExtendSelector when combinators differ (space vs >)', () => {
      // .ext8 .ext9 (descendant) should NOT match .ext8 > .ext9 (child)
      const target = sel([el('.ext8'), co(' '), el('.ext9')]);
      const find = sel([el('.ext8'), co('>'), el('.ext9')]);
      const extendWith = el('.zoo');

      const result = tryExtendSelector(target, find, extendWith, true);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('NOT_FOUND');
      expect(result.value.valueOf()).toBe(target.valueOf());
    });

    it('should NOT match .ext8 .ext9 with .ext8 + .ext9 (reproducing the actual bug)', () => {
      // This is the exact case from extend.less that's failing
      // .ext8 .ext9 (descendant) should NOT match .ext8 + .ext9 (adjacent sibling)
      const target = sel([el('.ext8'), co(' '), el('.ext9')]);
      const find = sel([el('.ext8'), co('+'), el('.ext9')]);
      const extendWith = el('.zap');

      const result = tryExtendSelector(target, find, extendWith, true);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('NOT_FOUND');
      expect(result.value.valueOf()).toBe(target.valueOf());
    });
  });

  describe('Bug reproduction: extend.less combinator mismatch - EXACT REPLICATION', () => {
    it('should NOT match SelectorList containing .ext8 .ext9 when extending with .ext8 + .ext9', () => {
      // EXACT replication of what the logs show:
      // originalSelector: ".ext8 .ext9,.buu" (SelectorList)
      // find: ".ext8+.ext9" (ComplexSelector with + combinator)
      // extendWith: ".zap" (BasicSelector)
      // partial: true
      //
      // The SelectorList contains:
      //   - ComplexSelector(.ext8 ' ' .ext9) - descendant combinator
      //   - BasicSelector(.buu)
      //
      // We're trying to match against:
      //   - ComplexSelector(.ext8 '+' .ext9) - adjacent sibling combinator
      //
      // This should NOT match because the combinators differ (' ' vs '+')

      const selectorList = sellist([
        sel([el('.ext8'), co(' '), el('.ext9')]),  // .ext8 .ext9 (descendant)
        el('.buu')                                   // .buu
      ]);

      const find = sel([el('.ext8'), co('+'), el('.ext9')]);  // .ext8 + .ext9 (adjacent sibling)
      const extendWith = el('.zap');

      const result = tryExtendSelector(selectorList, find, extendWith, true);

      // Should NOT match - combinators differ
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('NOT_FOUND');
      // Selector should be unchanged
      expect(result.value.valueOf()).toBe('.ext8 .ext9,.buu');
    });

    it('should NOT match SelectorList containing .ext8 .ext9 when extending with .ext8 > .ext9', () => {
      // Similar test for child combinator

      const selectorList = sellist([
        sel([el('.ext8'), co(' '), el('.ext9')]),  // .ext8 .ext9 (descendant)
        el('.buu')                                   // .buu
      ]);

      const find = sel([el('.ext8'), co('>'), el('.ext9')]);  // .ext8 > .ext9 (child)
      const extendWith = el('.zoo');

      const result = tryExtendSelector(selectorList, find, extendWith, true);

      // Should NOT match - combinators differ
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('NOT_FOUND');
      // Selector should be unchanged
      expect(result.value.valueOf()).toBe('.ext8 .ext9,.buu');
    });

    it('should NOT add .zap to nested .ext8 .ext9 when .zap extends .ext8 + .ext9', () => {
      // Reproducing the exact bug from extend.less:
      //
      // Less code:
      //   .ext8 {
      //     .ext9 {
      //       result: match-nested-bar;
      //     }
      //   }
      //   .zap:extend(.ext8 + .ext9 all) {}
      //
      // The nested ruleset should only have selector: .ext8 .ext9 (descendant combinator)
      // When .zap:extend(.ext8 + .ext9 all) is processed, it should NOT match because
      // .ext8 + .ext9 (adjacent sibling) doesn't match .ext8 .ext9 (descendant)

      const context = new Context();
      const rootRules = new Rules();
      context.root = rootRules;
      context.extendRoots.root = rootRules;
      context.extendRoots.registerRoot(rootRules);

      // Create .ext8 ruleset (parent) - this will contain the nested .ext9
      const ext8Ruleset = new Ruleset();
      ext8Ruleset.value = {
        selector: el('.ext8'),
        rules: new Rules()
      };
      rootRules.register('ruleset', ext8Ruleset);
      rootRules.value.push(ext8Ruleset);

      // Create nested .ext8 .ext9 ruleset (descendant combinator only)
      // This represents the nested .ext9 inside .ext8
      // IMPORTANT: This should be a ComplexSelector with descendant combinator, NOT a SelectorList
      const ext8Ext9Ruleset = new Ruleset();
      const nestedSelector = sel([el('.ext8'), co(' '), el('.ext9')]);  // Only descendant, NOT a SelectorList
      ext8Ext9Ruleset.value = {
        selector: nestedSelector,
        rules: new Rules()
      };
      // Register it in the parent .ext8 ruleset's registry
      ext8Ruleset.value.rules.register('ruleset', ext8Ext9Ruleset);
      ext8Ruleset.value.rules.value.push(ext8Ext9Ruleset);

      // Also register it in root for extend lookup (Less parser does this)
      rootRules.register('ruleset', ext8Ext9Ruleset);

      // Verify the selector before processing
      const selectorBefore = ext8Ext9Ruleset.value.selector.valueOf();
      expect(selectorBefore).toBe('.ext8 .ext9');  // Should be descendant only

      // Create .zap:extend(.ext8 + .ext9 all) {}
      const zapRuleset = new Ruleset();
      zapRuleset.value = { selector: el('.zap'), rules: new Rules() };
      rootRules.register('ruleset', zapRuleset);
      rootRules.value.push(zapRuleset);

      const extendNode = new Extend();
      extendNode.value = {
        target: sel([el('.ext8'), co('+'), el('.ext9')]), // Adjacent sibling
        selector: el('.zap'),
        flag: 0 // All (partial: true)
      };

      context.extends.push([
        sel([el('.ext8'), co('+'), el('.ext9')]), // target: .ext8 + .ext9
        el('.zap'),                                 // selectorWithExtend: .zap
        true,                                        // partial: true (all flag)
        rootRules,                                   // extendRoot
        extendNode                                   // extendNode
      ]);

      // Verify selector is still correct before processExtends
      const selectorBeforeProcess = ext8Ext9Ruleset.value.selector.valueOf();
      expect(selectorBeforeProcess).toBe('.ext8 .ext9');

      processExtends(context);

      // After processing, .ext8 .ext9 should NOT have .zap added
      // because .ext8 + .ext9 (adjacent sibling) doesn't match .ext8 .ext9 (descendant)
      expect(ext8Ext9Ruleset.value.selector.valueOf()).toBe('.ext8 .ext9');
      expect(ext8Ext9Ruleset.value.selector.valueOf()).not.toContain('.zap');
    });

    it('should NOT add .zoo to .ext8 .ext9 when .zoo extends .ext8 > .ext9', () => {
      // Similar test for child combinator

      const context = new Context();
      const rootRules = new Rules();
      context.root = rootRules;
      context.extendRoots.root = rootRules;
      context.extendRoots.registerRoot(rootRules);

      // Create .ext8 .ext9 ruleset (descendant combinator)
      const ext8Ext9Ruleset = new Ruleset();
      ext8Ext9Ruleset.value = { selector: sel([el('.ext8'), co(' '), el('.ext9')]), rules: new Rules() };
      rootRules.register('ruleset', ext8Ext9Ruleset);
      rootRules.value.push(ext8Ext9Ruleset);

      // Create .zoo:extend(.ext8 > .ext9 all) {}
      const zooRuleset = new Ruleset();
      zooRuleset.value = { selector: el('.zoo'), rules: new Rules() };
      rootRules.register('ruleset', zooRuleset);
      rootRules.value.push(zooRuleset);

      const extendNode = new Extend();
      extendNode.value = {
        target: sel([el('.ext8'), co('>'), el('.ext9')]), // Child combinator
        selector: el('.zoo'),
        flag: 0 // All (partial: true)
      };

      context.extends.push([
        sel([el('.ext8'), co('>'), el('.ext9')]), // target: .ext8 > .ext9
        el('.zoo'),                                 // selectorWithExtend: .zoo
        true,                                        // partial: true (all flag)
        rootRules,                                   // extendRoot
        extendNode                                   // extendNode
      ]);

      processExtends(context);

      // After processing, .ext8 .ext9 should NOT have .zoo added because combinators don't match
      const ext8Ext9Selector = ext8Ext9Ruleset.value.selector.valueOf();
      expect(ext8Ext9Selector).toBe('.ext8 .ext9');
      expect(ext8Ext9Selector).not.toContain('.zoo');
    });

    it('should NOT add .zap to nested .ext8 .ext9 when .buu extends first, then .zap extends', () => {
      // Replicating EXACT order from extend.less:
      // 1. Create ruleset: .ext8 .ext9,.ext8 + .ext9,.ext8 > .ext9
      // 2. Create nested: .ext8 { .ext9 { ... } } → .ext8 .ext9
      // 3. Process: .buu:extend(.ext8 .ext9 all) → adds .buu to BOTH
      // 4. Process: .zap:extend(.ext8 + .ext9 all) → should ONLY add to first, NOT nested

      const context = new Context();
      const rootRules = new Rules();
      context.root = rootRules;
      context.extendRoots.root = rootRules;
      context.extendRoots.registerRoot(rootRules);

      // STEP 1: Create ruleset with .ext8 .ext9,.ext8 + .ext9,.ext8 > .ext9
      const ruleset1 = new Ruleset();
      const selectorList1 = sellist([
        sel([el('.ext8'), co(' '), el('.ext9')]),   // .ext8 .ext9
        sel([el('.ext8'), co('+'), el('.ext9')]),  // .ext8+.ext9
        sel([el('.ext8'), co('>'), el('.ext9')])  // .ext8>.ext9
      ]);
      ruleset1.value = { selector: selectorList1, rules: new Rules() };
      rootRules.register('ruleset', ruleset1);
      rootRules.value.push(ruleset1);

      // STEP 2: Create nested .ext8 { .ext9 { ... } } → .ext8 .ext9
      const ext8Ruleset = new Ruleset();
      ext8Ruleset.value = { selector: el('.ext8'), rules: new Rules() };
      rootRules.register('ruleset', ext8Ruleset);
      rootRules.value.push(ext8Ruleset);

      const nestedRuleset = new Ruleset();
      const nestedSelector = sel([el('.ext8'), co(' '), el('.ext9')]);
      nestedRuleset.value = { selector: nestedSelector, rules: new Rules() };
      ext8Ruleset.value.rules.register('ruleset', nestedRuleset);
      ext8Ruleset.value.rules.value.push(nestedRuleset);
      rootRules.register('ruleset', nestedRuleset); // Also in root for lookup

      expect(ruleset1.value.selector.valueOf()).toBe('.ext8 .ext9,.ext8+.ext9,.ext8>.ext9');
      expect(nestedRuleset.value.selector.valueOf()).toBe('.ext8 .ext9');

      // STEP 3: Process .buu:extend(.ext8 .ext9 all) {}
      const buuExtendNode = new Extend();
      buuExtendNode.value = {
        target: sel([el('.ext8'), co(' '), el('.ext9')]),
        selector: el('.buu'),
        flag: 0
      };
      context.extends.push([
        sel([el('.ext8'), co(' '), el('.ext9')]),
        el('.buu'),
        true,
        rootRules,
        buuExtendNode
      ]);

      // STEP 4: Process .zap:extend(.ext8 + .ext9 all) {}
      const zapExtendNode = new Extend();
      zapExtendNode.value = {
        target: sel([el('.ext8'), co('+'), el('.ext9')]),
        selector: el('.zap'),
        flag: 0
      };
      context.extends.push([
        sel([el('.ext8'), co('+'), el('.ext9')]),
        el('.zap'),
        true,
        rootRules,
        zapExtendNode
      ]);

      // Process ALL extends together (as they would be in extend.less)
      processExtends(context);

      // ruleset1 should have .zap (contains .ext8+.ext9)
      expect(ruleset1.value.selector.valueOf()).toContain('.zap');

      // nestedRuleset should NOT have .zap (only has .ext8 .ext9, doesn't match .ext8+.ext9)
      expect(nestedRuleset.value.selector.valueOf()).not.toContain('.zap');
      expect(nestedRuleset.value.selector.valueOf()).toBe('.ext8 .ext9,.buu');
    });
  });
});
