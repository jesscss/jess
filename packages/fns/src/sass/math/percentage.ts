import { defineForm, formNumber, isDimension, knownUnit, type FormCall } from '@jesscss/core/form';
import { emitValue, checkKinds, type Fn, type ValueGroup } from '@jesscss/core/value';
import { percentage as form } from '../../less/css-forms.generated.js';
import { assertNoUnits } from './units.js';

/**
 * Sass `math.percentage($number)` / the global `percentage()`.
 *
 * NOT Less's `percentage()`, which happily multiplies a UNIT'D number by 100
 * (`percentage(50px)` → `5000%`). Sass REQUIRES a unitless number.
 *
 * Verified against dart-sass 1.101.0:
 *   percentage(0.5)   → 50%
 *   percentage(2)     → 200%
 *   percentage(-0.5)  → -50%
 *   percentage(50px)  → Error: $number: Expected 50px to have no units.
 *   percentage(50%)   → Error: $number: Expected 50% to have no units.
 *
 * Over a number only the browser knows it is `calc(number * 100%)` (V38), unless
 * the number is known to have a unit.
 */
const percentage: Fn = /* @__PURE__ */ defineForm('percentage', {
  params: [{ type: ['Dimension', 'FunctionCall'], check: checkKinds, name: 'number' }],
  form: (number: ValueGroup): FormCall => {
    if (isDimension(number)) {
      return [form, formNumber(assertNoUnits(number, 'number').number)];
    }
    if ((knownUnit(number) ?? '') !== '') {
      throw new TypeError(`$number: Expected ${emitValue(number)} to have no units.`);
    }
    return [form, number];
  }
});

export { percentage };
export default percentage;
