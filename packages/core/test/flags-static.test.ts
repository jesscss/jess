import { testStatic, testNonStatic, testMayAsync, testBothFlags, testIsolation, createStaticRuleset, createVariableReference, createOperation, createVariableInOperation, createCall, createVariableInCall, createNegative, createVariableInNegative, createParen, createVariableInParen, createList, createVariableInList, createSequence, createVariableInSequence, createSquareBlock, createVariableInSquareBlock, createStyleImport, createMixinDefinition, createGuardWithStatic, createGuardWithVariable, createAtRuleStatic, createAtRuleVariable, createSelectorInterpolation, createMultipleRules, DEFAULT_VARIABLE } from './helpers';
import { decl, any, el, num, Operation } from '../src';

describe('Less static / non-static marker flags roll-up (bubble)', () => {
  // Static content tests
  testStatic('pure static tree has static flag set', () => createStaticRuleset());

  // Variable reference tests
  testBothFlags('variable reference sets both flags', () => createVariableReference());

  // Operation tests
  testNonStatic('operation sets non-static flag', () => createOperation());
  testBothFlags('operation with variable sets both flags', () => createVariableInOperation());

  // Call function tests
  testBothFlags('call function sets non-static flag', () => createCall());
  testBothFlags('call function with variable sets both flags', () => createVariableInCall());

  // Negative operation tests
  testNonStatic('negative operation sets non-static flag', () => createNegative());
  testBothFlags('negative variable sets both flags', () => createVariableInNegative());

  // Paren expression tests
  testStatic('paren expression with static content sets static flag', () => createParen());
  testBothFlags('paren variable sets both flags', () => createVariableInParen());

  // List tests
  testStatic('list with static values sets static flag', () => createList());
  testBothFlags('list with variable sets both flags', () => createVariableInList());

  // Sequence tests
  testStatic('sequence with static values sets static flag', () => createSequence());
  testBothFlags('sequence with variable sets both flags', () => createVariableInSequence());

  // Square block tests
  testStatic('square block with static values sets static flag', () => createSquareBlock());
  testBothFlags('square block with variable sets both flags', () => createVariableInSquareBlock());

  // Import and mixin tests
  testBothFlags('style import sets both flags', () => createStyleImport());
  testStatic('mixin definition with static body sets static flag', () => createMixinDefinition());
  testBothFlags('mixin definition with variable body sets both flags', () => createMixinDefinition(decl({ name: 'color', value: DEFAULT_VARIABLE })));

  // Guard tests
  testNonStatic('guard with static condition sets non-static flag', () => createGuardWithStatic());
  testBothFlags('guard with variable condition sets both flags', () => createGuardWithVariable());

  // At-rule tests
  testStatic('at-rule with static inner content sets static flag', () => createAtRuleStatic());
  testBothFlags('at-rule with variable inner content sets both flags', () => createAtRuleVariable());
});

describe('Less evaluation flags isolation', () => {
  testIsolation(
    'static sibling rules maintain clean state when one rule has operations',
    () => createMultipleRules([
      createStaticRuleset(el('.static-rule'), [
        decl({ name: 'color', value: any('red') }),
        decl({ name: 'background', value: any('blue') })
      ]),
      createOperation(),
      createStaticRuleset(el('.another-static-rule'), [
        decl({ name: 'border', value: any('1px solid black') })
      ])
    ]),
    false, // non-static (because one child has operations)
    false // no mayAsync
  );

  testIsolation(
    'static sibling rules maintain clean state when one rule has variables',
    () => createMultipleRules([
      createStaticRuleset(el('.static-rule'), [
        decl({ name: 'color', value: any('red') }),
        decl({ name: 'background', value: any('blue') })
      ]),
      createVariableReference(),
      createStaticRuleset(el('.another-static-rule'), [
        decl({ name: 'border', value: any('1px solid black') })
      ])
    ]),
    false, // non-static (because one child has variables)
    true // mayAsync (because one child has variables)
  );

  testIsolation(
    'static declarations in same ruleset maintain clean state when one declaration has operations',
    () => createStaticRuleset(el('.container'), [
      decl({ name: 'color', value: any('red') }),
      decl({ name: 'width', value: new Operation([num(1), '+', num(2)]) }),
      decl({ name: 'background', value: any('blue') })
    ]),
    false, // non-static
    false // no mayAsync
  );

  testIsolation(
    'static declarations in same ruleset maintain clean state when one declaration has variables',
    () => createStaticRuleset(el('.container'), [
      decl({ name: 'color', value: any('red') }),
      decl({ name: 'background', value: DEFAULT_VARIABLE }),
      decl({ name: 'border', value: any('1px solid black') })
    ]),
    false, // non-static
    true // mayAsync
  );

  // Selector interpolation tests
  testBothFlags('selector interpolation sets both flags', () => createSelectorInterpolation());
  testBothFlags('compound selector interpolation sets both flags', () => createSelectorInterpolation());
  testBothFlags('complex selector interpolation sets both flags', () => createSelectorInterpolation());
  testBothFlags('selector list with mixed static and interpolated selectors sets both flags', () => createSelectorInterpolation());
});
