/**
 * The parseman `ctx.state` the Less grammar reads, and its one validator.
 *
 * It lives in its own module because BOTH ends need it and neither may import
 * the other: `parse-with.ts` constructs the state and names the compiled grammar
 * table only as a type, while `grammar.ts` consumes it inside reducers. A shared
 * third module keeps that a straight line rather than a cycle.
 */
import type { MathMode } from '@jesscss/core';
import type { BareVariableRejection, FunctionScope } from '@jesscss/core/ast';
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
   * in-object slots, which measured +2% on every Less parse.
   */
  readonly document?: LessDocumentFacts;
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

/** A module directive (`@use`/`@compose`) puts the document in modern mode (ledger P36). */
export function closeAmbientFunctions(state: unknown): void {
  const scope = functionScopeOf(state);
  if (scope !== null) {
    scope.ambient = false;
  }
}
