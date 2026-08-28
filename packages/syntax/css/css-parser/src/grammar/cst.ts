/** Build entry for the CST CSS grammar. */
import { cssCstGrammar } from '../grammar.js';

export { cssCstGrammar } from '../grammar.js';

/*
 * Individual CST rule handles, so a caller can `run` a single production
 * without reaching into the rule map. They destructure the CST artifact and so
 * belong to this build rather than to `../grammar.ts`, which every variant
 * entry imports.
 */
export const {
  Stylesheet,
  Ruleset,
  SelectorList,
  ComplexSelector,
  CompoundSelector,
  BasicSelector,
  AttributeSelector,
  PseudoSelector,
  Declaration,
  CustomDeclaration,
  Dimension,
  Color,
  Url,
  Call,
  Quoted,
  AtRuleStatement
} = cssCstGrammar;
