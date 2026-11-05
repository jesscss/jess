import { defineAdjuster } from './color-form.js';
import * as forms from './css-forms.generated.js';
import type { Fn } from '@jesscss/core/value';

/** `darken(color, amount, method?)`: `hsl(from color h s clamp(0, l - amount, 100))`; `relative` scales the amount by `l`. */
export const darken: Fn = defineAdjuster('darken', forms.darken, forms.darkenRelative);
