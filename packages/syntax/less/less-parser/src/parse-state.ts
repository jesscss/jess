/**
 * The parseman `ctx.state` the Less grammar reads, and its one validator.
 *
 * It lives in its own module because BOTH ends need it and neither may import
 * the other: `parse-with.ts` constructs the state and names the compiled grammar
 * table only as a type, while `grammar.ts` consumes it inside reducers. A shared
 * third module keeps that a straight line rather than a cycle.
 */
import type { MathMode } from '@jesscss/core';
import type { BareVariableRejection, ForgivenSelectorItem, FunctionScope, SelectorCaptureProblem } from '@jesscss/core/ast';
import { LessBareVariableInterpolationError, type LessRecoveredError } from './parse-error.js';

/** What the reducers of one Less parse share and write ({@link LessParseState.document}). */
export interface LessDocumentFacts {
  /**
   * The document's built-in function scope (ledger P36): created by `parseWith`
   * from `moduleMode`, closed by the `@use`/`@compose` reducers, and attached to
   * every call node, so a close reaches the calls built before the directive.
   */
  readonly functions: FunctionScope;

  /**
   * The problems the grammar recovered from: a well-formed shape the dialect
   * cannot give meaning to — a `;`-list item (ledger P46), an ambiguous `not` —
   * is a located error diagnostic and the parse carries on (P45, owner
   * 2026-10-09). A run without it (the raw grammar) raises the problem instead.
   */
  readonly diagnostics: LessRecoveredError[];

  /** Each `:is()` / `:where()` item that is not a selector, for the compiler's warning (`forgivingSelectorItem`). */
  readonly forgivenSelectorItems?: ForgivenSelectorItem[];
}

export interface LessParseState extends Partial<BareVariableRejection> {
  /**
   * The input text, the trivia machinery's back-reference for slicing.
   *
   * OPTIONAL for most of the grammar — `sourceFromState` returns `undefined`
   * when it is absent and the trivia helpers fall back to structural layout — so
   * a caller that only wants grammar facts (the AST-grammar tests drive `run()`
   * directly) may omit it. A `<general-enclosed>` query group is the exception:
   * it records its source bytes (ledger N14), so an input holding one needs it. `mathMode` remains required on
   * this resolved internal shape; raw callers are normalized by
   * `requireLessParseState` below.
   */
  readonly source?: string;

  /**
   * Less's `math:` policy, a PARSE-TIME input (ledger P1). The grammar resolves
   * it per operation and writes the answer onto `Operation.mathOutsideParens`;
   * the evaluator never sees the mode.
   */
  readonly mathMode: MathMode;

  /**
   * What reducers write for the whole document, one shared object, because
   * parseman hands each state-reading reducer a shallow copy of the state and
   * only a reference carries a write back. One member, not two: the copy is
   * made per reducer call, and a fifth state member outgrows the copy's
   * in-object slots, which measured +2% on every Less parse. The one fifth
   * member there is, {@link valueStop}, exists only on the states derived
   * inside a call argument's or an operand's value run, so the document-level
   * state keeps four; it cost +0.1% AST and +1% CST in marginal instructions
   * per `benchmark.less` parse (2026-10-19), the CST share being the snapshot
   * a CST node takes of the state it was parsed under.
   */
  readonly document?: LessDocumentFacts;

  /**
   * Where a value run stops, set by what reads it and read between the run's
   * pieces: a function argument's run and an operand run stop before a
   * comparison operator, `and` or `or` (`condition`); a mixin argument's run
   * before a comparison operator only (`comparison`). A `ValueSequence` entered under a
   * stop clears it, so a value nested inside one of the run's pieces reads with
   * its own stop, never its parent's.
   */
  readonly valueStop?: ValueStop;

  /**
   * Set on the state derived inside a `selector(…)` capture (ledger P49), so a
   * selector pseudo in its argument reads a non-selector argument and records
   * it here for the capture to report (P45). Like {@link valueStop}, it exists
   * only on derived states, so the document-level state keeps four members.
   */
  readonly selectorCapture?: SelectorCaptureFacts;
}

/** What a selector pseudo inside a capture records for it ({@link LessParseState.selectorCapture}). */
export interface SelectorCaptureFacts {
  /** The first argument a pseudo in the capture could not read as a selector list. */
  problem?: SelectorCaptureProblem;
}

