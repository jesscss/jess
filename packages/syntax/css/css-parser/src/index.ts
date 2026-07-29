export { cssCstGrammar, cssGrammar } from './grammar.js';
export {
  cssCstBuildHost, parseCst, parseDocCst, parseCssCst, parseCssDoc,
  type CssCstChild, type CssCstError, type CssCstLeaf, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type CssCstType, type ParseDoc
} from './cst-css.js';
import { run } from 'parseman';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import { cssAstGrammar } from './grammar.js';

/** Structured failure from the public direct CSS parser. */
export class CssParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];

  constructor(offset: number, expected: readonly string[]) {
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(`CSS parser error.${detail}`);
    this.name = 'CssParseError';
    this.offset = offset;
    this.expected = expected;
  }
}

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'rules' in value
    && Array.isArray(value.rules);
}

/** Parse CSS directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const entry = cssAstGrammar.Stylesheet;
  const trivia = cssAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('CSS AST grammar is missing its public Stylesheet entry.');
  }
  const result = run(
    entry,
    input,
    { trivia }
  );
  const recoveryError = result.errors[0];
  if (!result.ok || result.unconsumedFrom !== null || recoveryError !== undefined || !isStylesheet(result.value)) {
    const offset = recoveryError?.span.start ?? (result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start);
    throw new CssParseError(
      offset,
      recoveryError?.expected ?? result.expected
    );
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.triviaMap)
  );
}
