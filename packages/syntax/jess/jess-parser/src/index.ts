export { jessGrammar } from './grammar.js';
export { parseJessCst, parseJessDoc } from './cst.js';
export type {
  JessCstChild, JessCstError, JessCstLeaf, JessCstNode, JessCstParseResult, JessCstType
} from './cst.js';

import { run } from 'parseman';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import { jessAstGrammar } from './grammar.js';

/** Structured failure from the public direct Jess parser. */
export class JessParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];

  constructor(offset: number, expected: readonly string[]) {
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(`Jess parser error.${detail}`);
    this.name = 'JessParseError';
    this.offset = offset;
    this.expected = expected;
  }
}

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse Jess directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const entry = jessAstGrammar.Stylesheet;
  const trivia = jessAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('Jess AST grammar is missing its public document entry.');
  }
  const result = run(
    entry,
    input,
    { trivia }
  );
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const offset = result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start;
    const expected = result.expected;
    throw new JessParseError(
      offset,
      expected
    );
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.triviaMap)
  );
}
