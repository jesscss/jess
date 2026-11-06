import { defineForm } from '@jesscss/core/form';
import { RGB, makeColorRgb, type Fn, type ValueGroup } from '@jesscss/core/value';
import { COLOR_ARG } from './color-form.js';
import * as forms from './css-forms.generated.js';
import { WEIGHT_ARG, towardKnown, type Weight } from './mix-form.js';

/**
 * `shade(color, amount = 50%)`: `color-mix(in srgb, black amount, color)`. An
 * `amount` it cannot hold takes the relative form (docs/design/CSS-NATIVE-BUILTINS.md Q11).
 */
export const shade: Fn = /* @__PURE__ */ defineForm('shade', {
  params: [COLOR_ARG, WEIGHT_ARG],
  form: (color: ValueGroup, amount?: Weight) => towardKnown(forms.shade, color, amount, () => makeColorRgb([0, 0, 0], 1, RGB))
});
