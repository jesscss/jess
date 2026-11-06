import type { Fn } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { defineAlphaAdjuster } from './color-form.js';

/**
 * `color.fade-out(color, amount)` — the `transparentize` computation under Sass's
 * other name for it. NOT Less's `fadeout` (0-1 fraction, percentage rejected).
 *
 * dart-sass: `fade-out(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.4)`;
 * `fade-out(rgba(255,0,0,0.5), 10%)` → `$amount: Expected 10% to be within 0 and 1`.
 */
export const fadeOut: Fn = /* @__PURE__ */ defineAlphaAdjuster('fade-out', forms.fadeout);

export default fadeOut;
