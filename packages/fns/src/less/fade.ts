import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Dimension, Fn, ValueGroup } from '@jesscss/core/value';
import { alphaAmount, COLOR_ARG } from './color-form.js';
import { fade as form } from './css-forms.generated.js';

/** `fade(color, amount)`: `rgb(from color r g b / amount)`. */
export const fade: Fn = /* @__PURE__ */ defineForm('fade', {
  params: [COLOR_ARG, { type: 'Dimension' }],
  form: (color: ValueGroup, amount: Dimension): FormCall => [form, color, alphaAmount(amount)]
});
