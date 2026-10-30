import { defineColorUpdate } from './update.js';

/**
 * `color.adjust($color, $red…, $alpha, $space)` — add to the named channels.
 * dart-sass: `color.adjust(#6b717f, $red: 15)` → `#7a717f`;
 * `color.adjust(#998099, $alpha: -0.4)` → `rgba(153, 128, 153, 0.6)`.
 */
export const adjust = defineColorUpdate('adjust', 'adjust');

/** `adjust-color()` — the global spelling of `color.adjust()`. */
export const adjustColor = defineColorUpdate('adjust-color', 'adjust');
