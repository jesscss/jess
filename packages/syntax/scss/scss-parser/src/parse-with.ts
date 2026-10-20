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
  isSelectorList,
  recoveredInTree,
  selectorBranchComponents,
  selectorBranchHasAmpersand,
  selectorBranchHasInterp,
  withSourceSpan,
  withForgivenSelectorItems,
  withTriviaMap,
  type ForgivenSelectorItem,
  type Stylesheet
} from '@jesscss/core/ast';
import type { scssGrammar } from './grammar/ast.js';
import { ScssParseError, type ScssRecoveredError } from './parse-error.js';
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

/** A parse that recovered: the document, and the located errors it carried on past (ledger P45). */
export interface ScssParsed {
  readonly document: Stylesheet;
  readonly recovered: readonly ScssRecoveredError[];
}

/** The document, or the first problem the grammar recovered from, raised. */
export function parseWith(grammar: ScssAstGrammar, input: string): Stylesheet {
  const { document, recovered } = parseRecoveringWith(grammar, input);
  if (recovered[0] !== undefined) {
    throw recovered[0];
  }
  return document;
}

/**
 * The document with the problems the grammar recovered from (P45: a
 * well-formed shape SCSS rejects or gives no meaning to is a located error, and
 * the parse carries on). A shape that is not well-formed still throws.
 */
export function parseRecoveringWith(grammar: ScssAstGrammar, input: string): ScssParsed {
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('SCSS AST grammar is missing its public document entry.');
  }

  /*
   * The input rides the parse state, as it does for CSS, so a reducer can
   * record the source bytes it covers: the CSS base's media reducers keep a
   * `<general-enclosed>` query group as written (ledger N14), and an
   * interpolated string (`Quoted`) keeps its authored spelling. A reducer that
   * does not read the state never copies it. `state.diagnostics` collects what
   * the grammar recovered from (P45).
   */
  const diagnostics: ScssRecoveredError[] = [];
  const forgivenSelectorItems: ForgivenSelectorItem[] = [];
  const result = run(
    entry,
    input,
    { trivia, state: { source: input, diagnostics, document: { forgivenSelectorItems } }, rootTrivia: { select: commentTriviaLabels } }
  );

  /*
   * A recovery error outranks the two branches below, exactly as it does in the
   * CSS parser this one mirrors: it localises the FIRST real problem, where
   * `result.span` only reports where the run gave up and the `unconsumedFrom`
   * branches carry no expected set at all. An `expect()` recovers in place, so
   * without this the run finishes "successfully" over input a rule refused.
   */
  const recoveryError = result.errors[0];
  if (recoveryError !== undefined) {
    throw new ScssParseError(
      recoveryError.span.start,
      recoveryError.expected,
      lineOptions(input, recoveryError.span)
    );
  }
  if (!result.ok) {
    throw new ScssParseError(result.span.start, result.expected, lineOptions(input, result.span));
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

  const document = withForgivenSelectorItems(withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  ), forgivenSelectorItems);
  return { document, recovered: inSourceOrder(recoveredInTree(document, diagnostics)) };
}

/** One report per item, ordered by where it is written: a reducer may run more than once. */
function inSourceOrder(diagnostics: readonly ScssRecoveredError[]): readonly ScssRecoveredError[] {
  if (diagnostics.length < 2) {
    return diagnostics;
  }
  const byItem = new Map<string, ScssRecoveredError>();
  for (const error of diagnostics) {
    byItem.set(`${error.offset}:${error.endOffset}:${error.message}`, error);
  }
  return [...byItem.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * `text` read by the grammar's own `SelectorList` production, as Sass's
 * `selector.parse()` reads a selector string: each branch's compound selectors and
 * combinators. A
 * string that is not a whole selector list, or that holds `&`, throws with Dart
 * Sass's message. The selectors a stylesheet writes and the ones a string holds
 * are read by the one production.
 */
export function parseSelectorWith(grammar: ScssAstGrammar, text: string): string[][] {
  const entry = grammar.SelectorList;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError('SCSS AST grammar is missing its selector-list entry.');
  }
  const source = text.trim();
  const diagnostics: ScssRecoveredError[] = [];
  const result = run(entry, source, { trivia, state: { source, diagnostics } });
  if (!result.ok || result.unconsumedFrom !== null || result.errors.length > 0 || diagnostics.length > 0 || !isSelectorList(result.value)) {
    throw new TypeError('$selector: expected selector.');
  }
  const branches = result.value.selectors;
  if (branches.some(selectorBranchHasInterp)) {
    throw new TypeError('$selector: expected selector.');
  }
  if (branches.some(selectorBranchHasAmpersand)) {
    throw new TypeError('$selector: Parent selectors aren\'t allowed here.');
  }
  return branches.map(selectorBranchComponents);
}
