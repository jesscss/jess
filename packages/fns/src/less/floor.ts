import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { NUMBER_ARG, plain, unitBeside } from './css-math-args.js';
import { floor as form } from './css-forms.generated.js';

/** `floor(value)`: `round(down, value, 1)`. */
export const floor: Fn = /* @__PURE__ */ defineForm('floor', {
  params: [NUMBER_ARG],
  form: (value: ValueGroup): FormCall => [form, plain(value), formNumber(1, unitBeside(value))]
});
