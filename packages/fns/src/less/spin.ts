import { asNumber, defineForm, type FormCall } from '@jesscss/core/form';
import type { Dimension, Fn, FunctionCall, ValueGroup } from '@jesscss/core/value';
import { channelAmount, COLOR_ARG, PERCENT_ARG } from './color-form.js';
import { spin as form } from './css-forms.generated.js';

/** `spin(color, amount)`: `hsl(from color calc(h + amount) s l)`, an amount only the browser knows taken to hold a number of degrees (Q2). */
export const spin: Fn = /* @__PURE__ */ defineForm('spin', {
  params: [COLOR_ARG, PERCENT_ARG],
  form: (color: ValueGroup, amount: Dimension | FunctionCall): FormCall => [form, color, amount.type === 'Dimension' ? channelAmount(amount) : asNumber(amount)]
});
