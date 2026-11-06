import type { Fn } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { defineAdjuster } from './color-form.js';

/**
 * `color.lighten(color, amount)` — raise the hsl lightness, clamped to 100%.
 *
 * dart-sass: `lighten(#800, 10%)` → `#bb0000`; `lighten(hsl(0,0%,90%), 20%)` →
 * `hsl(0, 0%, 100%)`; `lighten(#fff, 50%)` → `white`. Two arguments only — Less's
 * third `relative` argument is `Only 2 arguments allowed, but 3 were passed`.
 */
export const lighten: Fn = /* @__PURE__ */ defineAdjuster('lighten', forms.lighten, forms.lightenDeferred);

export default lighten;
