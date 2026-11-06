import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Dimension, Fn, FunctionCall, ValueGroup } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { percentOf } from '../../less/mix-form.js';
import { COLOR, EXCESS } from './color-form.js';
import { noExcess, percentAmount } from './kernels.js';

/**
 * `color.invert(color, $weight: 100%)` — mix the channel-wise inverse into the
 * original by `weight`, preserving alpha and format.
 *
 * dart-sass: `invert(#123456)` → `#edcba9`; `invert(rgba(255,0,0,0.5))` →
 * `rgba(0, 255, 255, 0.5)`; `color.invert(hsl(120,50%,50%))` →
 * `hsl(300, 50%, 50%)`; `color.invert(#f00, 50%)` → `rgb(127.5, 127.5, 127.5)`;
 * `color.invert(#123456, 20%)` → `rgb(61.8, 82.2, 102.6)`; and — pinning the
 * weight SCALE — `invert(#f00, 0.5)` → `rgb(253.725, 1.275, 1.275)`, i.e. a bare
 * `0.5` means half a percent, not half.
 *
 * `invert(50%)` (the CSS filter) is not a colour call: it fails the kind check.
 * Over one argument only the browser knows, a call not through a module may be
 * the filter (Q13).
 */
export const invert: Fn = /* @__PURE__ */ defineForm('invert', {
  params: [COLOR, { name: 'weight', type: ['Dimension', 'FunctionCall'], optional: true }, EXCESS],
  filter: true,
  form: (color: ValueGroup, weight?: Dimension | FunctionCall, excess?: ValueGroup): FormCall => {
    noExcess(excess, 2);
    if (weight === undefined) {
      return [forms.invert, color];
    }
    if (weight.type === 'Dimension') {
      percentAmount(weight);
    }
    return [forms.invertWeighted, color, percentOf(weight)];
  }
});

export default invert;
