import type { Fn } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { defineAdjuster } from './color-form.js';

/**
 * `color.darken(color, amount)` — lower the hsl lightness, clamped to 0%.
 *
 * dart-sass: `darken(#800, 10%)` → `#550000`; `darken(#800, 100%)` → `black`;
 * `darken(#000, 50%)` → `black`. Two arguments only (see `lighten`).
 */
export const darken: Fn = /* @__PURE__ */ defineAdjuster('darken', forms.darken);

export default darken;
