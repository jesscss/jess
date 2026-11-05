import { defineForm, formNumber, knownUnit, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG, plain, unitBeside } from './css-math-args.js';
import { mod as form } from './css-forms.generated.js';

/** `mod(a, b)`: `rem(a, b)`, the dividend's sign and, known, its unit. */
export const mod: Fn = /* @__PURE__ */ defineForm('mod', {
  params: [NUMBER_ARG, { type: ['Dimension', 'FunctionCall'], formSlot: 'first' }],
  form: (a: ValueGroup, b: ValueGroup): FormCall =>
    [form, plain(a), isDimension(b) && knownUnit(a) !== undefined ? formNumber(b.number, unitBeside(a)) : b]
});
