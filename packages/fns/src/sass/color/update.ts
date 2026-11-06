/**
 * `color.adjust`, `color.scale` and `color.change` (and the globals
 * `adjust-color`, `scale-color`, `change-color`) in the legacy colour spaces, as
 * one relative colour whose named channels are its slots: what is not named
 * holds its keyword, so the form says only what was asked for.
 *
 * A call names channels by keyword. Its working space is `$space` when given,
 * else the one its channels belong to: any of `$red`/`$green`/`$blue` is rgb,
 * `$saturation`/`$lightness` is hsl, `$whiteness`/`$blackness` is hwb, and a lone
 * `$hue` is hsl. A channel from another space is an error (`color.adjust(red,
 * $red: 1, $lightness: 1%)` → `$lightness: Color space rgb doesn't have a channel
 * with this name.`).
 *
 * - **adjust** adds. rgb channels, saturation and lightness are clamped to their
 *   range; hue, whiteness and blackness are not. Alpha is clamped by the colour.
 * - **scale** moves a channel that fraction of the way to its bound and takes
 *   only a `%` within -100% and 100%. The sign picks the formula, so a percentage
 *   only the browser knows has no form; hue cannot be scaled.
 * - **change** replaces, unclamped. Only `$alpha` is range-checked.
 *
 * Only the rgb, hsl and hwb spaces exist in jess's colour model, so `$space`
 * accepts those three. Every other CSS colour space is a gap, and so is a
 * missing (`none`) channel.
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import { asNumber, channelForm, defineForm, knownUnit, type FormCall, type FormSlot } from '@jesscss/core/form';
import type { Color, Dimension, Fn, FunctionCall, ValueGroup } from '@jesscss/core/value';
import { colorHsl, colorRawRgb, isUnknownNumber, isValueGroupArray, makeDimension, TOLERANCE } from '@jesscss/core/value';
import * as forms from '../../less/css-forms.generated.js';
import { percentOf } from '../../shared/color/kernels.js';
import { COLOR } from './color-form.js';
import { degreesOf } from './kernels.js';

type Op = 'adjust' | 'scale' | 'change';
type Space = 'rgb' | 'hsl' | 'hwb';
type Triple = [number, number, number];

const CHANNELS = ['red', 'green', 'blue', 'hue', 'saturation', 'lightness', 'whiteness', 'blackness'] as const;
type Channel = typeof CHANNELS[number];

/** A channel's slot in its space's form, the keyword it reads there, its range, and whether `adjust` clamps it. */
interface ChannelInfo {
  readonly space: Space | 'polar';
  readonly slot: 0 | 1 | 2;
  readonly keyword: string;
  readonly max: number;
  readonly clamped: boolean;
}

const INFO: Record<Channel, ChannelInfo> = {
  red: { space: 'rgb', slot: 0, keyword: 'r', max: 255, clamped: true },
  green: { space: 'rgb', slot: 1, keyword: 'g', max: 255, clamped: true },
  blue: { space: 'rgb', slot: 2, keyword: 'b', max: 255, clamped: true },
  hue: { space: 'polar', slot: 0, keyword: 'h', max: 360, clamped: false },
  saturation: { space: 'hsl', slot: 1, keyword: 's', max: 100, clamped: true },
  lightness: { space: 'hsl', slot: 2, keyword: 'l', max: 100, clamped: true },
  whiteness: { space: 'hwb', slot: 1, keyword: 'w', max: 100, clamped: false },
  blackness: { space: 'hwb', slot: 2, keyword: 'b', max: 100, clamped: false }
};

/** Each space's form, with and without an alpha of its own, and the channels it reads. */
const SPACES: Record<Space, { readonly form: FormCall[0]; readonly alpha: FormCall[0]; readonly keywords: readonly [string, string, string] }> = {
  rgb: { form: forms.rgbSlots, alpha: forms.rgbSlotsAlpha, keywords: ['r', 'g', 'b'] },
  hsl: { form: forms.hslSlots, alpha: forms.hslSlotsAlpha, keywords: ['h', 's', 'l'] },
  hwb: { form: forms.hwbSlots, alpha: forms.hwbSlotsAlpha, keywords: ['h', 'w', 'b'] }
};

