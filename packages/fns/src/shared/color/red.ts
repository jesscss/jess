import { colorRgbRounded, defineFunction, makeDimension } from '@jesscss/core/value';

/** Less/Sass `red()` over the canonical value domain. */
const red = defineFunction('red', {
  params: [{ name: 'color', kinds: ['Color'] }] as const,
  body: color => makeDimension(colorRgbRounded(color)[0])
});

export default red;
