import type { Fn } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { defineAlphaAdjuster } from './color-form.js';

/**
 * `color.transparentize(color, amount)` — lower alpha by an absolute 0-1 amount.
 *
 * The mirror of `opacify`, and the same proven non-alias: a percentage is an
 * error here where Less's `fadeout` requires one.
 *
 * dart-sass: `transparentize(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.4)`;
 * `transparentize(#f00, 0.25)` → `rgba(255, 0, 0, 0.75)`;
 * `transparentize(rgba(255,0,0,0.5), 0.9)` → `rgba(255, 0, 0, 0)`;
 * `transparentize(hsl(120,50%,50%), 0.5)` → `hsla(120, 50%, 50%, 0.5)` (hsl
 * format survives; only a hex literal turns into rgb).
 */
export const transparentize: Fn = /* @__PURE__ */ defineAlphaAdjuster('transparentize', forms.fadeout);

export default transparentize;
