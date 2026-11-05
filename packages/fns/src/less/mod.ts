import { defineForm, formNumber, knownUnit, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { inUnits } from './color-ctor-helper.js';
import { isDimension, plain, unitBeside } from './css-math-args.js';
import { mod as form } from './css-forms.generated.js';

/** A dividend beside a divisor it shares a unit with, which `rem()` needs, or a number beside one only the browser knows. */
const fitsDividend = (value: ValueGroup, vals: readonly ValueGroup[]): boolean => {
  const divisor = vals[1];
  return inUnits(value, [isDimension(divisor) ? divisor.unit.toLowerCase() : '']);
};

/** A divisor in the dividend's own unit, which `rem()` needs. */
const fitsDivisor = (value: ValueGroup, vals: readonly ValueGroup[]): boolean => {
  const first = vals[0];
  return inUnits(value, isDimension(first) ? [first.unit.toLowerCase()] : []);
};

/** `mod(a, b)`: `rem(a, b)`, the dividend's sign and, known, its unit. */
export const mod: Fn = /* @__PURE__ */ defineForm('mod', {
  params: [{ type: ['Dimension', 'FunctionCall'], fits: fitsDividend }, { type: ['Dimension', 'FunctionCall'], fits: fitsDivisor }],
  form: (a: ValueGroup, b: ValueGroup): FormCall =>
    [form, plain(a), isDimension(b) && knownUnit(a) !== undefined ? formNumber(b.number, unitBeside(a)) : b]
});
