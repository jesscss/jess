import { defineForm, knownUnit, type FormCall } from '@jesscss/core/form';
import type { Dimension, Fn, FunctionCall, ValueGroup } from '@jesscss/core/value';
import { alphaAmount, COLOR_ARG, PERCENT_ARG, shareOf } from './color-form.js';
import { fade as form } from './css-forms.generated.js';

/** What only the browser knows of an amount as an alpha takes it: a percentage as it is, of no known type as it is (Q2), any other number its share of 100. */
function amountOf(amount: FunctionCall): ValueGroup {
  const unit = knownUnit(amount);
  return unit === undefined || unit === '%' ? amount : shareOf(amount);
}

/** `fade(color, amount)`: `rgb(from color r g b / amount)`. */
export const fade: Fn = /* @__PURE__ */ defineForm('fade', {
  params: [COLOR_ARG, PERCENT_ARG],
  form: (color: ValueGroup, amount: Dimension | FunctionCall): FormCall => [form, color, amount.type === 'Dimension' ? alphaAmount(amount) : amountOf(amount)]
});
