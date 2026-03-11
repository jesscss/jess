import { extendSelector, tryExtendSelector } from '../extend.js';
import { el, sel, compound, co, sellist, rules, ruleset, extend, ExtendFlag } from '../../../index.js';
import { isNode } from '../is-node.js';
import { N } from '../../node-type.js';
import { type Combinator, type Combinators } from '../../combinator.js';
import { Context } from '../../../context.js';

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
      expect(isNode(result, N.ComplexSelector)).toBe(true);
      if (isNode(result, N.ComplexSelector)) {
        const components = result.data;
        const foundCombinator = components.find(c => isNode(c, N.Combinator));
        expect(foundCombinator).toBeDefined();
        expect(foundCombinator?.data).toBe(combinator);
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
      expect(isNode(result, N.ComplexSelector)).toBe(true);
      if (isNode(result, N.ComplexSelector)) {
        const components = result.data;
        const combinators = components.filter(c => isNode(c, N.Combinator)) as Combinator[];
        expect(combinators).toHaveLength(2);
        expect(combinators[0]?.data).toBe('>');
        expect(combinators[1]?.data).toBe('+');
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
      expect(isNode(result, N.SelectorList)).toBe(true);
    });

    it('should NOT match complex selectors with different combinators', () => {
      // .parent > .child should NOT match .parent + .child
      const selector1 = sel([el('.parent'), co('>'), el('.child')]);
      const selector2 = sel([el('.parent'), co('+'), el('.child')]);

      const result = extendSelector(selector1, selector2, el('.extended'), false);
      expect(result).toBe('NOT_FOUND');
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

    it('should NOT add .zap to nested .ext8 .ext9 when .zap extends .ext8 + .ext9', async () => {
      // Parser-built: .ext8 { .ext9 { } } and .zap:extend(.ext8 + .ext9 all) {}
      // Nested has selector .ext8 .ext9 (descendant). .zap extends .ext8 + .ext9 (adjacent) should NOT match nested.
      const nestedExt9 = ruleset({
        selector: sel([el('.ext8'), co(' '), el('.ext9')]),
        rules: rules([])
      });
      const root = rules([
        ruleset({
          selector: el('.ext8'),
          rules: rules([nestedExt9])
        }),
        ruleset({
          selector: el('.zap'),
          rules: rules([
            extend({
              target: sel([el('.ext8'), co('+'), el('.ext9')]),
              flag: ExtendFlag.All
            })
          ])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const ext8Ruleset = evald.data[0];
      const nestedRuleset = ext8Ruleset?.data?.rules?.data?.[0];
      const nestedSel = nestedRuleset?.data?.selector?.valueOf() ?? '';
      // Nested has descendant .ext8 .ext9 only; must NOT get .zap (which extends .ext8 + .ext9)
      expect(nestedSel).not.toContain('.zap');
      expect(nestedSel).toContain('.ext9');
    });

    it('should NOT add .zoo to .ext8 .ext9 when .zoo extends .ext8 > .ext9', async () => {
      // Parser-built: .ext8 .ext9 { } and .zoo:extend(.ext8 > .ext9 all) {}
      const root = rules([
        ruleset({
          selector: sel([el('.ext8'), co(' '), el('.ext9')]),
          rules: rules([])
        }),
        ruleset({
          selector: el('.zoo'),
          rules: rules([
            extend({
              target: sel([el('.ext8'), co('>'), el('.ext9')]),
              flag: ExtendFlag.All
            })
          ])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const ext8Ext9Ruleset = evald.data[0];
      const selectorStr = ext8Ext9Ruleset?.data?.selector?.valueOf() ?? '';
      expect(selectorStr).toBe('.ext8 .ext9');
      expect(selectorStr).not.toContain('.zoo');
    });

    it('should NOT add .zap to nested .ext8 .ext9 when .buu extends first, then .zap extends', async () => {
      // Parser-built: ruleset .ext8 .ext9,.ext8 + .ext9,.ext8 > .ext9; nested .ext8 { .ext9 { } }; .buu:extend(.ext8 .ext9 all); .zap:extend(.ext8 + .ext9 all)
      const ruleset1Body = rules([]);
      const ruleset1 = ruleset({
        selector: sellist([
          sel([el('.ext8'), co(' '), el('.ext9')]),
          sel([el('.ext8'), co('+'), el('.ext9')]),
          sel([el('.ext8'), co('>'), el('.ext9')])
        ]),
        rules: ruleset1Body
      });
      const nestedRuleset = ruleset({
        selector: sel([el('.ext8'), co(' '), el('.ext9')]),
        rules: rules([])
      });
      const ext8Body = rules([nestedRuleset]);
      const ext8Ruleset = ruleset({ selector: el('.ext8'), rules: ext8Body });
      const root = rules([
        ruleset1,
        ext8Ruleset,
        ruleset({
          selector: el('.buu'),
          rules: rules([
            extend({
              target: sel([el('.ext8'), co(' '), el('.ext9')]),
              flag: ExtendFlag.All
            })
          ])
        }),
        ruleset({
          selector: el('.zap'),
          rules: rules([
            extend({
              target: sel([el('.ext8'), co('+'), el('.ext9')]),
              flag: ExtendFlag.All
            })
          ])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.data[0];
      const nested = evald.data[1]?.data?.rules?.data?.[0];
      expect(firstRuleset?.data?.selector?.valueOf()).toContain('.zap');
      const nestedSel = nested?.data?.selector?.valueOf() ?? '';
      expect(nestedSel).not.toContain('.zap');
      expect(nestedSel).toContain('.buu');
    });
  });
});
