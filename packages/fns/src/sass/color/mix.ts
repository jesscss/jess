import { defineForm } from '@jesscss/core/form';
import { RGB, checkKinds, type Fn, type ValueGroup, optional } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { mixForm, type Weight } from '../../less/mix-form.js';
import { EXCESS } from './color-form.js';
import { noExcess, weightAmount } from './kernels.js';

/**
 * `color.mix(color1, color2, $weight: 50%)`: `color-mix(in srgb, …)`, each colour
 * counting by weight × opacity, as CSS blends them (Q1). Sass's own formula
 * differs when the alphas differ, so `mix/alpha.hrx` and `mix/both_weights.hrx`
 * cases that do are recorded exclusions in `color-sass-spec.test.ts`.
 *
 * `$weight` is a percentage: `mix/units.hrx` accepts a unitless `50` (and even
 * `50px`) as 50%, with a deprecation warning rather than an error.
 *
 * The `$method` colour-space argument (`mix(#f00, #00f, 50%, oklch)`) needs a
 * colour-space model jess does not have, so a fourth argument fails.
 */
export const mix: Fn = /* @__PURE__ */ defineForm('mix', {
  params: [
    { type: ['Color', 'FunctionCall'], check: checkKinds, name: 'color1' },
    { type: ['Color', 'FunctionCall'], check: checkKinds, name: 'color2' },
    /* @__PURE__ */ optional({ type: ['Dimension', 'FunctionCall'], check: checkKinds, name: 'weight' }),
    EXCESS
  ],
  format: RGB,
  form: (a: ValueGroup, b: ValueGroup, weight?: Weight, excess?: ValueGroup) => {
    noExcess(excess, 3);
    if (weight === undefined) {
      return [forms.average, a, b];
    }
    if (weight.type === 'Dimension') {
      weightAmount(weight);
    }
    return mixForm(a, b, weight);
  }
});

export default mix;