/** The CSS colour spaces Dart Sass knows that jess's colour model does not have yet. */
const UNSUPPORTED_SPACES = new Set([
  'srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'a98-rgb', 'prophoto-rgb',
  'rec2020', 'xyz', 'xyz-d50', 'xyz-d65', 'lab', 'lch', 'oklab', 'oklch'
]);

/** A colour in one of those spaces: `$lightness` there is its own channel, and hsl's here. */
const MODERN_COLORS = new Set(['lab', 'lch', 'oklab', 'oklch', 'color']);

/** The parameters, in declared order. `excess` catches a second positional argument. */
const PARAMS = [
  COLOR,
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

/** The argument as a number, one only the browser knows or not, or Dart Sass's type error. `none` is a gap: there are no missing channels. */
function numberArg(op: Op, name: string, v: ValueGroup): Dimension | FunctionCall {
  if (!isValueGroupArray(v) && (v.type === 'Dimension' || (v.type === 'FunctionCall' && isUnknownNumber(v)))) {
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
  if (isValueGroupArray(v) || (v.type !== 'Keyword' && v.type !== 'FunctionCall' && v.type !== 'Quoted')) {
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
  return info.space === 'polar' ? degreesOf(d) : d.number;
}

/** A `scale` of `factor` in a channel: which way it moves picks the formula. */
function scaledSlot(keyword: string, factor: number, max: number): FormSlot {
  return factor > 0
    ? channelForm(forms.channelUp, keyword, makeDimension(max), makeDimension(factor))
    : factor < 0 ? channelForm(forms.channelDown, keyword, makeDimension(factor)) : keyword;
}

/** A number only the browser knows in a channel: on a 0–100 channel it is taken to hold a percentage (Q2). */
function unknownSlot(op: Op, name: Channel, amount: FunctionCall): FormSlot {
  const { space, keyword, clamped, max } = INFO[name];
  if (op === 'scale') {
    throw new TypeError(`$${name}: ${amount.bytes} is not known, and its sign picks how a channel scales.`);
  }
  const unit = knownUnit(amount);
  if (space === 'rgb' && unit === '%') {
    throw new TypeError(`$${name}: ${amount.bytes} has no form as a percentage of an rgb channel.`);
  }
  const deferred = space !== 'rgb' && space !== 'polar' && (unit === undefined || unit === '%');
  const n = deferred ? amount : asNumber(amount, unit);
  if (op === 'change') {
    return deferred ? channelForm(forms.channelSetDeferred, n) : n;
  }
  if (clamped) {
    return channelForm(deferred ? forms.channelClampedDeferred : forms.channelClamped, keyword, n, makeDimension(max));
  }
  return channelForm(deferred ? forms.channelMovedDeferred : forms.channelMoved, keyword, n);
}

/** What a channel's slot holds. */
function channelSlot(op: Op, name: Channel, amount: Dimension | FunctionCall): FormSlot {
  if (amount.type !== 'Dimension') {
    return unknownSlot(op, name, amount);
  }
  const { space, keyword, clamped, max } = INFO[name];
  if (op === 'scale') {
    if (space === 'polar') {
      throw new TypeError(`$${name}: Channel isn't scalable.`);
    }
    return scaledSlot(keyword, scaleFactor(name, amount), max);
  }
  const n = makeDimension(channelAmount(name, amount));
  if (op === 'change') {
    return n;
  }
  return clamped ? channelForm(forms.channelClamped, keyword, n, makeDimension(max)) : channelForm(forms.channelMoved, keyword, n);
}

/** What the alpha's slot holds. `adjust` adds the bare number (Dart Sass ignores its unit); `change` reads `%` as a fraction and checks the range. */
function alphaSlot(op: Op, amount: Dimension | FunctionCall): FormSlot {
  if (amount.type !== 'Dimension') {
    if (op === 'scale') {
      throw new TypeError(`$alpha: ${amount.bytes} is not known, and its sign picks how a channel scales.`);
    }
    return op === 'adjust' ? channelForm(forms.channelMoved, 'alpha', amount) : amount;
  }
  if (op === 'scale') {
    return scaledSlot('alpha', scaleFactor('alpha', amount), 1);
  }
  if (op === 'adjust') {
    return channelForm(forms.channelMoved, 'alpha', makeDimension(amount.number));
  }
  const percent = amount.unit === '%';
  const value = percent ? amount.number / 100 : amount.number;
  if (value < 0 || value > 1) {
    throw new RangeError(`$alpha: Expected ${amount.bytes} to be within 0${percent ? '%' : ''} and ${percent ? '100%' : '1'}.`);
  }
  return makeDimension(value);
}

/**
 * Whether the hue of a known colour is powerless in `space` — grey in hsl,
 * whiteness and blackness filling it in hwb. Dart Sass reads that hue as missing
 * when `$space` asks for the space, and refuses to adjust it.
 */
function huePowerless(space: Space, color: Color): boolean {
  if (space === 'hsl') {
    return Math.abs(colorHsl(color)[1]) < 1e-11;
  }
  const rgb = colorRawRgb(color);
  const max = Math.max(...rgb);
  return space === 'hwb' && max - Math.min(...rgb) <= max * TOLERANCE;
}

function update(op: Op, args: readonly (ValueGroup | undefined)[]): FormCall | Color {
  if (args[1] !== undefined) {
    throw new TypeError('Only one positional argument is allowed. All other arguments must be passed by name.');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the first parameter is required.
  const color = args[0] as Color | FunctionCall;
  if (color.type === 'FunctionCall' && MODERN_COLORS.has(color.name.toLowerCase())) {
    throw new TypeError(`$color: The ${color.name} color space is not supported yet.`);
  }
  const given = CHANNELS.filter((_, i) => args[i + 2] !== undefined);
  const alphaArg = args[CHANNELS.length + 2];
  const spaceValue = args[CHANNELS.length + 3];
  const space = spaceValue === undefined ? sniffSpace(given) : spaceArg(spaceValue);
  if (given.length === 0 && alphaArg === undefined && color.type === 'Color') {
    return color;
  }
  const working = space ?? 'rgb';
  const { form, alpha, keywords } = SPACES[working];
  const slots: [FormSlot, FormSlot, FormSlot] = [keywords[0], keywords[1], keywords[2]];
  for (const name of given) {
    const owner = INFO[name].space;
    if (owner !== working && !(owner === 'polar' && working !== 'rgb')) {
      throw new TypeError(`$${name}: Color space ${working} doesn't have a channel with this name.`);
    }
  }
  for (const name of given) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `given` holds the channels passed.
    const amount = numberArg(op, name, args[CHANNELS.indexOf(name) + 2] as ValueGroup);
    if (name === 'hue' && op === 'adjust' && spaceValue !== undefined && color.type === 'Color' && huePowerless(working, color)) {
      throw new TypeError(`$hue: Because the CSS working group is still deciding on the best behavior, Sass doesn't currently support modifying missing channels (color: ${color.bytes}).`);
    }
    slots[INFO[name].slot] = channelSlot(op, name, amount);
  }
  if (alphaArg === undefined) {
    return [form, color, ...slots];
  }
  const a = alphaSlot(op, numberArg(op, 'alpha', alphaArg));
  return a === 'alpha' ? [form, color, ...slots] : [alpha, color, ...slots, a];
}

/** A colour-update function under `name` (a `sass:color` member or its global spelling). */
export function defineColorUpdate(name: string, op: Op): Fn {
  return defineForm(name, {
    params: PARAMS,
    form: (...args: readonly (ValueGroup | undefined)[]) => update(op, args)
  });
}
