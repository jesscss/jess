import { defineFunction, makeDimension } from '@jesscss/core';

/** Less/Sass `alpha()` over the canonical value domain. */
const alpha = defineFunction('alpha', {
  params: [{ name: 'color', type: 'Color' }] as const,
  body: color => makeDimension(Math.min(Math.max(color.alpha, 0), 1))
});

export default alpha;
