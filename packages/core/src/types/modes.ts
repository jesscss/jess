/**
 * Math processing modes. The runtime list is what option validation checks
 * values against.
 *
 * Kept in `@jesscss/core` to avoid cyclic workspace dependencies with `styles-config`.
 */
export const MATH_MODES = ['always', 'parens-division', 'parens', 'strict'] as const;
export type MathMode = typeof MATH_MODES[number];

/**
 * Unit conversion modes.
 *
 * - `loose`: Convert units in some cases, coerce when units don't match
 * - `preserve`: Create calc() when units don't match or are mis-used
 * - `strict`: Throw errors when units are mis-used
 *
 * Kept in `@jesscss/core` to avoid cyclic workspace dependencies with `styles-config`.
 */
export const UNIT_MODES = ['loose', 'preserve', 'strict'] as const;
export type UnitMode = typeof UNIT_MODES[number];

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

/**
 * Less module modes — whether a `.less` document has an ambient built-in
 * function namespace (ledger P36).
 *
 * - `auto`: decided per document. A document that writes `@use` or `@compose`
 *   (either spelling) is in modern mode (`@export` will join them when Less
 *   implements it); any other document is legacy, and the Less built-ins compute
 *   as the author asked.
 * - `modern`: every `.less` document is in modern mode. A Less built-in reaches
 *   it only by import; an unimported call keeps its name and call shape, and
 *   its arguments are evaluated like any other value.
 *
 * Kept in `@jesscss/core` to avoid cyclic workspace dependencies with `styles-config`.
 */
export const MODULE_MODES = ['auto', 'modern'] as const;
export type ModuleMode = typeof MODULE_MODES[number];
