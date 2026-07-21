import { colorRgbRounded, makeKeyword } from '@jesscss/core/value';
import { coerceListItems } from './list-helper.js';
import type { Color, Fn, ValueObj } from '@jesscss/core/value';

/**
 * `svg-gradient(direction, stops…)` — build an inline `data:image/svg+xml,…` URL
 * for a linear/radial gradient (Less 4.x `functions/svg.js`). Byte-faithful:
 *   - direction selects the SVG gradient geometry (`to bottom`/`to right`/
 *     `to bottom right`/`to top right`/`ellipse[ at center]`);
 *   - each stop is `color [position]` (a lone color at the ends defaults to
 *     `0%`/`100%`); the SVG is `encodeURIComponent`-escaped and wrapped as
 *     `url('data:image/svg+xml,…')`.
 *
 * VALUE-DOMAIN CARRIER: legacy returns a `URL(Quoted)` node; the value substrate
 * has no url kind, so the verbatim `url('…')` bytes ride a `Keyword` (the same
 * verbatim-emit carrier `e()`/`min`/`max` use). A malformed call is left
 * UNEVALUATED (emitted verbatim) rather than thrown, so a bad arg never regresses
 * the whole document — matching the unknown-fn fallback.
 */
export const svgGradient: Fn = {
  name: 'svg-gradient',
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx): ValueObj => {
    const items = list.items;
    if (items.length < 2) throw new TypeError(STOPS_ERROR);
    const direction = ctx.stringify(items[0]!);

    // Stops: the multi-arg form spreads `color pos` groups after the direction;
    // the 2-arg form passes a single comma-list of stops as the second arg.
    let stops: ValueObj[];
    if (items.length === 2) {
      stops = coerceListItems(items[1]);
      if (stops.length < 2) throw new TypeError(STOPS_ERROR);
    } else {
      stops = items.slice(1);
    }

    let gradientType = 'linear';
    let rectangleDimension = 'x="0" y="0" width="1" height="1"';
    let dirSvg: string;
    switch (direction) {
      case 'to bottom': dirSvg = 'x1="0%" y1="0%" x2="0%" y2="100%"'; break;
      case 'to right': dirSvg = 'x1="0%" y1="0%" x2="100%" y2="0%"'; break;
      case 'to bottom right': dirSvg = 'x1="0%" y1="0%" x2="100%" y2="100%"'; break;
      case 'to top right': dirSvg = 'x1="0%" y1="100%" x2="100%" y2="0%"'; break;
      case 'ellipse':
      case 'ellipse at center':
        gradientType = 'radial';
        dirSvg = 'cx="50%" cy="50%" r="75%"';
        rectangleDimension = 'x="-50" y="-50" width="101" height="101"';
        break;
      default: throw new TypeError(DIRECTION_ERROR);
    }

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><${gradientType}Gradient id="g" ${dirSvg}>`;
    for (let i = 0; i < stops.length; i++) {
      const parts = coerceListItems(stops[i]);
      const color = parts[0];
      const position = parts[1];
      const isEnd = i === 0 || i + 1 === stops.length;
      if (!color || color.type !== 'Color' || (!(isEnd && position === undefined) && (!position || position.type !== 'Dimension'))) {
        throw new TypeError(STOPS_ERROR);
      }
      const positionValue = position ? position.bytes : i === 0 ? '0%' : '100%';
      const alpha = (color as Color).alpha;
      const opacity = alpha < 1 ? ` stop-opacity="${alpha}"` : '';
      svg += `<stop offset="${positionValue}" stop-color="${toRGB(color as Color)}"${opacity}/>`;
    }
    svg += `</${gradientType}Gradient><rect ${rectangleDimension} fill="url(#g)" /></svg>`;

    const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    return makeKeyword(`url('${uri}')`);
  },
};

/** A color's `#rrggbb` (rgb only, no alpha) — legacy `Color.toRGB()`. */
function toRGB(c: Color): string {
  const [r, g, b] = colorRgbRounded(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

function hex2(v: number): string {
  const h = v.toString(16);
  return h.length === 1 ? `0${h}` : h;
}

const DIRECTION_ERROR = "svg-gradient direction must be 'to bottom', 'to right', 'to bottom right', 'to top right' or 'ellipse at center'";
const STOPS_ERROR = 'svg-gradient expects direction, start_color [start_position], [color position,]..., end_color [end_position] or direction, color list';
