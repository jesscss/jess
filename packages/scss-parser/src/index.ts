import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { scssAstGrammar } from './ast/grammar.js';
import { lowerUserFunctionCalls } from './ast/lower-user-function-calls.js';

/** Structured failure from the public direct SCSS parser. */
export class ScssParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];

  constructor(offset: number, expected: readonly string[]) {
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(`SCSS parser error.${detail}`);
    this.name = 'ScssParseError';
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

/** Parse SCSS directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const entry = scssAstGrammar.ScssAstDocument;
  const trivia = scssAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('SCSS AST grammar is missing its public document entry.');
  }
  const result = run(entry, input, { trivia });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const offset = result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start;
    throw new ScssParseError(offset, result.expected);
  }
  // Rewrite user-`@function` call sites to `$f(args)` lambda invokes (no-op unless
  // the document defines a user function).
  return lowerUserFunctionCalls(result.value);
}
