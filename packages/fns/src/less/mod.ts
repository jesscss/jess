import { asNumber, defineForm, formMath, formNumber, knownUnit, type FormCall } from '@jesscss/core/form';
import { foldUnit, makeDimension, type Fn, type ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG, plain } from './css-math-args.js';
import { mod as form } from './css-forms.generated.js';

/** A divisor in the dividend's unit, which `rem()` needs: its number in that unit, as the known path reads it. */
function divisorBeside(a: ValueGroup, b: ValueGroup): ValueGroup {
  const unit = knownUnit(a);
  const own = knownUnit(b);
  if (unit === undefined || own === undefined || foldUnit(own) === foldUnit(unit)) {
    return isDimension(b) && unit !== undefined ? formNumber(b.number, unit) : b;
  }
  return isDimension(b) ? formNumber(b.number, unit) : unit === '' ? asNumber(b, own) : formMath('*', asNumber(b, own), makeDimension(1, unit));
}

/** `mod(a, b)`: `rem(a, b)`, the dividend's sign and, known, its unit. */
export const mod: Fn = /* @__PURE__ */ defineForm('mod', {
  params: [NUMBER_ARG, NUMBER_ARG],
  form: (a: ValueGroup, b: ValueGroup): FormCall => [form, plain(a), divisorBeside(a, b)]
});
