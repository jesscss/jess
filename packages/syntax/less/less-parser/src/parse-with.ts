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
import type { ISafeParseResult, MathMode, TriviaMap } from '@jesscss/core';
import type { LessParseState } from './parse-state.js';
/*
 * `parserDiagnostic` comes from the narrow `./diagnostics` entry, not the root:
 * the root entry pulls the evaluator, functions, and legacy tree runtime onto
 * this module's static import graph, and Node executes all of it for a caller
 * that only wants `parse`.
 */
import { parserDiagnostic } from '@jesscss/core/diagnostics';
import {
  NO_SPAN,
  createTriviaMapFromParseman,
  importSourceEndOf,
  importSourceStartOf,
  importTailStartOf,
  isValueSlotArray,
  sourceStartOf,
  valueLayoutOf,
  withSourceSpan,
  withTriviaMap,
  withValueBoundaryTrivia,
  type AtRuleStatement,
  type Stylesheet
} from '@jesscss/core/ast';
import type { lessGrammar } from './grammar/ast.js';
import { LessParseError } from './parse-error.js';
import { commentTriviaLabels } from './trivia-labels.js';

/** The rule map both compiled Less AST variants expose. */
export type LessAstGrammar = typeof lessGrammar;

/**
 * What the caller must tell the Less grammar before it can lower correctly.
 *
 * `mathMode` is here — and not on the evaluator — because Less's `math:` policy
 * decides, per operation, whether arithmetic happens with no enclosing math
 * context. That is a decision the GRAMMAR makes and writes onto the node
 * (`Operation.mathOutsideParens`); eval reads the node and never re-derives it
 * from ambient config (§12.6b). AST v1 had this polarity and v2 lost it.
 */
export interface LessParseOptions {
  readonly mathMode?: MathMode;
}

/**
 * Less's own default, stated here rather than defaulted at each read site so
 * there is exactly one place the fallback lives.
 */
const DEFAULT_LESS_MATH_MODE: MathMode = 'parens-division';
const EMPTY_LAYOUT: readonly string[] = Object.freeze([]);
const SPACE_LAYOUT: readonly string[] = Object.freeze([' ']);

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
 * The one currently typed Less import-query feature is a `Block` containing a
 * colon `Operation`. Its right operand already carries a parser source start,
 * so an exact trivia lookup can retain the comment boundary without walking or
 * classifying source bytes. Opaque tail forms keep their existing byte owner.
 */
function retainTypedImportTailTrivia(
  statement: AtRuleStatement,
  trivia: TriviaMap
): boolean {
  const prelude = statement.prelude;
  if (prelude?.type !== 'Sequence') {
    return false;
  }
  const tail = prelude.parts[1];
  if (tail?.type !== 'Block' || isValueSlotArray(tail.value)
    || tail.value.type !== 'Operation' || tail.value.operator !== ':') {
    return false;
  }
  const rightStart = sourceStartOf(tail.value.right);
  if (rightStart === NO_SPAN) {
    return false;
  }
  const between = trivia.lookup(rightStart, 'before');
  if (between === undefined) {
    return false;
  }
  withValueBoundaryTrivia(tail.value, EMPTY_LAYOUT, {
    before: null,
    between,
    after: null
  });
  return true;
}

/**
 * Project only root-hoisted CSS-import boundaries through the canonical trivia
 * adapter. The grammar carries the statement edges and typed-tail start in
 * fixed private Smi slots, so each lookup names an exact parser-owned boundary
 * and public source provenance, AST/CST shape, and bytes remain unchanged.
 */
function retainRootImportBoundaryTrivia(
  document: Stylesheet,
  trivia: TriviaMap | undefined
): void {
  if (trivia === undefined) {
    return;
  }
  for (const rule of document.rules) {
    if (rule.type !== 'AtRuleStatement') {
      continue;
    }
    const start = importSourceStartOf(rule);
    if (start === NO_SPAN) {
      continue;
    }
    const tailStart = importTailStartOf(rule);
    const before = trivia.lookup(start + rule.name.length, 'after') ?? null;
    const between = tailStart === NO_SPAN
      ? null
      : trivia.lookup(tailStart, 'before') ?? null;
    const after = trivia.lookup(importSourceEndOf(rule) - 1, 'before') ?? null;
    const hasInnerBoundary = retainTypedImportTailTrivia(rule, trivia);
    if (before !== null || between !== null || after !== null || hasInnerBoundary) {
      const prelude = rule.prelude!;
      const separators = valueLayoutOf(prelude)
        ?? (prelude.type === 'Sequence' ? SPACE_LAYOUT : EMPTY_LAYOUT);
      withValueBoundaryTrivia(prelude, separators, { before, between, after });
    }
  }
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

export function parseWith(
  grammar: LessAstGrammar,
  input: string,
  options: LessParseOptions = {}
): Stylesheet {
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError(
      'Less AST grammar is missing its public document entry.'
    );
  }
  const state: LessParseState = {
    source: input,
    mathMode: options.mathMode ?? DEFAULT_LESS_MATH_MODE
  };
  const result = run(entry, input, {
    trivia,
    state,
    rootTrivia: { select: commentTriviaLabels }
  });
  if (!result.ok) {
    throw new LessParseError(result.span.start, result.expected, lineOptions(input, result.span));
  }
  if (result.unconsumedFrom !== null) {
    /*
     * "after a complete stylesheet" has to be earned by actually having parsed
     * something. Keyed on parsed rules, not on the consumed span: leading
     * trivia advances the span end without producing a single rule, so a span
     * test calls `"\n  !broken"` a complete stylesheet, which is simply false.
     * Rules are also independent of whether a dialect's root span covers
     * trailing trivia, which is a convention the four parsers do not share.
     */
    if (isStylesheet(result.value) && result.value.rules.length > 0) {
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
  const triviaMap = createTriviaMapFromParseman(input, result.rootTrivia?.index);
  retainRootImportBoundaryTrivia(
    result.value,
    result.rootTrivia === undefined ? undefined : triviaMap
  );
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    triviaMap
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
  input: string,
  options: LessParseOptions = {}
): ISafeParseResult {
  try {
    return { document: parseWith(grammar, input, options), errors: [], warnings: [] };
  } catch (error) {
    return {
      errors: [
        parserDiagnostic({ dialect: 'Less', error, filePath, source: input })
      ],
      warnings: []
    };
  }
}
