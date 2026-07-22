import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { scssAstGrammar } from './ast/grammar.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse SCSS directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const entry = scssAstGrammar.ScssAstDocument;
  const trivia = scssAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('SCSS AST grammar is missing its public document entry.');
  }
  const result = run(entry, input, { trivia });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    throw new SyntaxError('SCSS parse did not produce a complete Stylesheet document.');
  }
  return result.value;
}
