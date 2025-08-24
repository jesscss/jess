import { testStatic, testNonStatic, testMayAsync, testBothFlags, testPatterns, testIsolation } from './helpers';

describe('Less static / non-static marker flags roll-up (bubble)', () => {
  // Static content tests
  testStatic('pure static tree has static flag set', testPatterns.staticRuleset());

  // Variable reference tests
  testBothFlags('variable reference sets both flags', testPatterns.variableReference());

  // Operation tests
  testNonStatic('operation sets non-static flag', testPatterns.staticOperation());
  testBothFlags('operation with variable sets both flags', testPatterns.variableInOperation());

  // Call function tests
  testBothFlags('call function sets non-static flag', testPatterns.staticCall());
  testBothFlags('call function with variable sets both flags', testPatterns.variableInCall());

  // Negative operation tests
  testNonStatic('negative operation sets non-static flag', testPatterns.staticNegative());
  testBothFlags('negative variable sets both flags', testPatterns.variableInNegative());

  // Paren expression tests
  testStatic('paren expression with static content sets static flag', testPatterns.staticParen());
  testBothFlags('paren variable sets both flags', testPatterns.variableInParen());

  // List tests
  testNonStatic('list with static values sets non-static flag', testPatterns.staticList());
  testBothFlags('list with variable sets both flags', testPatterns.variableInList());

  // Sequence tests
  testStatic('sequence with static values sets static flag', testPatterns.staticSequence());
  testBothFlags('sequence with variable sets both flags', testPatterns.variableInSequence());

  // Square block tests
  testStatic('square block with static values sets static flag', testPatterns.staticSquareBlock());
  testBothFlags('square block with variable sets both flags', testPatterns.variableInSquareBlock());

  // Import and mixin tests
  testBothFlags('style import sets both flags', testPatterns.styleImport());
  testStatic('mixin definition with static body sets static flag', testPatterns.mixinDefinition('color: red'));
  testBothFlags('mixin definition with variable body sets both flags', testPatterns.mixinDefinition('color: @var'));

  // Guard tests
  testNonStatic('guard with static condition sets non-static flag', testPatterns.guardWithStatic());
  testBothFlags('guard with variable condition sets both flags', testPatterns.guardWithVariable());

  // At-rule tests
  testStatic('at-rule with static inner content sets static flag', testPatterns.atRuleStatic());
  testBothFlags('at-rule with variable inner content sets both flags', testPatterns.atRuleVariable());
});

describe('Less evaluation flags isolation', () => {
  testIsolation(
    'static sibling rules maintain clean state when one rule has operations',
    testPatterns.multipleRules([
      '.static-rule { color: red; background: blue; }',
      '.dynamic-rule { width: 1 + 2; }',
      '.another-static-rule { border: 1px solid black; }'
    ]),
    true, // static (for the individual static rules)
    false // no mayAsync
  );

  testIsolation(
    'static sibling rules maintain clean state when one rule has variables',
    testPatterns.multipleRules([
      '.static-rule { color: red; background: blue; }',
      '.dynamic-rule { color: @var; }',
      '.another-static-rule { border: 1px solid black; }'
    ]),
    false, // non-static (because one child has variables)
    true // mayAsync (because one child has variables)
  );

  testIsolation(
    'static declarations in same ruleset maintain clean state when one declaration has operations',
    `
      .container {
        color: red;
        width: 1 + 2;
        background: blue;
      }
    `,
    false, // non-static
    false // no mayAsync
  );

  testIsolation(
    'static declarations in same ruleset maintain clean state when one declaration has variables',
    `
      .container {
        color: red;
        background: @var;
        border: 1px solid black;
      }
    `,
    false, // non-static
    true // mayAsync
  );

  // Selector interpolation tests
  testBothFlags('selector interpolation sets both flags', testPatterns.selectorInterpolation());
  testBothFlags('compound selector interpolation sets both flags', testPatterns.compoundSelectorInterpolation());
  testBothFlags('complex selector interpolation sets both flags', testPatterns.complexSelectorInterpolation());
  testBothFlags('selector list with mixed static and interpolated selectors sets both flags', testPatterns.selectorListInterpolation());
});
