import { defineForm, formNumber, knownUnit, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { inUnits } from './color-ctor-helper.js';
import { isDimension, NUMBER_ARG, plain, unitBeside } from './css-math-args.js';
import { mod as form } from './css-forms.generated.js';

/** A divisor in the dividend's own unit, which `rem()` needs. */
const fitsDivisor = (value: ValueGroup, vals: readonly ValueGroup[]): boolean => {
  const first = vals[0];
  return inUnits(value, isDimension(first) ? [first.unit.toLowerCase()] : []);
};

/** `mod(a, b)`: `rem(a, b)`, the dividend's sign and, known, its unit. */
export const mod: Fn = /* @__PURE__ */ defineForm('mod', {
  params: [NUMBER_ARG, { type: ['Dimension', 'FunctionCall'], fits: fitsDivisor }],
  form: (a: ValueGroup, b: ValueGroup): FormCall =>
    [form, plain(a), isDimension(b) && knownUnit(a) !== undefined ? formNumber(b.number, unitBeside(a)) : b]
});
