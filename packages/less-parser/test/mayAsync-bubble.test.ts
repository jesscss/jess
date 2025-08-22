import { testMayAsync, testStatic, testPatterns } from './helpers';

describe('Less mayAsync roll-up (bubble)', () => {
  // Static content
  testStatic('pure sync tree has mayAsync=false', testPatterns.staticRuleset());

  // Variable references
  testMayAsync('variable reference bubbles to root', testPatterns.variableReference());

  // Complex structures with variables
  testMayAsync('Sequence in declaration bubbles', testPatterns.variableInSequence());
  testMayAsync('List bubbles', testPatterns.variableInList());
  testMayAsync('Paren bubbles', testPatterns.variableInParen());
  testMayAsync('Square Block bubbles', testPatterns.variableInSquareBlock());
  testMayAsync('Operation bubbles', testPatterns.variableInOperation());
  testMayAsync('Ruleset bubbles', testPatterns.variableReference());
  testMayAsync('StyleImport bubbles', testPatterns.styleImport());
  testMayAsync('Mixin body bubbles', '.x() { a: @v } .a { .x(); }');
  testMayAsync('Negative bubbles', testPatterns.variableInNegative());
  testMayAsync('Call args bubble', testPatterns.variableInCall());
  testMayAsync('Guard bubbles', testPatterns.guardWithVariable());
  testMayAsync('AtRule inner bubbles', testPatterns.atRuleVariable());

  // Selector interpolation
  testMayAsync('Pseudo selector with selector-child bubbles', '.a:has(.@{x}) { y: 1 }');
  testMayAsync('Compound selector bubbles', testPatterns.compoundSelectorInterpolation('@{c}'));
  testMayAsync('Complex selector bubbles', testPatterns.complexSelectorInterpolation('@{c}'));
  testMayAsync('Selector list bubbles when any branch async', testPatterns.selectorListInterpolation('@{c}'));
});
