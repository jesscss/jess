import type { Fn } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { defineAlphaAdjuster } from './color-form.js';

/**
 * `color.opacify(color, amount)` — raise alpha by an absolute 0-1 amount.
 *
 * This is the PROVEN non-alias: Less's `fadein` takes a percentage (`10%` means
 * +0.1), Sass takes a 0-1 fraction and REJECTS a percentage —
 * `opacify(rgba(255,0,0,.5), 10%)` → `$amount: Expected 10% to be within 0 and 1`
 * — so re-exporting the Less body here would error on every correct call site.
 *
 * dart-sass: `opacify(rgba(255,0,0,0.5), 0.1)` → `rgba(255, 0, 0, 0.6)`;
 * `opacify(rgba(255,0,0,0.5), 0.9)` → `red` (clamped to 1).
 */
export const opacify: Fn = /* @__PURE__ */ defineAlphaAdjuster('opacify', forms.fadein);

export default opacify;
