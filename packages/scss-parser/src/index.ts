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
  const result = run(scssAstGrammar.ScssAstDocument, input, { trivia: scssAstGrammar.whitespace });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    throw new SyntaxError('SCSS parse did not produce a complete Stylesheet document.');
  }
  return result.value;
}
