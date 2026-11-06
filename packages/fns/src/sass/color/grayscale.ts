import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { greyscale } from '../../less/css-forms.generated.js';
import { COLOR, EXCESS } from './color-form.js';
import { noExcess } from './kernels.js';

/**
 * `color.grayscale(color)` — zero the saturation, keeping hue, lightness, alpha
 * and format.
 *
 * dart-sass: `grayscale(#800)` → `#444444`; `color.grayscale(hsl(120,50%,50%))`
 * → `hsl(120, 0%, 50%)`; `color.grayscale(rgba(255,0,0,0.5))` →
 * `rgba(127.5, 127.5, 127.5, 0.5)`.
 *
 * The BODY is the same computation as Less's `greyscale`, but the dispatch name
 * is `grayscale`, and a fn IS its name — so this is a Sass-owned definition, not
 * a re-export of the Less callable. `grayscale(50%)` (the CSS filter) is not a
 * colour call: it fails the kind check. Over one argument only the browser knows,
 * a call not through a module may be the filter (Q13).
 */
export const grayscale: Fn = /* @__PURE__ */ defineForm('grayscale', {
  params: [COLOR, EXCESS],
  filter: true,
  form: (color: ValueGroup, excess?: ValueGroup): FormCall => {
    noExcess(excess, 1);
    return [greyscale, color];
  }
});

export default grayscale;
