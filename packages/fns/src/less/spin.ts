import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Dimension, Fn, ValueGroup } from '@jesscss/core/value';
import { channelAmount, COLOR_ARG } from './color-form.js';
import { spin as form } from './css-forms.generated.js';

/** `spin(color, amount)`: `hsl(from color calc(h + amount) s l)`. */
export const spin: Fn = /* @__PURE__ */ defineForm('spin', {
  params: [COLOR_ARG, { type: 'Dimension' }],
  form: (color: ValueGroup, amount: Dimension): FormCall => [form, color, channelAmount(amount)]
});
