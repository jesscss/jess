import { colorRgbRounded, makeDimension, define, checkColor } from '@jesscss/core/value';

/** Less/Sass `green()` over the canonical value domain. */
const green = define('green', {
  params: [{ name: 'color', type: 'Color', check: checkColor }] as const,
  body: color => makeDimension(colorRgbRounded(color)[1])
});

export default green;
