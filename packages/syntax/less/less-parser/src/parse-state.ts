/**
 * The parseman `ctx.state` the Less grammar reads, and its one validator.
 *
 * It lives in its own module because BOTH ends need it and neither may import
 * the other: `parse-with.ts` constructs the state and names the compiled grammar
 * table only as a type, while `grammar.ts` consumes it inside reducers. A shared
 * third module keeps that a straight line rather than a cycle.
 */
import type { MathMode } from '@jesscss/core';

export interface LessParseState {
  /**
   * The input text, the trivia machinery's back-reference for slicing.
   *
   * OPTIONAL, because the grammar already treats it so — `sourceFromState`
   * returns `undefined` when it is absent and the trivia helpers fall back to
   * structural layout. A caller that only wants grammar facts (the AST-grammar
   * tests drive `run()` directly) may omit it. `mathMode` remains required on
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
