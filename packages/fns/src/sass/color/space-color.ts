/**
 * A Sass colour as Dart Sass 1.101.7 models one: a CSS Color 4 space, its three
 * channels and an alpha, any of them missing (`null`). This reads one from a
 * value and writes one back.
 *
 * A legacy colour (`#abc`, `red`, `rgb()`, `hsl()`) is jess's sRGB `Color`, in
 * the rgb space or, written or made in hsl, the hsl one. A colour a colour-space
 * function made carries its space and channels ({@link Color.space}). A
 * `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` or `hwb()` written in a
 * stylesheet stays the call it was written as (ledger V1/F5) and is read here,
 * where a colour function needs its channels, as Dart Sass reads it when it
 * parses it (`lib/src/functions/color.dart` `_parseChannels`).
 *
 * Full precision throughout (ledger V5).
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Color, Dimension, FunctionCall, ValueGroup } from '@jesscss/core/value';
import {
  colorHsl, colorRawRgb, convertValue, HEX, HSL, isValueGroupArray, makeColorHsl, makeColorInSpace, makeColorRgb, namedColor, RGB
} from '@jesscss/core/value';
import { colorSpaceNamed, convertSpace, spaceInfo, type ChannelInfo, type ColorSpaceName, type SpaceChannels } from './space.js';

export interface SpaceColor {
  readonly space: ColorSpaceName;
  readonly channels: SpaceChannels;
}

/** How Dart Sass writes a value in an error: its CSS text. */
export const describe = (v: ValueGroup): string =>
  isValueGroupArray(v) ? v.map(describe).join(' ') : v.type === 'Null' ? 'null' : v.bytes;

/** Whether the value is a Sass string: a colour's name (`red`) is a colour. */
const isString = (v: ValueGroup): boolean =>
  !isValueGroupArray(v) && (v.type === 'Quoted' || v.type === 'FunctionCall' || (v.type === 'Keyword' && namedColor(v.text) === undefined));

/** The text of an unquoted string argument (`undefined` for `null`), or Dart Sass's error for what else it is. */
function unquoted(name: string, v: ValueGroup): string | undefined {
  if (!isValueGroupArray(v) && v.type === 'Null') {
    return undefined;
  }
  if (!isString(v) || isValueGroupArray(v)) {
    return fail(`$${name}: ${describe(v)} is not a string.`);
  }
  return v.type === 'Quoted' ? fail(`$${name}: Expected ${v.bytes} to be an unquoted string.`) : v.bytes;
}

function fail(message: string): never {
  throw new TypeError(message);
}

/** `$space`: an unquoted colour-space name, or `undefined` for `null`. */
export function spaceArg(v: ValueGroup | undefined): ColorSpaceName | undefined {
  const name = v === undefined ? undefined : unquoted('space', v);
  return name === undefined ? undefined : colorSpaceNamed(name) ?? fail(`$space: Unknown color space "${name}".`);
}

/** `$channel`: a quoted channel name. */
export function channelArg(v: ValueGroup): string {
  if (!isString(v) || isValueGroupArray(v)) {
    return fail(`$channel: ${describe(v)} is not a string.`);
  }
  return v.type === 'Quoted' ? v.value : fail(`$channel: Expected ${v.bytes} to be a quoted string.`);
}

/** The value as a Sass colour, or Dart Sass's `$<name>: … is not a color.` */
export function readColor(v: ValueGroup, name = 'color'): SpaceColor {
  const notColor = (): never => fail(`$${name}: ${describe(v)} is not a color.`);
  if (isValueGroupArray(v)) {
    return notColor();
  }
  if (v.type === 'Keyword') {
    const named = namedColor(v.text);
    return named === undefined ? notColor() : { space: 'rgb', channels: [...named.rgb, named.alpha] };
  }
  if (v.type === 'Color') {
    return colorChannels(v);
  }
  return v.type === 'FunctionCall' ? callColor(v) ?? notColor() : notColor();
}

function colorChannels(c: Color): SpaceColor {
  if (c.space !== undefined && c.channels !== undefined) {
    return { space: colorSpaceNamed(c.space) ?? 'srgb', channels: c.channels };
  }
  if (c.format === HSL) {
    const [h, s, l] = colorHsl(c);
    return { space: 'hsl', channels: [h, s * 100, l * 100, c.alpha] };
  }
  const [r, g, b] = colorRawRgb(c);
  return { space: 'rgb', channels: [r, g, b, c.alpha] };
}

const CALL_SPACES = new Set(['lab', 'lch', 'oklab', 'oklch', 'hwb']);

/*
 * A written colour call's channels. The arguments are one space-separated
 * sequence, its last item a `/` list when an alpha is given; `color()` leads
 * with the space's name. A call that is not a colour Sass would compute (a
 * `var()`, a `from` relative colour, too few channels) is `undefined`.
 */
