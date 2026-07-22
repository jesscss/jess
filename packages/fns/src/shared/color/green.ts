import { colorRgbRounded, defineFunction, makeDimension } from '@jesscss/core/value';

/** Less/Sass `green()` over the canonical value domain. */
const green = defineFunction('green', {
  params: [{ name: 'color', kinds: ['Color'] }] as const,
  body: color => makeDimension(colorRgbRounded(color)[1])
});

export default green;
