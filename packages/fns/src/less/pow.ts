import { aroundUnit, knownUnit } from '@jesscss/core/form';
import { declineOverUnknown, define, type Fn, type ValueGroup } from '@jesscss/core/value';
import { applyMath, requireDimension } from '../shared/math/math-helper.js';
import { isDimension, NUMBER_ARG, numberOf } from './css-math-args.js';

/** `pow(x, y)` — `x^y`, keeping `x`'s unit. No angle normalization. CSS's `pow()` reads numbers, so a known unit goes around it: `calc(pow(x / 1px, y) * 1px)`. */
export const pow: Fn = /* @__PURE__ */ define('pow', {
  params: [NUMBER_ARG, NUMBER_ARG],
  body: (x: ValueGroup, y: ValueGroup) => {
    const unit = knownUnit(x);
    const exponent = knownUnit(y);
    if ((!isDimension(x) && unit !== undefined) || (!isDimension(y) && exponent !== undefined)) {
      if (unit) {
        return aroundUnit('pow', [numberOf(x), numberOf(y)], unit);
      }
      declineOverUnknown([x, y], [x, numberOf(y)], Boolean(exponent));
    }
    declineOverUnknown([x, y], [x, y]);
    return applyMath(Math.pow, null, [requireDimension(x), requireDimension(y)]);
  }
});
