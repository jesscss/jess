import type { Fn } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { defineAdjuster } from './color-form.js';

/**
 * `color.desaturate(color, amount)` — lower the hsl saturation, clamped to 0%.
 *
 * dart-sass: `desaturate(#888, 10%)` → `#888888`;
 * `desaturate(hsl(120,50%,50%), 20%)` → `hsl(120, 30%, 50%)`;
 * `desaturate(#f00, 200%)` → `$amount: Expected 200% to be within 0% and 100%`.
 */
export const desaturate: Fn = /* @__PURE__ */ defineAdjuster('desaturate', forms.desaturate, forms.desaturateDeferred);

export default desaturate;
