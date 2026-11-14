import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import { decimalStep, checkKinds, type Arithmetic, type Dimension, type Fn, type FunctionCall, type ValueGroup, optional } from '@jesscss/core/value';
import { fitsAny } from './color-ctor-helper.js';
import { fitsNumber, isDimension, plain, unitBeside } from './css-math-args.js';
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
    /* A literal, not `...NUMBER_ARG`: a spread keeps this pure call, and the evaluator a form runs on, in every bundle. */
    { type: ['Dimension', 'FunctionCall'], check: checkKinds, name: 'value', fits: fitsAny },
    /* @__PURE__ */ optional({ type: ['Dimension', 'FunctionCall'], check: checkKinds, name: 'precision', fits: fitsNumber })
  ],
  form: (value: ValueGroup, precision?: Dimension | FunctionCall | Arithmetic): FormCall => {
    const unit = unitBeside(value);
    if (precision === undefined || isDimension(precision)) {
      return [form, plain(value), formNumber(decimalStep(precision?.number), unit)];
    }
    return unit === '' ? [roundDeferred, value, precision] : [roundDeferredUnit, plain(value), precision, formNumber(1, unit)];
  }
});

export { round };
export default round;
