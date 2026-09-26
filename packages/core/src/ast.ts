/**
 * Dependency-free AST-v2 construction surface.
 *
 * Parsers may import this entry point to create the canonical AST without pulling
 * in evaluation, serialization, functions, or the legacy tree runtime.
 */
export * from './ast/node.js';
export * from './ast/nodes.js';
export * from './ast/traversal.js';
export * from './ast/at-rule.js';
export * from './ast/math-functions.js';
export { delimiterClose, delimiterOpen, sepGlue } from './ast/value-eval.js';
export {
  NO_SPAN,
  bodySpanOf,
  createTriviaMapFromRanges,
  createTriviaMapFromParseman,
  createTriviaMapFromRootIndex,
  hasAmbientFunctions,
  sourceEndOf,
  sourceStartOf,
  sourceSpanOf,
  triviaMapOf,
  valueBoundaryTriviaOf,
  valueLayoutOf,
  withBodySpan,
  withSourceSpan,
  withTriviaMap,
  withValueBoundaryTrivia,
  withFunctionScope,
  withValueLayout
} from './ast/provenance.js';
export type { AstSourceSpan, FunctionScope, AstTriviaRange, ParserRootTriviaGap, ParserRootTriviaIndex, ParserTriviaEntriesView, ValueBoundaryTrivia, ValueLayout } from './ast/provenance.js';
export {
  bodySpanFromRaw,
  isComplexSelector,
  isForBinding,
  isModuleImport,
  isRelativeSelector,
  isSpannedToken,
  isToken,
  keywordOrNull,
  semanticGapText,
  withBlockBody
} from './ast/grammar-helpers.js';
export type { SourceSpan, SpannedToken, Token } from './ast/grammar-helpers.js';
export {
  authoredSeparators,
  authoredText,
  blockStatements,
  branchRest,
  ifTestCall,
  withFirstBranchCondition,
  branchSegments,
  chainedQueryComparison,
  complexSegments,
  cssRelativeCombinator,
  documentStatements,
  firstValue,
  flattenSequences,
  foldOperation,
  functionOpenName,
  importPrelude,
  isAtRuleBlock,
  isComplex,
  isCompound,
  isDeclaration,
  isDocumentStatement,
  isImportTarget,
  isInterpolation,
  isKeyword,
  isMathOperator,
  isNodeType,
  isUnknownAtRuleBlock,
  isRelative,
  isRuleset,
  isRulesetStatement,
  isSelectorBranch,
  isSelectorList,
  isSelectorTerm,
  isSimple,
  isSimpleToken,
  isTerminalText,
  isValue,
  isValueSlotArray,
  isValueSlotValue,
  keyframeSelectorList,
  unknownBodyText,
  optionalValue,
  parenGroupBlock,
  queryComparisonOperators,
  rulesetStatements,
  selectorArgumentText,
  selectorBranches,
  selectorCombinator,
  selectorTermFromTokens,
  semanticTextWithTriviaGaps,
  semicolonGroupedCall,
  sourceText,
  spaceRun,
  STRUCTURED_PSEUDOS,
  tokenText,
  valueChildren,
  valueSlot,
  valueSlotChildren,
  withAuthoredSeparators
} from './ast/css-grammar-helpers.js';
export type { GuardNode } from './ast/guard.js';
export type { CallArg } from './ast/mixin-dispatch.js';
