/**
 * The engine behind `color.adjust`, `color.scale` and `color.change` (and the
 * globals `adjust-color`, `scale-color`, `change-color`), to Dart Sass's
 * semantics for the legacy colour spaces.
 *
 * A call names channels by keyword. Its working space is `$space` when given,
 * else the one its channels belong to: any of `$red`/`$green`/`$blue` is rgb,
 * `$saturation`/`$lightness` is hsl, `$whiteness`/`$blackness` is hwb, and a lone
 * `$hue` is hsl. A channel from another space is an error (`color.adjust(red,
 * $red: 1, $lightness: 1%)` → `$lightness: Color space rgb doesn't have a channel
 * with this name.`). The colour is read in the working space, each named channel
 * is updated, and the result goes back to the colour's own space: an hsl colour
 * stays hsl, everything else is rgb.
 *
 * - **adjust** adds. rgb channels are clamped to 0-255 and saturation at 0;
 *   lightness, whiteness and blackness are not clamped (`color.adjust(red,
 *   $lightness: -100%)` is `hsl(0, 100%, -50%)` in Dart Sass). Alpha is clamped.
 * - **scale** moves a channel that fraction of the way to its bound and takes
 *   only a `%` within -100% and 100%; hue cannot be scaled.
 * - **change** replaces, unclamped. Only `$alpha` is range-checked.
 *
 * Only the rgb, hsl and hwb spaces exist in jess's colour model, so `$space`
 * accepts those three. Every other CSS colour space is a gap, and so is a
 * missing (`none`) channel. Channel values carry full precision; the output
 * boundary quantizes them (an out-of-gamut channel is clamped there).
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Color, DefinedFunction, Dimension, ValueGroup } from '@jesscss/core';
import { HEX, HSL, RGB, colorHsl, colorRawRgb, defineFunction, hslToRgb, isValueGroupArray, makeColorHsl, makeColorRgb } from '@jesscss/core';
import { clamp01, percentOf, wrapHue } from '../../shared/color/kernels.js';
import { degreesOf, requireColor, requireValue } from './kernels.js';

type Op = 'adjust' | 'scale' | 'change';
type Space = 'rgb' | 'hsl' | 'hwb';
type Triple = [number, number, number];

const CHANNELS = ['red', 'green', 'blue', 'hue', 'saturation', 'lightness', 'whiteness', 'blackness'] as const;
type Channel = typeof CHANNELS[number];

/** A channel's slot in its space's triple, its bound, and which ends `adjust` clamps. */
interface ChannelInfo {
  readonly space: Space | 'polar';
  readonly index: 0 | 1 | 2;
  readonly max: number;
  readonly lower: boolean;
  readonly upper: boolean;
}

const rgbChannel = (index: 0 | 1 | 2): ChannelInfo => ({ space: 'rgb', index, max: 255, lower: true, upper: true });
const INFO: Record<Channel, ChannelInfo> = {
  red: rgbChannel(0),
  green: rgbChannel(1),
  blue: rgbChannel(2),
  hue: { space: 'polar', index: 0, max: 360, lower: false, upper: false },
  saturation: { space: 'hsl', index: 1, max: 1, lower: true, upper: false },
  lightness: { space: 'hsl', index: 2, max: 1, lower: false, upper: false },
  whiteness: { space: 'hwb', index: 1, max: 1, lower: false, upper: false },
  blackness: { space: 'hwb', index: 2, max: 1, lower: false, upper: false }
};

/** The CSS colour spaces Dart Sass knows that jess's colour model does not have yet. */
const UNSUPPORTED_SPACES = new Set([
  'srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'a98-rgb', 'prophoto-rgb',
  'rec2020', 'xyz', 'xyz-d50', 'xyz-d65', 'lab', 'lch', 'oklab', 'oklch'
]);

/** The parameters, in declared order. `excess` catches a second positional argument. */
const PARAMS = [
  { name: 'color', type: 'Color' },
  { name: 'excess', type: 'any', optional: true },
  { name: 'red', type: 'any', optional: true },
  { name: 'green', type: 'any', optional: true },
  { name: 'blue', type: 'any', optional: true },
  { name: 'hue', type: 'any', optional: true },
  { name: 'saturation', type: 'any', optional: true },
  { name: 'lightness', type: 'any', optional: true },
  { name: 'whiteness', type: 'any', optional: true },
  { name: 'blackness', type: 'any', optional: true },
  { name: 'alpha', type: 'any', optional: true },
  { name: 'space', type: 'any', optional: true }
] as const;

