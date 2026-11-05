import { defineForm, type FormCall } from '@jesscss/core/form';
import { HEX, type Dimension, type Fn, type ValueGroup } from '@jesscss/core/value';
import { HUE_ARG, hueOf, whiteBlack } from './color-form.js';
import { hsv as form } from './css-forms.generated.js';

/** `hsv(h, s, v)`: `hwb(h w b)` with white `(1 - s)v` and black `1 - v`, resolved in hex. */
export const hsv: Fn = /* @__PURE__ */ defineForm('hsv', {
  params: [HUE_ARG, { type: 'Dimension' }, { type: 'Dimension' }],
  format: HEX,
  form: (h: ValueGroup, s: Dimension, v: Dimension): FormCall => [form, hueOf(h), ...whiteBlack(s, v)]
});
