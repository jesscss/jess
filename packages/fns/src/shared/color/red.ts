import { colorRgbRounded, makeDimension, define, checkColor } from '@jesscss/core/value';

/** Less/Sass `red()` over the canonical value domain. */
const red = define('red', {
  params: [{ name: 'color', type: 'Color', check: checkColor }] as const,
  body: color => makeDimension(colorRgbRounded(color)[0])
});

export default red;
