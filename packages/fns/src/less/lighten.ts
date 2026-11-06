import { defineAdjuster } from './color-form.js';
import * as forms from './css-forms.generated.js';
import type { Fn } from '@jesscss/core/value';

/** `lighten(color, amount, method?)`: `hsl(from color h s clamp(0, l + amount, 100))`; `relative` scales the amount by `l`. */
export const lighten: Fn = /* @__PURE__ */ defineAdjuster('lighten', forms.lighten, forms.lightenRelative, forms.lightenDeferred, forms.lightenRelativeDeferred);
