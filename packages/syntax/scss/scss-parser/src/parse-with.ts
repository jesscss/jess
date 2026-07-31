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
import type { scssGrammar } from './grammar/ast.js';
import { ScssParseError } from './parse-error.js';
import { commentTriviaLabels } from './trivia-labels.js';

/** The rule map both compiled SCSS AST variants expose. */
export type ScssAstGrammar = typeof scssGrammar;

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

export function parseWith(grammar: ScssAstGrammar, input: string): Stylesheet {
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
  if (!result.ok) {
    throw new ScssParseError(result.span.start, result.expected, lineOptions(input, result.span));
  }

  /*
   * `unconsumedFrom` separates two problems that read very differently to an
   * author, and the message must say which. Past the consumed span the parser
   * already had a whole stylesheet and the trailing text is surplus; at the
   * start of it the very first token was never recognised. Do not collapse
   * these into one message.
   */
  if (result.unconsumedFrom !== null) {
    if (result.unconsumedFrom > result.span.start) {
      throw new ScssParseError(result.unconsumedFrom, [], {
        message: 'Unexpected SCSS input after a complete stylesheet.',
        reason:
          'The parser read a complete SCSS stylesheet before this point, so the remaining text sits outside every rule, declaration, and at-rule.',
        fix: 'Delete the trailing text, or remove the extra "}" — over-closing a nested block ends the stylesheet early.',
        ...positionAt(input, result.unconsumedFrom)
      });
    }
    throw new ScssParseError(result.unconsumedFrom, [], {
      message: 'Unexpected SCSS syntax.',
      reason:
        'The parser could not read this token as the start of an SCSS rule, declaration, or at-rule.',
      fix: 'Remove the token, or rewrite it as a selector block, a "$name: value" assignment, or an at-rule such as @mixin or @include.',
      ...positionAt(input, result.unconsumedFrom)
    });
  }
  if (!isStylesheet(result.value)) {
    throw new ScssParseError(result.span.end, [], {
      message: 'SCSS parser did not produce a stylesheet.',
      reason:
        'The SCSS parser matched the input but returned a value that is not a stylesheet document.',
      fix: 'Report this as a parser bug with the source that triggered it.',
      ...positionAt(input, result.span.end)
    });
  }

  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
}
