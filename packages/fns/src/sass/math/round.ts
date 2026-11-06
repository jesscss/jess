import { defineForm, formNumber, isDimension, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { round as form } from '../../less/css-forms.generated.js';
import { unitBeside } from '../../less/css-math-args.js';

/**
 * Sass `math.round($number)` / the global `round()`.
 *
 * NOT the same function as Less's `round`, which is why this is dialect-owned:
 * Less's second argument is DECIMAL PRECISION (`round(1.234, 2)` → `1.23`),
 * while Sass follows CSS `round()`, whose second argument is the STEP to round
 * to the nearest multiple of (`round(1.234, 2)` → `2`).
 *
 * Its form is `calc(sign(number) * round(abs(number), step))`, so ties break away
 * from zero as in dart-sass and Less (`math.round(-2.5)` → `-3`, V8).
 */
const round: Fn = /* @__PURE__ */ defineForm('round', {
  params: [
    { name: 'number', type: ['Dimension', 'FunctionCall'] },
    { name: 'step', type: ['Dimension', 'FunctionCall'], optional: true }
  ],
  form: (number: ValueGroup, step?: ValueGroup): FormCall => {
    const unit = unitBeside(number) || (step === undefined ? '' : unitBeside(step));
    const known = isDimension(number) ? formNumber(number.number, unit) : number;
    return [form, known, step === undefined ? formNumber(1, unit) : isDimension(step) ? formNumber(step.number, step.unit || unit) : step];
  }
});

export { round };
export default round;
