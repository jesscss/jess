/**
 * The `parse()`/`safeParse()` bodies, shared by the two AST entries.
 *
 * The grammar table arrives as an argument rather than being chosen from a
 * boolean inside this module: Node does not tree-shake, so a module that names
 * both compiled tables executes both at load time. Each entry imports exactly
 * the one table it parses with, and this module imports none.
 */
import { buildLineIndex, offsetToLineCol, run, type RunResult } from 'parseman/run';
import type { Span } from 'parseman';
import type { ISafeParseResult, MathMode, ModuleMode, TriviaMap } from '@jesscss/core';
import { DEFAULT_LESS_MATH_MODE, diagnosticsOf, rejectBareVariable, type LessDocumentFacts, type LessParseState } from './parse-state.js';
/*
 * `parserDiagnostic` comes from the narrow `./diagnostics` entry, not the root:
 * the root entry pulls the evaluator, functions, and legacy tree runtime onto
 * this module's static import graph, and Node executes all of it for a caller
 * that only wants `parse`.
 */
import { parserDiagnostic } from '@jesscss/core/diagnostics';
import {
  MATH_MODES,
  MODULE_MODES,
  NO_SPAN,
  createTriviaMapFromParseman,
  importSourceEndOf,
  importSourceStartOf,
  importTailStartOf,
  isValueSlotArray,
  recoveredInTree,
  sourceStartOf,
  valueLayoutOf,
  withForgivenSelectorItems,
  withSourceSpan,
  withTriviaMap,
  withValueBoundaryTrivia,
  type AtRuleStatement,
  type ForgivenSelectorItem,
  type Stylesheet
} from '@jesscss/core/ast';
import type { lessGrammar } from './grammar/ast.js';
import { LessParseError, type LessRecoveredError } from './parse-error.js';
import { commentTriviaLabels } from './trivia-labels.js';
import { sourceFromState } from './trivia-layout.js';

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

  /**
   * Whether the document's Less built-ins are ambient (ledger P36). The grammar
   * sees every `@use`/`@compose` it builds; under `auto` that is what puts a
   * document in modern mode, and `modern` puts every document there. The
   * answer is one object per document, shared by every call node.
   */
  readonly moduleMode?: ModuleMode;
}

declare const lessRunState: unique symbol;

/**
 * The run state {@link createLessParseState} builds, to pass as a raw `run()`'s
 * `state`. It is opaque: its fields belong to the grammar, not to the API.
 */
export interface LessRunState {
  readonly [lessRunState]: true;
}

/** The fields behind {@link LessRunState}: what the grammar and the parse read back. */
interface CheckedRunState extends LessParseState {
  readonly source: string;
  readonly mathMode: MathMode;
  readonly document: LessDocumentFacts & { readonly forgivenSelectorItems: ForgivenSelectorItem[] };
}

/*
 * A plain object, not a class instance: every withCtx spreads it, and a class
 * instance root measured slower on the Bootstrap parse.
 */
function checkedRunState(input: string, options: LessParseOptions): CheckedRunState {
  const moduleMode = requireMode('moduleMode', options.moduleMode, MODULE_MODES, 'auto');
  return {
    source: input,
    mathMode: requireMode('mathMode', options.mathMode, MATH_MODES, DEFAULT_LESS_MATH_MODE),
    document: { functions: { ambient: moduleMode === 'auto' }, diagnostics: [], forgivenSelectorItems: [] },
    rejectBareVariable
  };
}

/**
 * Build the state for a run over `input`: the state `parse()` and `safeParse()`
 * build, and the only supported way to build one for a raw `run()` of the
 * `@jesscss/less-parser/grammar/*` tables. The options are checked here, once:
 * `undefined` or `null` reads the default, and any other value outside the
 * documented modes is a caller error, thrown as a `TypeError`. The grammar
 * trusts the state after that, so a hand-built state is unchecked and an
 * invalid mode in it is undefined behaviour.
 *
 * The run records each problem the grammar recovered from on the state, where
 * {@link recoveredProblemsOf} reads them back.
 */
export function createLessParseState(input: string, options?: LessParseOptions): LessRunState;
/* The one place the checked state becomes the opaque type: the signature above is the public one. */
export function createLessParseState(input: string, options: LessParseOptions = {}): CheckedRunState | LessRunState {
  return checkedRunState(input, options);
}

/**
 * The problems a raw run with this state recovered from, given what `run()`
 * returned: exactly the ones `safeParse()` reports for the same run and
 * `parse()` throws the first of. A run that stopped short (a failure, input
 * left unconsumed, or a parseman recovery error) reports that failure instead,
 * so it has none. A completed run has each report that reaches its tree, once,
 * in source order; none from an attempt the run abandoned.
 */
export function recoveredProblemsOf(state: LessRunState, result: RunResult): readonly LessRecoveredError[] {
  return runFailure(result, sourceFromState(state) ?? '') === null ? recoveredIn(result.value, diagnosticsOf(state) ?? []) : [];
}

