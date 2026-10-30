import { defineColorUpdate } from './update.js';

/**
 * `color.change($color, $red…, $alpha, $space)` — replace the named channels.
 * dart-sass: `color.change(#6b717f, $red: 100)` → `#64717f`;
 * `color.change(red, $alpha: 1.001)` → `$alpha: Expected 1.001 to be within 0 and 1.`
 */
export const change = defineColorUpdate('change', 'change');

/** `change-color()` — the global spelling of `color.change()`. */
export const changeColor = defineColorUpdate('change-color', 'change');
