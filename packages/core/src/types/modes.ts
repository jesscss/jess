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
