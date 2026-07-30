import { run } from 'parseman';
import type { Span } from 'parseman';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import { scssGrammar } from './grammar/ast.js';
import { scssPositionsGrammar } from './grammar/ast/positions.js';
import { commentTriviaLabels } from './cst.js';

export type ScssParseOptions = {
  readonly trackLines?: boolean;
};

/** Structured failure from the public direct SCSS parser. */
export class ScssParseError extends SyntaxError {
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
    super(`SCSS parser error.${detail}`);
    this.name = 'ScssParseError';
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

/** Parse SCSS directly into the canonical AST v2 document. */
export function parse(input: string, options: ScssParseOptions = {}): Stylesheet {
  const grammar = options.trackLines ? scssPositionsGrammar : scssGrammar;
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('SCSS AST grammar is missing its public document entry.');
  }
  const result = run(
    entry,
    input,
    { trivia, rootTrivia: { select: commentTriviaLabels } }
  );
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const failureSpan = result.ok ? undefined : result.span;
    const offset = failureSpan?.start ?? (result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start);
    throw new ScssParseError(
      offset,
      result.expected,
      failureSpan === undefined ? {} : lineOptions(failureSpan)
    );
  }

  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
}
