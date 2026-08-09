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
   * tests drive `run()` directly) may omit it. `mathMode` is not optional: it
   * changes which AST the same bytes produce.
   */
  readonly source?: string;

  /**
   * Less's `math:` policy, a PARSE-TIME input (ledger P1). The grammar resolves
   * it per operation and writes the answer onto `Operation.mathOutsideParens`;
   * the evaluator never sees the mode.
   */
  readonly mathMode: MathMode;
}

const MATH_MODES = ['always', 'parens-division', 'parens', 'strict'] as const;

const isMathMode = (value: string): value is MathMode =>
  (MATH_MODES as readonly string[]).includes(value);

/**
 * Recover the typed state parseman hands reducers as `unknown`.
 *
 * It THROWS rather than falling back to a default, deliberately. A silent
 * fallback would make a broken threading path type-clean and invisible: every
 * `.less` file would quietly revert to `parens-division`, and only a non-default
 * `math:` would ever notice. `parseWith` always supplies this state, so reaching
 * the throw is a parser bug, not a user error.
 */
export function requireLessParseState(state: unknown): LessParseState {
  if (
    typeof state !== 'object'
    || state === null
    || !('mathMode' in state)
    || typeof state.mathMode !== 'string'
    || !isMathMode(state.mathMode)
  ) {
    throw new TypeError(
      'Less grammar ran without a `mathMode` in its parse state. '
      + '`math:` decides at parse whether an operation computes outside parens, '
      + 'so the caller must state it — `parseWith` always does.'
    );
  }
  const source = 'source' in state && typeof state.source === 'string' ? state.source : undefined;
  return source === undefined
    ? { mathMode: state.mathMode }
    : { source, mathMode: state.mathMode };
}
