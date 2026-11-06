import { defineForm } from '@jesscss/core/form';
import { RGB, makeColorRgb, type Fn, type ValueGroup } from '@jesscss/core/value';
import { COLOR_ARG } from './color-form.js';
import * as forms from './css-forms.generated.js';
import { WEIGHT_ARG, towardKnown, type Weight } from './mix-form.js';

/**
 * `tint(color, amount = 50%)`: `color-mix(in srgb, white amount, color)`. An
 * `amount` it cannot hold takes the relative form (docs/design/CSS-NATIVE-BUILTINS.md Q11).
 */
export const tint: Fn = /* @__PURE__ */ defineForm('tint', {
  params: [COLOR_ARG, WEIGHT_ARG],
  form: (color: ValueGroup, amount?: Weight) => towardKnown(forms.tint, color, amount, () => makeColorRgb([255, 255, 255], 1, RGB))
});
