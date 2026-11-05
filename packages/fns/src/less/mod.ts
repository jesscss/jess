import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG, plain } from './css-math-args.js';
import { mod as form } from './css-forms.generated.js';

/** `mod(a, b)`: `rem(a, b)`, the dividend's sign and, known, its unit. */
export const mod: Fn = /* @__PURE__ */ defineForm('mod', {
  params: [NUMBER_ARG, { ...NUMBER_ARG, formSlot: 'first' }],
  form: (a: ValueGroup, b: ValueGroup): FormCall =>
    [form, plain(a), isDimension(a) && isDimension(b) ? formNumber(b.number, a.unit) : b]
});
