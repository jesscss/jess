/**
 * Sass math module (`sass:math`).
 *
 * Members carry their MODULE name (`is-unitless`, `compatible`), which is not
 * always the deprecated GLOBAL name (`unitless`, `comparable`) — dart-sass
 * rejects `math.unitless` and `math.comparable` outright
 * (`spec/core_functions/math/{unitless,comparable}.hrx` § `error/wrong_name`).
 * The global spellings are separate `Fn`s exported from the same body modules
 * and belong to the globals index, not here.
 *
 * `min`/`max` also differ by surface: the module members RAISE on a non-number
 * or on incompatible units, while the globals fall through to plain CSS. This
 * index exports the module (strict) pair.
 *
 * Usage:
 * ```typescript
 * import { abs, unit } from '@jesscss/fns/sass/math';
 * ```
 */

export { abs, ceil, floor } from '../../shared/index.js';
export { round } from './round.js';
export { mathMin as min } from './min.js';
export { mathMax as max } from './max.js';
export { isUnitless } from './is-unitless.js';
export { compatible } from './compatible.js';
export { percentage } from './percentage.js';
export { unit } from './unit.js';
export { random } from './random.js';

/*
 * TODO: Implement remaining math module functions
 * - math.sqrt(), math.pow(), math.log(), math.hypot(), math.clamp(), math.div()
 * - the trig family: sin/cos/tan/asin/acos/atan/atan2
 * Math module variables (math.$e, math.$pi, math.$epsilon, math.$max-number, …)
 * are not functions and need a variable-export mechanism, not an entry here.
 */
