import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import { decimalStep, type Dimension, type Fn, type FunctionCall, type ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG, plain, unitBeside } from './css-math-args.js';
import { round as form, roundDeferred, roundDeferredUnit } from './css-forms.generated.js';

/**
 * Less `round(value, precision = 0)`: `calc(sign(value) * round(abs(value), step))`,
 * the second argument being DECIMAL PLACES, and the step the power of ten they are.
 * Half away from zero (V8) is what `sign()` and `abs()` give.
 *
 * Not shared with Sass: `math.round`'s second argument is a step to round to the
 * nearest multiple of, so `round(1.234, 2)` is `1.23` in Less and `2` in Sass.
 */
const round: Fn = /* @__PURE__ */ defineForm('round', {
  params: [
    { name: 'value', ...NUMBER_ARG },
    { name: 'precision', ...NUMBER_ARG, optional: true }
  ],
  form: (value: ValueGroup, precision?: Dimension | FunctionCall): FormCall => {
    const unit = unitBeside(value);
    if (precision?.type !== 'FunctionCall') {
      return [form, plain(value), formNumber(decimalStep(precision?.number), unit)];
    }
    return unit === '' ? [roundDeferred, value, precision] : [roundDeferredUnit, plain(value), precision, formNumber(1, unit)];
  }
});

export { round };
export default round;
