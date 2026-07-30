export {
  cssCstBuildHost, parseCst, parseDocCst, parseCssCst, parseCssDiagnosticCst, parseCssDiagnosticDoc, parseCssDoc,
  type CssCstChild, type CssCstError, type CssCstLeaf, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type CssCstType, type ParseDoc
} from './cst-css.js';
import { run } from 'parseman';
import type { Span } from 'parseman';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import { cssGrammar } from './grammar/ast.js';
import { cssPositionsGrammar } from './grammar/ast/positions.js';
import { commentTriviaLabels } from './cst.js';

export type CssParseOptions = {
  readonly trackLines?: boolean;
};

/** Structured failure from the public direct CSS parser. */
export class CssParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;

  constructor(
    offset: number,
    expected: readonly string[],
    options: {
      line?: number;
      column?: number;
      endLine?: number;
      endColumn?: number;
    } = {}
  ) {
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(`CSS parser error.${detail}`);
    this.name = 'CssParseError';
    this.offset = offset;
    this.expected = expected;
    this.line = options.line;
    this.column = options.column;
    this.endLine = options.endLine;
    this.endColumn = options.endColumn;
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

function lineOptions(span: Span): {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
} {
  return {
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn
  };
}

/** Parse CSS directly into the canonical AST v2 document. */
export function parse(input: string, options: CssParseOptions = {}): Stylesheet {
  const grammar = options.trackLines ? cssPositionsGrammar : cssGrammar;
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('CSS AST grammar is missing its public Stylesheet entry.');
  }
  const result = run(
    entry,
    input,
    { trivia, rootTrivia: { select: commentTriviaLabels } }
  );
  const recoveryError = result.errors[0];
  if (!result.ok || result.unconsumedFrom !== null || recoveryError !== undefined || !isStylesheet(result.value)) {
    const failureSpan = recoveryError?.span ?? (result.ok ? undefined : result.span);
    const offset = failureSpan?.start ?? (result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start);
    throw new CssParseError(
      offset,
      recoveryError?.expected ?? result.expected,
      failureSpan === undefined ? {} : lineOptions(failureSpan)
    );
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
}
