import { colorRgbRounded, defineFunction, makeDimension } from '@jesscss/core';

/** Less/Sass `green()` over the canonical value domain. */
const green = defineFunction('green', {
  params: [{ name: 'color', type: 'Color' }] as const,
  body: color => makeDimension(colorRgbRounded(color)[1])
});

export default green;
