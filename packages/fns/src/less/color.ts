import type { Fn } from '@jesscss/core';
import { colorRgbRounded, makeColorRgb, defineFunction, HEX, parseHex, namedColor } from '@jesscss/core';

const HEX_RE = /^#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3,4})$/;

/**
 * `color(c)` — parse a quoted string into a color, or normalize a color arg.
 * Byte-faithful to `less/color`:
 *  - a Color whose source spelling names a CSS color → re-emit as HEX (drop node);
 *    otherwise return it unchanged (verbatim hex passes through).
 *  - a Quoted naming a CSS color → HEX; a quoted hex string → that hex verbatim;
 *    anything else throws.
 *
 * NOTE: the legacy `@jesscss/fns` adapter THROWS on the quoted-string form here
 * (cross-boundary `instanceof` mishandles the reconstructed Quoted), so this fn is
 * validated directly against Less 4.x, not the adapter (differential asserts built-in
 * = Less 4.x for the quoted cases).
 */
export const color: Fn = defineFunction('color', {
  params: [{ type: ['Color', 'Quoted'] }],
  body: (arg) => {
    if (arg.type === 'Color') {
      const c = arg;
      const named = typeof c.src === 'string' ? namedColor(c.src) : undefined;
      if (named) {
        return makeColorRgb(colorRgbRounded(c), c.alpha, HEX);
      }
      return c;
    }
    if (arg.type !== 'Quoted') {
      throw new TypeError('Expected a color or quoted value');
    }
    const value = arg.value;
    const named = namedColor(value);
    if (named) {
      return makeColorRgb(named.rgb, named.alpha, HEX);
    }
    if (HEX_RE.test(value)) {
      const { rgb, alpha } = parseHex(value);
      return makeColorRgb(rgb, alpha, HEX, { src: value });
    }
    throw new Error('argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF');
  }
});
