/**
 * Math processing modes.
 *
 * Kept in `@jesscss/core` to avoid cyclic workspace dependencies with `styles-config`.
 */
export type MathMode = 'always' | 'parens-division' | 'parens' | 'strict';

/**
 * Unit conversion modes.
 *
 * - `loose`: Convert units in some cases, coerce when units don't match
 * - `preserve`: Create calc() when units don't match or are mis-used
 * - `strict`: Throw errors when units are mis-used
 *
 * Kept in `@jesscss/core` to avoid cyclic workspace dependencies with `styles-config`.
 */
export type UnitMode = 'loose' | 'preserve' | 'strict';

/**
 * Function-call resolution modes — compiler input to the shared evaluator.
 *
 * Governs an OPTIONAL (fallback) function reference — every bare/global
 * `fn(args)` — that resolves to a registered function but can't produce a value
 * (no matching signature, or the function throws), e.g. `unit(80/16)`,
 * `color("x")`.
 *
 * - `preserve`: render the call as-is (like an unknown CSS function)
 *   and emit a warning that a matched function couldn't be evaluated.
 * - `error`: throw the underlying function error.
 *
 * Unknown names (no registered function) always render as-is regardless — they
 * fall back at name resolution, never reaching this decision. Explicitly
 * imported functions are non-optional references and always error.
 */
export type FunctionMode = 'preserve' | 'error';