/** The capture being read ({@link LessParseState.selectorCapture}), or `undefined` outside one. */
export function selectorCaptureOfState(state: unknown): SelectorCaptureFacts | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the state is parseWith's LessParseState or absent; parseman types it `unknown`.
  return (state as LessParseState | undefined)?.selectorCapture;
}

/** Where a call argument's value run stops ({@link LessParseState.valueStop}). */
export type ValueStop = 'condition' | 'comparison';

/** The stop of the value run being read ({@link LessParseState.valueStop}), for the grammar's gates. */
export function valueStopOf(state: unknown): ValueStop | undefined {
  if (typeof state !== 'object' || state === null || !('valueStop' in state)) {
    return undefined;
  }
  const stop = state.valueStop;
  return stop === 'condition' || stop === 'comparison' ? stop : undefined;
}

/**
 * A bare `@name` in a query group outside a declaration value (ledger P7): the
 * shared query reducers see the group whole, and reject it through this.
 */
export function rejectBareVariable(start: number, end: number, name: string): never {
  throw new LessBareVariableInterpolationError(start, end, name);
}

/** The public Less default, shared by wrapper and raw-grammar entry points. */
export const DEFAULT_LESS_MATH_MODE: MathMode = 'parens-division';

/** Immutable raw-entry state reused by every operation in a state-free parse. */
const DEFAULT_LESS_PARSE_STATE: LessParseState = Object.freeze({
  mathMode: DEFAULT_LESS_MATH_MODE
});

const MATH_MODES = ['always', 'parens-division', 'parens', 'strict'] as const;

const isMathMode = (value: string): value is MathMode =>
  (MATH_MODES as readonly string[]).includes(value);

/**
 * Recover the typed state parseman hands reducers as `unknown`.
 *
 * Missing state uses the same public default as `parseWith`, so the exported
 * AST/CST grammars remain directly runnable. An explicitly supplied invalid
 * mode still throws instead of hiding a broken threading path.
 */
export function requireLessParseState(state: unknown): LessParseState {
  if (state === undefined) {
    return DEFAULT_LESS_PARSE_STATE;
  }
  if (typeof state !== 'object' || state === null) {
    throw new TypeError('Less grammar parse state must be an object when supplied.');
  }
  const supplied = state as { readonly source?: unknown; readonly mathMode?: unknown };
  const suppliedMathMode = supplied.mathMode;
  if (suppliedMathMode !== undefined && (
    typeof suppliedMathMode !== 'string' || !isMathMode(suppliedMathMode)
  )) {
    throw new TypeError(
      'Less grammar received an invalid `mathMode` in its parse state.'
    );
  }
  const mathMode = suppliedMathMode ?? DEFAULT_LESS_MATH_MODE;
  const source = typeof supplied.source === 'string' ? supplied.source : undefined;
  return source === undefined
    ? { mathMode }
    : { source, mathMode };
}

/** What the reducers of this parse share ({@link LessParseState.document}), or `undefined` for a raw `run()`. */
function documentOf(state: unknown): LessDocumentFacts | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the state is parseWith's LessParseState or absent; parseman types it `unknown`.
  return (state as LessParseState | undefined)?.document;
}

/**
 * The document's function scope, or `null` for a state without one (a raw
 * `run()` with no state). Read on every call node, so no re-validation of the
 * state `parseWith` itself built.
 */
export function functionScopeOf(state: unknown): FunctionScope | null {
  return documentOf(state)?.functions ?? null;
}

/** The recovered-problem sink `parseWith` gave this run, or `null` (a raw `run()`). */
export function diagnosticsOf(state: unknown): LessRecoveredError[] | null {
  return documentOf(state)?.diagnostics ?? null;
}

/** A problem the grammar recovered from (P45): kept on the document, or raised by a raw-grammar run that keeps none. */
export function reportRecovered(error: LessRecoveredError, state: unknown): void {
  const sink = diagnosticsOf(state);
  if (sink === null) {
    throw error;
  }
  sink.push(error);
}

/** A module directive (`@use`/`@compose`) puts the document in modern mode (ledger P36). */
export function closeAmbientFunctions(state: unknown): void {
  const scope = functionScopeOf(state);
  if (scope !== null) {
    scope.ambient = false;
  }
}