function requireMode<const M extends string>(
  option: string,
  value: unknown,
  modes: readonly M[],
  fallback: M
): M {
  if (value === undefined || value === null) {
    return fallback;
  }
  const mode = modes.find(candidate => candidate === value);
  if (mode === undefined) {
    const shown = typeof value === 'string' ? `'${value}'` : String(value);
    throw new TypeError(
      `invalid ${option} option: ${shown} (expected one of ${modes.map(candidate => `'${candidate}'`).join(', ')})`
    );
  }
  return mode;
}

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

/**
 * The document, and the problems the grammar recovered from (ledger P46): each
 * a located error diagnostic the parse carried on past (P45, owner
 * 2026-10-09), in source order, one per item.
 */
interface LessParsed {
  readonly document: Stylesheet;
  readonly recovered: readonly LessRecoveredError[];
}

/**
 * `parse()`: the document, or the first problem in source order. The pipeline
 * reads {@link safeParseWith}, which keeps the document and reports them all.
 */
export function parseWith(
  grammar: LessAstGrammar,
  input: string,
  options: LessParseOptions = {}
): Stylesheet {
  const { document, recovered } = parseRecovering(grammar, input, checkedRunState(input, options));
  if (recovered[0] !== undefined) {
    throw recovered[0];
  }
  return document;
}

function parseRecovering(
  grammar: LessAstGrammar,
  input: string,
  state: CheckedRunState
): LessParsed {
  const entry = grammar.Stylesheet;
  const trivia = grammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError(
      'Less AST grammar is missing its public document entry.'
    );
  }
  const { diagnostics, forgivenSelectorItems } = state.document;
  const result = run(entry, input, {
    trivia,
    state,
    rootTrivia: { select: commentTriviaLabels }
  });

  const failure = runFailure(result, input);
  if (failure !== null) {
    throw failure;
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
  /* Read before the document is decorated, so a raw run's `recoveredProblemsOf` walks the same tree. */
  const recovered = recoveredIn(result.value, diagnostics);
  const triviaMap = createTriviaMapFromParseman(input, result.rootTrivia?.index);
  retainRootImportBoundaryTrivia(
    result.value,
    result.rootTrivia === undefined ? undefined : triviaMap
  );
  const document = withForgivenSelectorItems(withTriviaMap(
    withSourceSpan(result.value, result.span),
    triviaMap
  ), forgivenSelectorItems);
  return { document, recovered };
}

/**
 * The failure `parse()` throws for a run that stopped short, or `null` when the
 * run completed: no recovery error, a value, and no input left unconsumed.
 */
function runFailure(result: RunResult, input: string): LessParseError | null {
  /*
   * A recovery error outranks the two branches below, exactly as it does in the
   * CSS parser this one mirrors: it localises the FIRST real problem, where
   * `result.span` only reports where the run gave up and the `unconsumedFrom`
   * branches carry no expected set at all. An `expect()` recovers in place, so
   * without this the run finishes "successfully" over input a rule refused.
   */
  const recoveryError = result.errors[0];
  if (recoveryError !== undefined) {
    return new LessParseError(
      recoveryError.span.start,
      recoveryError.expected,
      lineOptions(input, recoveryError.span)
    );
  }
  if (!result.ok) {
    return new LessParseError(result.span.start, result.expected, lineOptions(input, result.span));
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
      return new LessParseError(result.unconsumedFrom, [], {
        message: 'Unexpected Less input after a complete stylesheet.',
        reason:
          'The parser consumed a complete Less stylesheet before this token, so the remaining text is not part of any rule, declaration, or at-rule.',
        fix: 'Remove the extra input or wrap it in valid Less syntax.',
        ...positionAt(input, result.unconsumedFrom)
      });
    }
    return new LessParseError(result.unconsumedFrom, [], {
      message: 'Unexpected Less syntax.',
      reason:
        'The parser could not match this token as the start of a Less rule, declaration, or at-rule.',
      fix: 'Remove the token or rewrite it as valid Less syntax.',
      ...positionAt(input, result.unconsumedFrom)
    });
  }
  return null;
}

/** The reports that reach a completed run's tree, one per item, ordered by where it is written. */
function recoveredIn(tree: unknown, reported: readonly LessRecoveredError[]): readonly LessRecoveredError[] {
  const diagnostics = recoveredInTree(typeof tree === 'object' && tree !== null ? tree : {}, reported);
  if (diagnostics.length < 2) {
    return diagnostics;
  }
  const byItem = new Map<string, LessRecoveredError>();
  for (const error of diagnostics) {
    byItem.set(`${error.offset}:${error.endOffset}:${error.message}`, error);
  }
  return [...byItem.values()].sort((a, b) => a.offset - b.offset);
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
  const state = checkedRunState(input, options);
  try {
    const { document, recovered } = parseRecovering(grammar, input, state);
    return {
      document,
      errors: recovered.map(error => parserDiagnostic({ dialect: 'Less', error, filePath, source: input })),
      warnings: []
    };
  } catch (error) {
    return {
      errors: [
        parserDiagnostic({ dialect: 'Less', error, filePath, source: input })
      ],
      warnings: []
    };
  }
}
