import { defineColorUpdate } from './update.js';

/**
 * `color.scale($color, $red…, $alpha, $space)` — move the named channels a
 * percentage of the way to their bounds. dart-sass:
 * `color.scale(#998099, $alpha: -40%)` → `rgba(153, 128, 153, 0.6)`;
 * `color.scale(red, $red: 15)` → `$red: Expected 15 to have unit "%".`
 */
export const scale = defineColorUpdate('scale', 'scale');

/** `scale-color()` — the global spelling of `color.scale()`. */
export const scaleColor = defineColorUpdate('scale-color', 'scale');
