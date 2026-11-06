import { aroundUnit, knownUnit } from '@jesscss/core/form';
import { declineOverUnknown, defineFunction, type Fn, type ValueGroup } from '@jesscss/core/value';
import { applyMath, requireDimension } from '../shared/math/math-helper.js';
import { isDimension, NUMBER_ARG, numberOf } from './css-math-args.js';

/** `sqrt(value)` — square root; preserves the input unit, NO angle normalization. CSS's `sqrt()` reads a number, so a known unit goes around it: `calc(sqrt(value / 1px) * 1px)`. */
export const sqrt: Fn = defineFunction('sqrt', {
  params: [{ ...NUMBER_ARG, name: 'value' }],
  body: (value: ValueGroup) => {
    const unit = isDimension(value) ? undefined : knownUnit(value);
    if (unit) {
      return aroundUnit('sqrt', [numberOf(value)], unit);
    }
    declineOverUnknown([value], [value]);
    return applyMath(Math.sqrt, null, [requireDimension(value)]);
  }
});
