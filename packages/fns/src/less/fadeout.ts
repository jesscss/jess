import { defineAlphaAdjuster } from './color-form.js';
import * as forms from './css-forms.generated.js';
import type { Fn } from '@jesscss/core/value';

/** `fadeout(color, amount, method?)`: `rgb(from color r g b / calc(alpha - amount))`; `relative` scales the amount by `alpha`. */
export const fadeout: Fn = /* @__PURE__ */ defineAlphaAdjuster('fadeout', forms.fadeout, forms.fadeoutRelative);
