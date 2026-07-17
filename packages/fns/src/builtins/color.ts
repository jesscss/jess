import type { Color, Quoted } from '@jesscss/core/value';
import { colorRgbRounded, makeColorRgb } from '@jesscss/core/value';
import { HEX } from '@jesscss/core/value';
import { parseHex } from '@jesscss/core/value';
import { namedColor } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

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
export const color: Fn = {
  name: 'color',
  params: [{ kinds: ['Color', 'Quoted'] }],
  body: (arg) => {
    if (arg.type === 'Color') {
      const c = arg as Color;
      const named = typeof c.node === 'string' ? namedColor(c.node) : undefined;
      if (named) return makeColorRgb(colorRgbRounded(c), c.alpha, HEX);
      return c;
    }
    const value = (arg as Quoted).value;
    const named = namedColor(value);
    if (named) return makeColorRgb(named.rgb, named.alpha, HEX);
    if (HEX_RE.test(value)) {
      const { rgb, alpha } = parseHex(value);
      return makeColorRgb(rgb, alpha, HEX, { node: value });
    }
    throw new Error('argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF');
  },
};
