/**
 * The `parse()` body, shared by the two AST entries.
 *
 * The grammar table arrives as an argument rather than being chosen from a
 * boolean inside this module: Node does not tree-shake, so a module that names
 * both compiled tables executes both at load time. Each entry imports exactly
 * the one table it parses with, and this module imports none.
 */
import { buildLineIndex, offsetToLineCol, run } from 'parseman';
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

  /*
   * A recovery error outranks the run's own failure span: it localises the
   * first real problem, where `result.span` only reports where the run gave up.
   */
  const recoveryError = result.errors[0];
  if (recoveryError !== undefined) {
    throw new CssParseError(
      recoveryError.span.start,
      recoveryError.expected,
      lineOptions(input, recoveryError.span)
    );
  }
  if (!result.ok) {
    throw new CssParseError(result.span.start, result.expected, lineOptions(input, result.span));
  }

  /*
   * `unconsumedFrom` separates two problems that read very differently to an
   * author, and the message must say which: the parser already had a whole
   * stylesheet and the trailing text is surplus, versus the very first token
   * was never recognised. Do not collapse these into one message.
   *
   * "after a complete stylesheet" has to be earned by actually having parsed
   * something. Keyed on parsed rules, not on the consumed span: leading trivia
   * advances the span end without producing a single rule, so a span test
   * calls `"\n  !broken"` a complete stylesheet, which is simply false. Rules
   * are also independent of whether a dialect's root span covers trailing
   * trivia, which is a convention the four parsers do not share.
   */
  if (result.unconsumedFrom !== null) {
    if (isStylesheet(result.value) && result.value.rules.length > 0) {
      throw new CssParseError(result.unconsumedFrom, [], {
        message: 'Unexpected CSS input after a complete stylesheet.',
        reason:
          'The parser read a complete CSS stylesheet before this point, so the remaining text sits outside every rule, declaration, and at-rule.',
        fix: 'Delete the trailing text, or remove the extra "}" that closed the stylesheet early.',
        ...positionAt(input, result.unconsumedFrom)
      });
    }
    throw new CssParseError(result.unconsumedFrom, [], {
      message: 'Unexpected CSS syntax.',
      reason:
        'The parser could not read this token as the start of a CSS rule, declaration, or at-rule.',
      fix: 'Remove the token, or rewrite it as a selector block, a "property: value" declaration, or an at-rule.',
      ...positionAt(input, result.unconsumedFrom)
    });
  }
  if (!isStylesheet(result.value)) {
    throw new CssParseError(result.span.end, [], {
      message: 'CSS parser did not produce a stylesheet.',
      reason:
        'The CSS parser matched the input but returned a value that is not a stylesheet document.',
      fix: 'Report this as a parser bug with the source that triggered it.',
      ...positionAt(input, result.span.end)
    });
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
}
