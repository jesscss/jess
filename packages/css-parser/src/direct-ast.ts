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

/** Parse the closed direct-AST CSS subset into canonical AST-v2 data. */
export function parse(input: string): CssAstParseResult {
  const result = run(directCssAstGrammar.DirectCssDocument, input, { trivia: directCssAstGrammar.whitespace });
  if (result.ok && result.unconsumedFrom === null) {
    // Parseman's public run() result is untyped even when its entry is a typed
    // combinator. This is the grammar-owned Root contract, not a recovery path.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return { document: result.value as Root, errors: [] };
  }
  return {
    document: null,
    errors: [{ message: result.ok ? 'Unexpected input' : result.expected.join(', ') || 'Parse error', offset: result.ok ? result.unconsumedFrom ?? 0 : result.span.start }]
  };
}
