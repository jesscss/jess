import { defineForm, type FormCall } from '@jesscss/core/form';
import { makeDimension, RGB, type Dimension, type Fn, type ValueGroup } from '@jesscss/core/value';
import { fractionOf, HUE_ARG, hueOf } from './color-form.js';
import { clamp01 } from './color-ctor-helper.js';
import { hsva as form } from './css-forms.generated.js';

/** `hsva(h, s, v, a)`: `hwb(h calc((1 - s) * v * 100%) calc((1 - v) * 100%) / a)`, resolved in `rgb()`. */
export const hsva: Fn = /* @__PURE__ */ defineForm('hsva', {
  params: [HUE_ARG, { type: 'Dimension' }, { type: 'Dimension' }, { type: 'Dimension' }],
  format: RGB,
  form: (h: ValueGroup, s: Dimension, v: Dimension, a: Dimension): FormCall => [form, hueOf(h), fractionOf(s), fractionOf(v), makeDimension(clamp01(fractionOf(a).number))]
});
