/**
 * Dependency-free AST-v2 construction surface.
 *
 * Parsers may import this entry point to create the canonical AST without pulling
 * in evaluation, serialization, functions, or the legacy tree runtime.
 */
export * from './ast/node.js';
export * from './ast/nodes.js';
export * from './ast/at-rule.js';
export {
  bodySpanOf,
  createTriviaMapFromRanges,
  createTriviaMapFromRootIndex,
  sourceSpanOf,
  triviaMapOf,
  valueLayoutOf,
  withBodySpan,
  withSourceSpan,
  withTriviaMap,
  withValueLayout
} from './ast/provenance.js';
export type { AstSourceSpan, AstTriviaRange, ParserRootTriviaIndex, ParserTriviaEntriesView, ValueLayout } from './ast/provenance.js';
export type { GuardNode } from './ast/guard.js';
export type { CallArg } from './ast/mixin-dispatch.js';