const describe = (v: ValueGroup): string =>
  isValueGroupArray(v) ? v.map(describe).join(' ') : v.type === 'Null' ? 'null' : v.bytes;

/** The argument as a number, or Dart Sass's type error. `none` is a gap: there are no missing channels. */
function numberArg(op: Op, name: string, v: ValueGroup): Dimension {
  if (!isValueGroupArray(v) && v.type === 'Dimension') {
    return v;
  }
  if (op === 'change' && !isValueGroupArray(v) && v.type === 'Keyword' && v.bytes === 'none') {
    throw new TypeError(`$${name}: a missing ("none") channel is not supported.`);
  }
  throw new TypeError(op === 'change'
    ? `$${name}: ${describe(v)} is not a number or unquoted "none".`
    : `$${name}: ${describe(v)} is not a number.`);
}

/** `$space`: an unquoted rgb, hsl or hwb. */
function spaceArg(v: ValueGroup): Space {
  if (isValueGroupArray(v) || (v.type !== 'Keyword' && v.type !== 'Quoted')) {
    throw new TypeError(`$space: ${describe(v)} is not a string.`);
  }
  if (v.type === 'Quoted') {
    throw new TypeError(`$space: Expected ${v.bytes} to be an unquoted string.`);
  }
  const name = v.bytes.toLowerCase();
  if (name === 'rgb' || name === 'hsl' || name === 'hwb') {
    return name;
  }
  throw new TypeError(UNSUPPORTED_SPACES.has(name)
    ? `$space: The ${name} color space is not supported yet.`
    : `$space: Unknown color space "${v.bytes}".`);
}

/** The space a call's channels belong to, as Dart Sass reads it for a legacy colour; `null` for alpha only. */
function sniffSpace(given: readonly Channel[]): Space | null {
  for (const space of ['rgb', 'hsl', 'hwb'] as const) {
    if (given.some(channel => INFO[channel].space === space)) {
      return space;
    }
  }
  return given.length > 0 ? 'hsl' : null;
}

/** The colour's channels in `space`: rgb 0-255, hsl/hwb as [degrees, 0-1, 0-1]. */
function channelsIn(color: Color, space: Space): Triple {
  if (space === 'hsl') {
    return colorHsl(color);
  }
  const rgb = colorRawRgb(color);
  if (space === 'rgb') {
    return rgb;
  }
  return [colorHsl(color)[0], Math.min(...rgb) / 255, 1 - Math.max(...rgb) / 255];
}

/** hwb → rgb 0-255. A whiteness and blackness summing past 100% are scaled down to a grey. */
function hwbToRgb([h, w0, b0]: Triple): Triple {
  const sum = w0 + b0;
  const w = sum > 1 ? w0 / sum : w0;
  const factor = 1 - w - (sum > 1 ? b0 / sum : b0);
  const pure = hslToRgb(wrapHue(h), 1, 0.5);
  return [pure[0] * factor + w * 255, pure[1] * factor + w * 255, pure[2] * factor + w * 255];
}

/** An `adjust` result clamped as Dart Sass clamps it: never past a clamped bound the old value was within. */
function clampAdjusted(old: number, result: number, info: ChannelInfo): number {
  if (info.lower && result < 0) {
    return old < 0 ? Math.max(old, result) : 0;
  }
  if (info.upper && result > info.max) {
    return old > info.max ? Math.min(old, result) : info.max;
  }
  return result;
}

/** `scale`: move `old` the fraction `factor` of the way to `max` (or to 0 when negative). */
function scaled(old: number, factor: number, max: number): number {
  if (factor > 0) {
    return old >= max ? old : old + (max - old) * factor;
  }
  return factor < 0 && old > 0 ? old + old * factor : old;
}

/** A `scale` argument: a `%` within -100% and 100%, as a fraction. */
function scaleFactor(name: string, d: Dimension): number {
  if (d.unit !== '%') {
    throw new TypeError(`$${name}: Expected ${d.bytes} to have unit "%".`);
  }
  if (d.number < -100 || d.number > 100) {
    throw new RangeError(`$${name}: Expected ${d.bytes} to be within -100% and 100%.`);
  }
  return d.number / 100;
}

/**
 * An adjust/change argument in the channel's own unit. An rgb channel takes a
 * number or a `%` of 255 (`$green: 10%` is 25.5); hue converts an angle unit
 * (`60rad`) and reads any other unit as degrees; the hsl and hwb percentages
 * read the number whatever its unit (`$lightness: 10` and `10in` are `10%`).
 */
