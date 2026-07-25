import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { lessAstGrammar } from './ast/grammar.js';
import { LessParseError } from './parse-error.js';

export { LessDynamicCharsetError, LessParseError } from './parse-error.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse Less directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const entry = lessAstGrammar.LessAstDocument;
  const trivia = lessAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('Less AST grammar is missing its public document entry.');
  }
  const result = run(entry, input, { trivia });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const offset = result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start;
    const expected = result.expected;
    throw new LessParseError(offset, expected);
  }
  return result.value;
}
