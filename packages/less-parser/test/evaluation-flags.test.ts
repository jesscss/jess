import { testStatic, testNeedsEvaluation, testMayAsync, testBothFlags, testPatterns, testIsolation } from './helpers';

describe('Less evaluation flags roll-up (bubble)', () => {
  // Static content tests
  testStatic('pure static tree has no evaluation flags set', testPatterns.staticRuleset());

  // Variable reference tests
  testMayAsync('variable reference sets mayAsync but no evaluation flags', testPatterns.variableReference());

  // Operation tests
  testNeedsEvaluation('operation sets needs evaluation flag', testPatterns.staticOperation());
  testBothFlags('operation with variable sets both flags', testPatterns.variableInOperation());

  // Call function tests
  testNeedsEvaluation('call function sets needs evaluation flag', testPatterns.staticCall());
  testBothFlags('call function with variable sets both flags', testPatterns.variableInCall());

  // Negative operation tests
  testStatic('negative operation sets needs evaluation flag', testPatterns.staticNegative());
  testBothFlags('negative variable sets both flags', testPatterns.variableInNegative());

  // Paren expression tests
  testNeedsEvaluation('paren expression sets needs evaluation flag', testPatterns.staticParen());
  testBothFlags('paren variable sets both flags', testPatterns.variableInParen());

  // List tests
  testNeedsEvaluation('list with static values sets needs evaluation flag', testPatterns.staticList());
  testBothFlags('list with variable sets both flags', testPatterns.variableInList());

  // Sequence tests
  testNeedsEvaluation('sequence with static values sets needs evaluation flag', testPatterns.staticSequence());
  testBothFlags('sequence with variable sets both flags', testPatterns.variableInSequence());

  // Square block tests
  testNeedsEvaluation('square block with static values sets needs evaluation flag', testPatterns.staticSquareBlock());
  testBothFlags('square block with variable sets both flags', testPatterns.variableInSquareBlock());

  // Import and mixin tests
  testMayAsync('style import sets mayAsync but no evaluation flags', testPatterns.styleImport());
  testStatic('mixin definition with static body has no flags', testPatterns.mixinDefinition('color: red'));
  testMayAsync('mixin definition with variable body sets mayAsync', testPatterns.mixinDefinition('color: @var'));

  // Guard tests
  testNeedsEvaluation('guard with static condition sets needs evaluation flag', testPatterns.guardWithStatic());
  testBothFlags('guard with variable condition sets both flags', testPatterns.guardWithVariable());

  // At-rule tests
  testStatic('at-rule with static inner content has no flags', testPatterns.atRuleStatic());
  testMayAsync('at-rule with variable inner content sets mayAsync', testPatterns.atRuleVariable());
});

describe('Less evaluation flags isolation', () => {
  testIsolation(
    'static sibling rules maintain clean state when one rule has operations',
    testPatterns.multipleRules([
      '.static-rule { color: red; background: blue; }',
      '.dynamic-rule { width: 1 + 2; }',
      '.another-static-rule { border: 1px solid black; }'
    ]),
    true, // needs evaluation
    false // no mayAsync
  );

  testIsolation(
    'static sibling rules maintain clean state when one rule has variables',
    testPatterns.multipleRules([
      '.static-rule { color: red; background: blue; }',
      '.dynamic-rule { color: @var; }',
      '.another-static-rule { border: 1px solid black; }'
    ]),
    false, // no needs evaluation
    true // mayAsync
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
    true, // needs evaluation
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
    false, // no needs evaluation
    true // mayAsync
  );

  // Selector interpolation tests
  testMayAsync('selector interpolation sets mayAsync but no evaluation flags', testPatterns.selectorInterpolation());
  testMayAsync('compound selector interpolation sets mayAsync but no evaluation flags', testPatterns.compoundSelectorInterpolation());
  testMayAsync('complex selector interpolation sets mayAsync but no evaluation flags', testPatterns.complexSelectorInterpolation());
  testMayAsync('selector list with mixed static and interpolated selectors sets mayAsync but no evaluation flags', testPatterns.selectorListInterpolation());
});
