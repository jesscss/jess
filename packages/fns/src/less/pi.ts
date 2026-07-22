import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `pi()` — the mathematical constant π as a unitless `Dimension`.
 */
const pi = defineFunction('pi', {
  params: [] as const,
  body: () => makeDimension(Math.PI)
});

export { pi };
export default pi;
