import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Dimension, Fn, FunctionCall, ValueGroup } from '@jesscss/core/value';
import { alphaAmount, COLOR_ARG, deferredPercent, PERCENT_ARG } from './color-form.js';
import { fade as form } from './css-forms.generated.js';

/** `fade(color, amount)`: `rgb(from color r g b / amount)`. An alpha takes what only the browser knows as it is. */
export const fade: Fn = /* @__PURE__ */ defineForm('fade', {
  params: [COLOR_ARG, PERCENT_ARG],
  form: (color: ValueGroup, amount: Dimension | FunctionCall): FormCall => [form, color, amount.type === 'Dimension' ? alphaAmount(amount) : deferredPercent('fade', amount)]
});
