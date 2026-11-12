import { defineFunction, makeDimension } from '@jesscss/core/value';
import { fitsNumber } from './css-math-args.js';

/** Less `acos(value)` — canonical value-domain callable, returned in radians. */
const acos = /* @__PURE__ */ defineFunction('acos', {
  cssFunction: true,
  params: [{ name: 'value', type: 'Dimension', fits: fitsNumber }] as const,
  body: (value) => {
    return makeDimension(Math.acos(value.number), 'rad');
  }
});

export { acos };
export default acos;
