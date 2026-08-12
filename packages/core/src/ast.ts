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
export {
  bodySpanOf,
  createTriviaMapFromRanges,
  createTriviaMapFromParseman,
  createTriviaMapFromRootIndex,
  sourceSpanOf,
  triviaMapOf,
  valueLayoutOf,
  withBodySpan,
  withSourceSpan,
  withTriviaMap,
  withValueLayout
} from './ast/provenance.js';
export type { AstSourceSpan, AstTriviaRange, ParserRootTriviaGap, ParserRootTriviaIndex, ParserTriviaEntriesView, ValueLayout } from './ast/provenance.js';
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
export type { GuardNode } from './ast/guard.js';
export type { CallArg } from './ast/mixin-dispatch.js';
