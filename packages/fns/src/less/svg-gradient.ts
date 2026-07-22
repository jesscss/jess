import { colorRgbRounded, defineFunction, groupItems, isValueGroupArray, makeKeyword } from '@jesscss/core/value';
import type { Color, Fn, ValueGroup, ValueObj } from '@jesscss/core/value';

/**
 * Less `svg-gradient()` — build an inline SVG gradient data URI. Stops are
 * structural value groups (`Color [Dimension]`), never recovered from rendered
 * bytes. A malformed call throws so the shared call boundary owns preservation.
 */
const svgGradient: Fn = defineFunction('svg-gradient', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (value, ctx): ValueObj => {
    const items = groupItems(value);
    if (items.length < 2) {
      throw new TypeError(STOPS_ERROR);
    }
    const direction = ctx.stringify(items[0]!);

    let stops: readonly ValueGroup[];
    if (items.length === 2) {
      stops = groupItems(items[1]);
      if (stops.length < 2) {
        throw new TypeError(STOPS_ERROR);
      }
    } else {
      stops = items.slice(1);
    }

    const shape = DIRECTIONS.get(direction);
    if (!shape) {
      throw new TypeError(DIRECTION_ERROR);
    }

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><${shape.type}Gradient id="g" ${shape.direction}>`;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (stop === undefined) {
        throw new TypeError(STOPS_ERROR);
      }
      const parts = groupItems(stop);
      const color = parts[0];
      const position = parts[1];
      const isEnd = i === 0 || i + 1 === stops.length;
      if (color === undefined || isValueGroupArray(color) || color.type !== 'Color') {
        throw new TypeError(STOPS_ERROR);
      }
      if (position === undefined) {
        if (!isEnd) {
          throw new TypeError(STOPS_ERROR);
        }
      } else if (isValueGroupArray(position) || position.type !== 'Dimension') {
        throw new TypeError(STOPS_ERROR);
      }
      const offset = position?.bytes ?? (i === 0 ? '0%' : '100%');
      const opacity = color.alpha < 1 ? ` stop-opacity="${color.alpha}"` : '';
      svg += `<stop offset="${offset}" stop-color="${colorHex(color)}"${opacity}/>`;
    }
    svg += `</${shape.type}Gradient><rect ${shape.rect} fill="url(#g)" /></svg>`;
    return makeKeyword(`url('data:image/svg+xml,${encodeURIComponent(svg)}')`);
  }
});

function colorHex(color: Color): string {
  const [red, green, blue] = colorRgbRounded(color);
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

function hex(value: number): string {
  const encoded = value.toString(16);
  return encoded.length === 1 ? `0${encoded}` : encoded;
}

const DIRECTIONS = new Map<string, { readonly type: 'linear' | 'radial'; readonly direction: string; readonly rect: string }>([
  ['to bottom', { type: 'linear', direction: 'x1="0%" y1="0%" x2="0%" y2="100%"', rect: 'x="0" y="0" width="1" height="1"' }],
  ['to right', { type: 'linear', direction: 'x1="0%" y1="0%" x2="100%" y2="0%"', rect: 'x="0" y="0" width="1" height="1"' }],
  ['to bottom right', { type: 'linear', direction: 'x1="0%" y1="0%" x2="100%" y2="100%"', rect: 'x="0" y="0" width="1" height="1"' }],
  ['to top right', { type: 'linear', direction: 'x1="0%" y1="100%" x2="100%" y2="0%"', rect: 'x="0" y="0" width="1" height="1"' }],
  ['ellipse', { type: 'radial', direction: 'cx="50%" cy="50%" r="75%"', rect: 'x="-50" y="-50" width="101" height="101"' }],
  ['ellipse at center', { type: 'radial', direction: 'cx="50%" cy="50%" r="75%"', rect: 'x="-50" y="-50" width="101" height="101"' }]
]);

const DIRECTION_ERROR = 'svg-gradient direction must be \'to bottom\', \'to right\', \'to bottom right\', \'to top right\' or \'ellipse at center\'';
const STOPS_ERROR = 'svg-gradient expects direction, start_color [start_position], [color position,]..., end_color [end_position] or direction, color list';

export default svgGradient;
