import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { normalizeAngle } from '../shared/math/math-helper.js';
import { isDimension, NUMBER_ARG } from './css-math-args.js';
import { percentage as form } from './css-forms.generated.js';

/** `percentage(value)`: `calc(value * 100%)`, a known value's unit dropped (an angle as radians). */
export const percentage: Fn = /* @__PURE__ */ defineForm('percentage', {
  params: [NUMBER_ARG],
  form: (value: ValueGroup): FormCall => [form, isDimension(value) ? formNumber(normalizeAngle(value)) : value]
});
