/**
 * A closed direct AST-v2 Parseman path.
 *
 * This is intentionally small: simple qualified rules and structural comments.
 * Its reductions create the canonical core AST literals themselves; no parse
 * host, builder dispatch map, legacy node, or compatibility bridge participates.
 */
import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { directCssAstGrammar } from './direct-ast/grammar.js';

export type CssAstParseError = { message: string; offset: number };

export type CssAstParseResult = {
  document: Root | null;
  errors: CssAstParseError[];
};

function isRoot(value: unknown): value is Root {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Root'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse the closed direct-AST CSS subset into canonical AST-v2 data. */
export function parse(input: string): CssAstParseResult {
  const result = run(directCssAstGrammar.DirectCssDocument, input, { trivia: directCssAstGrammar.whitespace });
  if (result.ok && result.unconsumedFrom === null) {
    if (isRoot(result.value)) {
      return { document: result.value, errors: [] };
    }
  }
  return {
    document: null,
    errors: [{
      message: result.ok
        ? result.unconsumedFrom === null ? 'Direct CSS grammar did not construct Root' : 'Unexpected input'
        : result.expected.join(', ') || 'Parse error',
      offset: result.ok ? result.unconsumedFrom ?? 0 : result.span.start
    }]
  };
}
