import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Less `acos(value)` — canonical value-domain callable, returned in radians. */
const acos = defineFunction('acos', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: (value) => {
    return makeDimension(Math.acos(value.number), 'rad');
  }
});

export { acos };
export default acos;
