import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { NUMBER_ARG, plain, unitBeside } from './css-math-args.js';
import { ceil as form } from './css-forms.generated.js';

/** `ceil(value)`: `round(up, value, 1)`. */
export const ceil: Fn = /* @__PURE__ */ defineForm('ceil', {
  params: [NUMBER_ARG],
  form: (value: ValueGroup): FormCall => [form, plain(value), formNumber(1, unitBeside(value))]
});
