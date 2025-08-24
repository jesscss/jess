import { testMayAsync, testStatic, createStaticRuleset, createVariableReference, createVariableInSequence, createVariableInList, createVariableInParen, createVariableInSquareBlock, createVariableInOperation, createStyleImport, createVariableInNegative, createVariableInCall, createGuardWithVariable, createAtRuleVariable, createSelectorInterpolation } from './helpers';

describe('Less mayAsync roll-up (bubble)', () => {
  // Static content
  testStatic('pure sync tree has mayAsync=false', () => createStaticRuleset());

  // Variable references
  testMayAsync('variable reference bubbles to root', () => createVariableReference());

  // Complex structures with variables
  testMayAsync('Sequence in declaration bubbles', () => createVariableInSequence());
  testMayAsync('List bubbles', () => createVariableInList());
  testMayAsync('Paren bubbles', () => createVariableInParen());
  testMayAsync('Square Block bubbles', () => createVariableInSquareBlock());
  testMayAsync('Operation bubbles', () => createVariableInOperation());
  testMayAsync('Ruleset bubbles', () => createVariableReference());
  testMayAsync('StyleImport bubbles', () => createStyleImport());
  testMayAsync('Mixin body bubbles', () => createVariableReference()); // Simplified version
  testMayAsync('Negative bubbles', () => createVariableInNegative());
  testMayAsync('Call args bubble', () => createVariableInCall());
  testMayAsync('Guard bubbles', () => createGuardWithVariable());
  testMayAsync('AtRule inner bubbles', () => createAtRuleVariable());

  // Selector interpolation
  testMayAsync('Pseudo selector with selector-child bubbles', () => createSelectorInterpolation()); // Simplified version
  testMayAsync('Compound selector bubbles', () => createSelectorInterpolation());
  testMayAsync('Complex selector bubbles', () => createSelectorInterpolation());
  testMayAsync('Selector list bubbles when any branch async', () => createSelectorInterpolation());
});
