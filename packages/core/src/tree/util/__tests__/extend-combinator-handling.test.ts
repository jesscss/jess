import { extendSelector } from '../extend';
import { el, sel, compound, co } from '../../..';
import { isNode } from '../is-node';
import { Combinator } from '../../combinator';

/**
 * Test suite to verify that all combinators (>, +, ~, space) are properly preserved
 * during selector extension operations, not hardcoded to '>'
 */
describe('Combinator Preservation in Extensions', () => {
  function createComplexSelector(firstClass: string, combinator: string, secondClass: string) {
    return sel([
      compound([el('.parent'), el(firstClass)]),
      co(combinator),
      el(secondClass)
    ]);
  }

  function testCombinatorPreservation(combinator: string, testName: string) {
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
        expect((foundCombinator as Combinator).value).toBe(combinator);
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
  });
});
