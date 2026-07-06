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
 * Function-call resolution modes — mirrors {@link UnitMode}.
 *
 * Governs an OPTIONAL (fallback) function reference — every bare/global
 * `fn(args)` — that resolves to a registered function but can't produce a value
 * (no matching signature, or the function throws), e.g. `unit(80/16)`,
 * `color("x")`.
 *
 * - `preserve`: render the call as-is (like Less v5 / an unknown CSS function)
 *   and emit a warning that a matched function couldn't be evaluated.
 * - `error`: throw the underlying function error (Less 4.x behavior).
 *
 * Unknown names (no registered function) always render as-is regardless — they
 * fall back at name resolution, never reaching this decision. Explicitly
 * imported functions are non-optional references and always error.
 */
export type FunctionMode = 'preserve' | 'error';

/**
 * Equality modes for guard/comparison semantics — the JS `==` vs `===` split.
 *
 * - `loose`: Less-compatible loose equality — cross-type operands can compare
 *   equal (like JS `==`), e.g. `2px = 2`.
 * - `strict`: type-strict equality (like JS `===`) — operands must be the same
 *   node type to compare equal.
 */
export type EqualityMode = 'loose' | 'strict';