function callColor(call: FunctionCall): SpaceColor | undefined {
  const fn = call.name.toLowerCase();
  let args = call.args;
  if (!isValueGroupArray(args) && args.type === 'List' && args.sep === ',' && args.value.length === 1) {
    args = args.value[0]!;
  }
  const items: ValueGroup[] = isValueGroupArray(args) ? [...args] : [args];
  let alpha: ValueGroup | undefined;
  const last = items[items.length - 1];
  if (last !== undefined && !isValueGroupArray(last) && last.type === 'List' && last.sep === '/' && last.value.length === 2) {
    items[items.length - 1] = last.value[0]!;
    alpha = last.value[1];
  }
  let space = CALL_SPACES.has(fn) ? colorSpaceNamed(fn) : undefined;
  if (fn === 'color') {
    const lead = items.shift();
    const named = lead !== undefined && !isValueGroupArray(lead) && lead.type === 'Keyword' ? colorSpaceNamed(lead.text) : undefined;
    space = named !== undefined && !spaceInfo(named).legacy && named !== 'lab' && named !== 'lch' && named !== 'oklab' && named !== 'oklch' ? named : undefined;
  }
  if (space === undefined || items.length !== 3) {
    return undefined;
  }
  const info = spaceInfo(space).channels;
  const channels: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const value = channelValue(items[i]!, info[i]!, space);
    if (value === undefined) {
      return undefined;
    }
    channels.push(value);
  }
  const a = alpha === undefined ? 1 : channelValue(alpha, ALPHA, space);
  if (a === undefined) {
    return undefined;
  }
  const c0 = channels[0]!;
  let c1 = channels[1]!;
  let c2 = channels[2]!;
  if (space === 'hwb' && c1 !== null && c2 !== null && c1 + c2 > 100) {
    [c1, c2] = [c1 / (c1 + c2) * 100, c2 / (c1 + c2) * 100];
  }
  return { space, channels: [c0, c1, c2, a] };
}

const ALPHA: ChannelInfo = { name: 'alpha', polar: false, min: 0, max: 1, requiresPercent: false, lowerClamped: true, upperClamped: true, unit: '' };

/*
 * One written channel, as Dart Sass's `_channelFromValue` reads it: `none` is
 * missing; a hue is in degrees, on [0, 360); a linear channel takes a number or
 * a percentage of its `max`, clamped at a clamped end; an hwb whiteness or
 * blackness must be a percentage. `undefined` for anything else.
 */
function channelValue(v: ValueGroup, channel: ChannelInfo, space: ColorSpaceName): number | null | undefined {
  if (isValueGroupArray(v)) {
    return undefined;
  }
  if (v.type === 'Keyword' && v.text.toLowerCase() === 'none') {
    return null;
  }
  if (v.type !== 'Dimension') {
    return undefined;
  }
  if (channel.polar) {
    const degrees = v.unit === '' ? v.number : convertValue(v.number, v.unit, 'deg');
    return ((degrees % 360) + 360) % 360;
  }
  if (space === 'hwb' && channel !== ALPHA) {
    return v.unit === '%' ? v.number : fail(`$${channel.name}: Expected ${v.bytes} to have unit "%".`);
  }
  const value = percentageOrUnitless(v, channel.max, channel.name);
  if (Number.isNaN(value)) {
    return channel.lowerClamped ? channel.min : value;
  }
  return Math.min(Math.max(value, channel.lowerClamped ? channel.min : -Infinity), channel.upperClamped ? channel.max : Infinity);
}

/** Dart Sass's `_percentageOrUnitless`: a number as is, a percentage of `max`. */
export function percentageOrUnitless(d: Dimension, max: number, name: string): number {
  if (d.unit === '') {
    return d.number;
  }
  return d.unit === '%' ? max * d.number / 100 : fail(`$${name}: Expected ${d.bytes} to have unit "%" or no units.`);
}

/*
 * A Sass colour as a value. An rgb or hsl colour with no channel missing is
 * jess's legacy colour, written as one; any other is a colour in its space,
 * which writes its CSS Color 4 function (a hwb one writes as rgb does).
 */
export function writeColor({ space, channels }: SpaceColor): Color {
  const [c0, c1, c2, alpha] = channels;
  const legacy = c0 !== null && c1 !== null && c2 !== null && alpha !== null;
  if (space === 'rgb' && legacy) {
    const whole = [c0, c1, c2].every(c => Number.isInteger(c) && c >= 0 && c <= 255);
    return makeColorRgb([c0, c1, c2], alpha, whole && alpha === 1 ? HEX : RGB);
  }
  if (space === 'hsl' && legacy) {
    return makeColorHsl([c0, c1 / 100, c2 / 100], alpha, HSL);
  }
  const rgb = convertSpace(space, channels, 'rgb', false);
  return makeColorInSpace(space, channels, [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0], HEX);
}
