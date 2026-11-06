import { defineAlphaAdjuster } from './color-form.js';
import * as forms from './css-forms.generated.js';
import type { Fn } from '@jesscss/core/value';

/** `fadein(color, amount, method?)`: `rgb(from color r g b / calc(alpha + amount))`; `relative` scales the amount by `alpha`. */
export const fadein: Fn = /* @__PURE__ */ defineAlphaAdjuster('fadein', forms.fadein, forms.fadeinRelative, forms.fadeinDeferred, forms.fadeinRelativeDeferred);
