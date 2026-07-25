import type { Fn } from '@jesscss/core/value';
import { colorHsl, defineFunction, makeColorHsl } from '@jesscss/core/value';
import { noExcess, requireColor } from './kernels.js';

/**
 * `color.grayscale(color)` — zero the saturation, keeping hue, lightness, alpha
 * and format.
 *
 * dart-sass: `grayscale(#800)` → `#444444`; `color.grayscale(hsl(120,50%,50%))`
 * → `hsl(120, 0%, 50%)`; `color.grayscale(rgba(255,0,0,0.5))` →
 * `rgba(127.5, 127.5, 127.5, 0.5)`.
 *
 * The BODY is the same computation as Less's `greyscale`, but the dispatch name
 * is `grayscale`, and a fn IS its name — so this is a Sass-owned definition, not
 * a re-export of the Less callable. `grayscale(50%)` (the CSS filter) is not a
 * colour call: it fails the kind check and re-emits verbatim.
 */
export const grayscale: Fn = defineFunction('grayscale', {
  params: [{ name: 'color', kinds: ['Color'] }, { name: 'excess', kinds: 'any', optional: true }],
  body: (c, excess) => {
    noExcess(excess, 1);
    const color = requireColor(c);
    const [h, , l] = colorHsl(color);
    return makeColorHsl([h, 0, l], color.alpha, color.format);
  }
});

export default grayscale;
