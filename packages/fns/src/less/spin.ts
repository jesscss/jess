import { defineForm, type Dimension, type Fn, type FormCall, type ValueGroup } from '@jesscss/core';
import { channelAmount, COLOR_ARG } from './color-form.js';
import { spin as form } from './css-forms.generated.js';

/** `spin(color, amount)`: `hsl(from color calc(h + amount) s l)`. */
export const spin: Fn = defineForm('spin', {
  params: [COLOR_ARG, { type: 'Dimension' }],
  form: (color: ValueGroup, amount: Dimension): FormCall => [form, color, channelAmount(amount)]
});
