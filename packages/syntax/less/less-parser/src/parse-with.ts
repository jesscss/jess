/**
 * The `parse()`/`safeParse()` bodies, shared by the two AST entries.
 *
 * The grammar table arrives as an argument rather than being chosen from a
 * boolean inside this module: Node does not tree-shake, so a module that names
 * both compiled tables executes both at load time. Each entry imports exactly
 * the one table it parses with, and this module imports none.
 */
import { buildLineIndex, offsetToLineCol, run } from 'parseman';
import type { Span } from 'parseman';
import type { ISafeParseResult } from '@jesscss/core';
/*
 * `parserDiagnostic` comes from the narrow `./diagnostics` entry, not the root:
 * the root entry pulls the evaluator, functions, and legacy tree runtime onto
 * this module's static import graph, and Node executes all of it for a caller
 * that only wants `parse`.
 */
import { parserDiagnostic } from '@jesscss/core/diagnostics';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import type { lessGrammar } from './grammar/ast.js';
import { LessParseError } from './parse-error.js';
import { commentTriviaLabels } from './trivia-labels.js';

/** The rule map both compiled Less AST variants expose. */
export type LessAstGrammar = typeof lessGrammar;

function isStylesheet(value: unknown): value is Stylesheet {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'rules' in value
    && Array.isArray(value.rules)
  );
}

/**
 * Line/column at a bare offset. The leftover-input offset is not the start of
 * any span the run returned — `result.span` covers the text that *was*
 * consumed — so the position has to be derived from the offset itself. Only
 * ever reached on a throw path, so building the index here costs a parse
 * nothing.
 */
function positionAt(input: string, offset: number): { line: number; column: number } {
  const { line, col } = offsetToLineCol(buildLineIndex(input), offset);
  return { line, column: col };
}

/**
 * Line/column for a failure span. The compiled table without line tracking
 * leaves a span's line fields unset, so fall back to deriving them; an error
 * that reports an offset but no line is barely actionable in an editor.
 */
function lineOptions(input: string, span: Span): {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
} {
  if (span.startLine === undefined) {
    return positionAt(input, span.start);
  }
  return {
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn
  };
}

export function parseWith(grammar: LessAstGrammar, input: string): Stylesheet {
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError(
      'Less AST grammar is missing its public document entry.'
    );
  }
  const result = run(entry, input, {
    trivia,
    state: { source: input },
    rootTrivia: { select: commentTriviaLabels }
  });
  if (!result.ok) {
    throw new LessParseError(result.span.start, result.expected, lineOptions(input, result.span));
  }
  if (result.unconsumedFrom !== null) {
    if (result.unconsumedFrom > result.span.start) {
      throw new LessParseError(result.unconsumedFrom, [], {
        message: 'Unexpected Less input after a complete stylesheet.',
        reason:
          'The parser consumed a complete Less stylesheet before this token, so the remaining text is not part of any rule, declaration, or at-rule.',
        fix: 'Remove the extra input or wrap it in valid Less syntax.',
        ...positionAt(input, result.unconsumedFrom)
      });
    }
    throw new LessParseError(result.unconsumedFrom, [], {
      message: 'Unexpected Less syntax.',
      reason:
        'The parser could not match this token as the start of a Less rule, declaration, or at-rule.',
      fix: 'Remove the token or rewrite it as valid Less syntax.',
      ...positionAt(input, result.unconsumedFrom)
    });
  }
  if (!isStylesheet(result.value)) {
    throw new LessParseError(result.span.end, [], {
      ...positionAt(input, result.span.end),
      message: 'Less parser did not produce a stylesheet.',
      reason:
        'The Less parser matched the input but returned a value that is not a stylesheet document.',
      fix: 'Report this as a parser bug with the source that triggered it.'
    });
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
}

/**
 * The `safeParse` body for the product plugin path. Parser packages own
 * recognition facts; this boundary attaches file/source context once and
 * returns normalized diagnostics for compiler and CLI consumers to render.
 */
export function safeParseWith(
  grammar: LessAstGrammar,
  filePath: string,
  input: string
): ISafeParseResult {
  try {
    return { document: parseWith(grammar, input), errors: [], warnings: [] };
  } catch (error) {
    return {
      errors: [
        parserDiagnostic({ dialect: 'Less', error, filePath, source: input })
      ],
      warnings: []
    };
  }
}