function channelAmount(name: Channel, d: Dimension): number {
  const info = INFO[name];
  if (info.space === 'rgb') {
    if (d.unit !== '' && d.unit !== '%') {
      throw new TypeError(`$${name}: Expected ${d.bytes} to have unit "%" or no units.`);
    }
    return percentOf(d, 255);
  }
  return info.space === 'polar' ? degreesOf(d) : d.number / 100;
}

/** The new alpha. `adjust` adds the bare number (Dart Sass ignores its unit); `change` reads `%` as a fraction and checks the range. */
function updateAlpha(op: Op, old: number, d: Dimension): number {
  if (op === 'scale') {
    return scaled(old, scaleFactor('alpha', d), 1);
  }
  if (op === 'adjust') {
    return clamp01(old + d.number);
  }
  const percent = d.unit === '%';
  const value = percent ? d.number / 100 : d.number;
  if (value < 0 || value > 1) {
    throw new RangeError(`$alpha: Expected ${d.bytes} to be within 0${percent ? '%' : ''} and ${percent ? '100%' : '1'}.`);
  }
  return value;
}

/** Update one channel of `triple` in place. */
function updateChannel(op: Op, triple: Triple, name: Channel, d: Dimension): void {
  const info = INFO[name];
  const old = triple[info.index];
  if (op === 'scale') {
    if (info.space === 'polar') {
      throw new TypeError(`$${name}: Channel isn't scalable.`);
    }
    triple[info.index] = scaled(old, scaleFactor(name, d), info.max);
    return;
  }
  const amount = channelAmount(name, d);
  triple[info.index] = op === 'change' ? amount : clampAdjusted(old, old + amount, info);
}

/**
 * Whether the hue of `triple` is powerless in `space` — grey in hsl, whiteness
 * and blackness filling it in hwb. Dart Sass reads that hue as missing when
 * `$space` asks for the space, and refuses to adjust it.
 */
function huePowerless(space: Space, [, a, b]: Triple): boolean {
  return space === 'hsl' ? Math.abs(a) < 1e-11 : space === 'hwb' && a + b >= 1 - 1e-11;
}

/** Build the result in the colour's own space: hsl stays hsl; rgb is hex when opaque, else `rgba()`. */
function result(color: Color, space: Space | null, triple: Triple | null, alpha: number): Color {
  const format = color.format === HSL ? HSL : alpha < 1 ? RGB : HEX;
  if (triple === null) {
    return format === HSL ? makeColorHsl(colorHsl(color), alpha, HSL) : makeColorRgb(colorRawRgb(color), alpha, format);
  }
  if (space === 'hsl') {
    return makeColorHsl([wrapHue(triple[0]), triple[1], triple[2]], alpha, format);
  }
  return makeColorRgb(space === 'hwb' ? hwbToRgb(triple) : triple, alpha, format);
}

function update(op: Op, args: readonly (ValueGroup | undefined)[]): Color {
  if (args[1] !== undefined) {
    throw new TypeError('Only one positional argument is allowed. All other arguments must be passed by name.');
  }
  const color = requireColor(requireValue(args[0]));
  const given = CHANNELS.filter((_, i) => args[i + 2] !== undefined);
  const alphaArg = args[CHANNELS.length + 2];
  const spaceValue = args[CHANNELS.length + 3];
  const space = spaceValue === undefined ? sniffSpace(given) : spaceArg(spaceValue);
  if (space === null) {
    return alphaArg === undefined ? color : result(color, null, null, updateAlpha(op, color.alpha, numberArg(op, 'alpha', alphaArg)));
  }
  const triple = channelsIn(color, space);
  for (const name of given) {
    const owner = INFO[name].space;
    if (owner !== space && !(owner === 'polar' && space !== 'rgb')) {
      throw new TypeError(`$${name}: Color space ${space} doesn't have a channel with this name.`);
    }
  }
  for (const name of given) {
    const d = numberArg(op, name, args[CHANNELS.indexOf(name) + 2]!);
    if (name === 'hue' && op === 'adjust' && spaceValue !== undefined && huePowerless(space, triple)) {
      throw new TypeError(`$hue: Because the CSS working group is still deciding on the best behavior, Sass doesn't currently support modifying missing channels (color: ${color.bytes}).`);
    }
    updateChannel(op, triple, name, d);
  }
  const alpha = alphaArg === undefined ? color.alpha : updateAlpha(op, color.alpha, numberArg(op, 'alpha', alphaArg));
  return result(color, space, triple, alpha);
}

/** A colour-update function under `name` (a `sass:color` member or its global spelling). */
export function defineColorUpdate(name: string, op: Op): DefinedFunction<typeof PARAMS> {
  return defineFunction(name, {
    params: PARAMS,
    body: (...args) => update(op, args)
  });
}
