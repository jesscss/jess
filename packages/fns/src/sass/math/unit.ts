import { defineFunction, makeQuoted } from '@jesscss/core';
import { unitText } from './units.js';

/**
 * Sass `math.unit($number)` / the global `unit()`.
 *
 * NOT Less's `unit()`. Less STRIPS the unit and returns a number
 * (`unit(10px)` → `10`) and takes a second argument to RE-UNIT
 * (`unit(10px, em)` → `10em`). Sass returns the unit itself as a QUOTED STRING
 * and allows exactly one argument.
 *
 * Verified against dart-sass 1.101.0:
 *   unit(10px)            → "px"
 *   unit(10)              → ""
 *   unit(10%)             → "%"
 *   unit(0.5turn)         → "turn"
 *   unit(10px * 2px)      → "px*px"
 *   math.unit(math.div(10px, 1s))       → "px/s"
 *   math.unit(math.div(1, 1px))         → "px^-1"
 *   math.unit(math.div(1, 1px * 1s))    → "(px*s)^-1"
 *   math.unit(math.div(1px, 1s * 1em))  → "px/(s*em)"
 *   unit(10px, em)        → Error: Only 1 argument allowed, but 2 were passed.
 */
const unit = defineFunction('unit', {
  params: [{ name: 'number', type: 'Dimension' }] as const,
  body: number => makeQuoted(unitText(number), '"', false)
});

export { unit };
export default unit;
