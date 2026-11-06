import { defineAdjuster } from './color-form.js';
import * as forms from './css-forms.generated.js';
import type { Fn } from '@jesscss/core/value';

/** `saturate(color, amount, method?)`: `hsl(from color h clamp(0, s + amount, 100) l)`; `relative` scales the amount by `s`. */
export const saturate: Fn = /* @__PURE__ */ defineAdjuster('saturate', forms.saturate, forms.saturateRelative, forms.saturateDeferred, forms.saturateRelativeDeferred);
