/**
 * The `parse()` body, shared by the two AST entries.
 *
 * The grammar table arrives as an argument rather than being chosen from a
 * boolean inside this module: Node does not tree-shake, so a module that names
 * both compiled tables executes both at load time. Each entry imports exactly
 * the one table it parses with, and this module imports none.
 */
import { run } from 'parseman';
import type { Span } from 'parseman';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import type { cssGrammar } from './grammar/ast.js';
import { CssParseError } from './parse-error.js';
import { commentTriviaLabels } from './trivia-labels.js';

/** The rule map both compiled CSS AST variants expose. */
export type CssAstGrammar = typeof cssGrammar;

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

export function parseWith(grammar: CssAstGrammar, input: string): Stylesheet {
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
