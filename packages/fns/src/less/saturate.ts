import { defineAdjuster } from './color-form.js';
import * as forms from './css-forms.generated.js';
import type { Fn } from '@jesscss/core';

/** `saturate(color, amount, method?)`: `hsl(from color h clamp(0, s + amount, 100) l)`; `relative` scales the amount by `s`. */
export const saturate: Fn = defineAdjuster('saturate', forms.saturate, forms.saturateRelative);
