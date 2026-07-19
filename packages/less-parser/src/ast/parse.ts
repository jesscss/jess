/**
 * Closed direct AST-v2 Less parser pilot for plain quoted `@import` and
 * variable-declaration, declaration, ruleset, and comment facts.
 *
 * It proves that the Less grammar can construct the canonical ImportAtRule
 * directly. It deliberately performs no loading, resolution, source reparse,
 * or StyleImport compatibility work; those remain parser-side follow-up work.
 */
import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { lessAstGrammar } from './grammar.js';

export type LessAstParseError = { message: string; offset: number };

export type LessAstParseResult = {
  document: Root | null;
  errors: LessAstParseError[];
};

function isRoot(value: unknown): value is Root {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Root'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse the closed import/variable/declaration/ruleset subset into canonical AST-v2 data. */
export function parse(input: string): LessAstParseResult {
  const result = run(lessAstGrammar.LessAstDocument, input, { trivia: lessAstGrammar.whitespace });
  if (result.ok && result.unconsumedFrom === null && isRoot(result.value)) {
    // Parseman's public runner exposes `unknown`; accept only the grammar's
    // canonical Root result rather than asserting a value across that boundary.
    return { document: result.value, errors: [] };
  }
  return {
    document: null,
    errors: [{ message: result.ok ? 'Unexpected input' : result.expected.join(', ') || 'Parse error', offset: result.ok ? result.unconsumedFrom ?? 0 : result.span.start }]
  };
}
