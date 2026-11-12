import { defineForm, type FormCall } from '@jesscss/core/form';
import { RGB, type Dimension, type Fn, type FunctionCall, type ValueGroup } from '@jesscss/core/value';
import { ALPHA_ARG, alphaOf, HUE_ARG, hueOf, PERCENT_ARG, whiteBlack } from './color-form.js';
import { hsva as form } from './css-forms.generated.js';

/** `hsva(h, s, v, a)`: `hwb(h w b / a)` with white `(1 - s)v` and black `1 - v`, resolved in `rgb()`. */
export const hsva: Fn = /* @__PURE__ */ defineForm('hsva', {
  params: [HUE_ARG, PERCENT_ARG, PERCENT_ARG, ALPHA_ARG],
  format: RGB,
  form: (h: ValueGroup, s: Dimension | FunctionCall, v: Dimension | FunctionCall, a: Dimension | FunctionCall): FormCall => [form, hueOf(h), ...whiteBlack(s, v), alphaOf(a)]
});
