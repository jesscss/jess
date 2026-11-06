import { defineForm, type FormCall } from '@jesscss/core/form';
import { HEX, type Dimension, type Fn, type FunctionCall, type ValueGroup } from '@jesscss/core/value';
import { HUE_ARG, hueOf, PERCENT_ARG, whiteBlack } from './color-form.js';
import { hsv as form } from './css-forms.generated.js';

/** `hsv(h, s, v)`: `hwb(h w b)` with white `(1 - s)v` and black `1 - v`, resolved in hex. */
export const hsv: Fn = /* @__PURE__ */ defineForm('hsv', {
  params: [HUE_ARG, PERCENT_ARG, PERCENT_ARG],
  format: HEX,
  form: (h: ValueGroup, s: Dimension | FunctionCall, v: Dimension | FunctionCall): FormCall => [form, hueOf(h), ...whiteBlack('hsv', s, v)]
});
