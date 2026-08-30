import { colorRgbRounded, defineFunction, makeDimension } from '@jesscss/core';

/** Less/Sass `blue()` over the canonical value domain. */
const blue = defineFunction('blue', {
  params: [{ name: 'color', type: 'Color' }] as const,
  body: color => makeDimension(colorRgbRounded(color)[2])
});

export default blue;
