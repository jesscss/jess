import { defineForm, knownUnit, type FormCall } from '@jesscss/core/form';
import { type Dimension, type Fn, type FunctionCall, type ValueGroup } from '@jesscss/core/value';
import { alphaAmount, COLOR_ARG, PERCENT_ARG, shareOf } from './color-form.js';
import { fade as form } from './css-forms.generated.js';

/**
 * What only the browser knows of an amount as an alpha takes it: a percentage as
 * it is, anything else, of no known type too, its share of 100 (Q2).
 */
function amountOf(amount: FunctionCall): ValueGroup {
  return knownUnit(amount) === '%' ? amount : shareOf(amount);
}

/** `fade(color, amount)`: `rgb(from color r g b / amount)`. */
export const fade: Fn = /* @__PURE__ */ defineForm('fade', {
  params: [COLOR_ARG, PERCENT_ARG],
  form: (color: ValueGroup, amount: Dimension | FunctionCall): FormCall => [form, color, amount.type === 'Dimension' ? alphaAmount(amount) : amountOf(amount)]
});
