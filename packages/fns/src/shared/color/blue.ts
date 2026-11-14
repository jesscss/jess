import { colorRgbRounded, makeDimension, define, checkColor } from '@jesscss/core/value';

/** Less/Sass `blue()` over the canonical value domain. */
const blue = define('blue', {
  params: [{ name: 'color', type: 'Color', check: checkColor }] as const,
  body: color => makeDimension(colorRgbRounded(color)[2])
});

export default blue;
