import { defineForm, type FormCall } from '@jesscss/core/form';
import { HEX, type Dimension, type Fn, type ValueGroup } from '@jesscss/core/value';
import { fractionOf, HUE_ARG, hueOf } from './color-form.js';
import { hsv as form } from './css-forms.generated.js';

/** `hsv(h, s, v)`: `hwb(h calc((1 - s) * v * 100%) calc((1 - v) * 100%))`, resolved in hex. */
export const hsv: Fn = /* @__PURE__ */ defineForm('hsv', {
  params: [HUE_ARG, { type: 'Dimension' }, { type: 'Dimension' }],
  format: HEX,
  form: (h: ValueGroup, s: Dimension, v: Dimension): FormCall => [form, hueOf(h), fractionOf(s), fractionOf(v)]
});
