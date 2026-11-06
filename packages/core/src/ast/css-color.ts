/**
 * A CSS `rgb()`, `hsl()` or `color-mix(in srgb, …)` that a built-in or an
 * operation consumes, resolved by its CSS definition (css-color-4 §5, §7,
 * css-color-5 §3, §4) when every input is known: `darken(hsl(from #336699 h s calc(l - 10)), 5%)` reads the
 * colour the browser computes for the `hsl()`. Written on its own the call
 * prints as written (docs/design/CSS-NATIVE-BUILTINS.md §3.4, Q12).
 *
 * The channels are evaluated by the one evaluator, on a lane that binds the
 * channel keywords to the origin's values ({@link ColorChannels}), so the math
 * written in them is Less math (V6). Anything not known — a `var()` origin, a
 * channel that does not compute or is not CSS ({@link channelMath}), a
 * saturation or lightness a relative channel moved outside 0–100 — leaves the call to
 * ordinary dispatch. Only a call its callable wrote out as-is resolves, spelled with
 * those bytes until an operation consumes it (V1), so a mixin argument or a
 * call written out around it prints it as it did.
 *
 * HARD MODULE BOUNDARY: the value domain and the parse tree's call shape.
 */
import { type MaybePromise, combineAll, isThenable, mapMaybe } from '@jesscss/awaitable-pipe';
import { trimNumber } from './format-number.js';
import { DimensionValueNode } from './node-ctors.js';
import { colorAlphaSlash, isCssColorCall, isSrgbColorMix, type AnonymousMixin, type FunctionCall, type ValueSlot } from './nodes.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { isValueGroupArray, type Color, type Dimension, type FunctionCall as WrittenCall, type ValueGroup } from './value-eval.js';
import { groupItems, groupSeparator } from './value-list.js';
import { makeColorHsl, makeColorRgb } from './value-factory.js';
import { clamp, HSL, hwbToRgb, RGB, rgbToHsl, holdsNone } from './color.js';
import { namedColor } from './color-names.js';
import { convertValue, groupOf, UnitGroup } from './value-units.js';

/**
 * The channel keywords a relative colour's channels read, bound to the origin's
 * values as numbers (css-color-5 §4: `h` in degrees, `s` and `l` on 0–100, `r`,
 * `g` and `b` on 0–255, `alpha` on 0–1). An absolute colour's channels are
 * evaluated with none bound, so the math in them still computes.
 */
export interface ColorChannels {
  readonly h: Dimension | undefined;
  readonly s: Dimension | undefined;
  readonly l: Dimension | undefined;
  readonly r: Dimension | undefined;
  readonly g: Dimension | undefined;
  readonly b: Dimension | undefined;
  readonly w: Dimension | undefined;
  readonly alpha: Dimension | undefined;
}

const UNBOUND: ColorChannels = { h: undefined, s: undefined, l: undefined, r: undefined, g: undefined, b: undefined, w: undefined, alpha: undefined };

/** The value a channel keyword reads on a lane with `channels` bound, if it is one. */
export function channelOf(channels: ColorChannels, keyword: string): Dimension | undefined {
  switch (keyword.toLowerCase()) {
    case 'h': return channels.h;
    case 's': return channels.s;
    case 'l': return channels.l;
    case 'r': return channels.r;
    case 'g': return channels.g;
    case 'b': return channels.b;
    case 'w': return channels.w;
    case 'alpha': return channels.alpha;
    default: return undefined;
  }
}

/** Binds `channels` for a colour's channels, and evaluates each of them, typed, with those bound. */
export type ChannelBinder = (channels: ColorChannels) => (slot: ValueSlot) => MaybePromise<ValueGroup>;

/** A colour's computed `h`, `s`, `l` and alpha: degrees, then 0–1. */
export type Hsla = readonly [h: number, s: number, l: number, alpha: number];

/** A colour's computed `r`, `g`, `b` on 0–255, and alpha on 0–1. */
export type Rgba = readonly [r: number, g: number, b: number, alpha: number];

/**
 * The colour a CSS colour call ({@link isCssColorCall}) computes, or `written`
 * (the call written out as-is, whose bytes the colour is spelled with) when it
 * is not known. `vals` are the call's arguments as the call evaluated them, so a
 * relative colour's origin (a colour, or a keyword naming one) and an absolute
 * call's computed channels are read from them, never evaluated again; other
 * channels are evaluated again, with the origin's values bound, since the call
 * evaluated them unbound, and so is an origin that is a colour call of its own.
 * A level of nesting can be evaluated more than twice: a chain of
 * `darken(color-mix(in srgb, …, blue), 10%)` grows about x2.85 per doubling of its
 * depth, harmless at the depths of 1 to 3 authors write.
 */
export function resolveColorCall(node: FunctionCall, vals: readonly ValueGroup[], bind: ChannelBinder, written: WrittenCall): MaybePromise<Color | WrittenCall> {
  if (isSrgbColorMix(node)) {
    return resolveColorMix(node, vals, bind, written);
  }
  const isRgb = node.name.toLowerCase().startsWith('rgb');
  const spelled = (channels: Hsla | Rgba | undefined, modern: boolean): Color | WrittenCall =>
    channels === undefined
      ? written
      : isRgb
        ? makeColorRgb([channels[0], channels[1], channels[2]], channels[3], RGB, { modernSyntax: modern, src: written.bytes })
        : makeColorHsl([channels[0], channels[1], channels[2]], channels[3], HSL, modern, { src: written.bytes });
  if (node.args.length > 1) {
    const read = bind(UNBOUND);
    return mapMaybe(channelsOf(node.args.map(arg => arg.value), (arg, i) => isDimension(vals[i]) ? vals[i] : read(arg), isRgb ? legacyRgba : legacyHsla), channels => spelled(channels, false));
  }
  const slot = vals[0]!;
  const nodes = node.args[0]!.value;
  if (!isValueSlotArray(nodes)) {
    return written;
  }
  const first = nodes[0]!;
  const relative = !isValueSlotArray(first) && first.type === 'Keyword' && first.src.toLowerCase() === 'from';
  const value = relative && isValueGroupArray(slot) ? slot[1] : undefined;
  const origin = value === undefined || isValueGroupArray(value) ? undefined : value.type === 'Color' ? value : value.type === 'Keyword' ? namedColor(value.text) : undefined;
  const computed = (from: OriginColor | undefined): MaybePromise<Color | WrittenCall> =>
    mapMaybe((isRgb ? rgbaOf : hslaOf)(node, nodes, from, bind, slot), channels => spelled(channels, true));
  if (relative && origin === undefined) {
    /* A colour call as the origin was written out, as it is an argument no callable reads, so this consumer asks for it. */
    const call = nodes[1]!;
    return !isValueSlotArray(call) && call.type === 'FunctionCall' && isComputedColorCall(call)
      ? mapMaybe(bind(UNBOUND)(call), again => !isValueGroupArray(again) && again.type === 'Color' ? computed(again) : written)
      : written;
  }
  return computed(relative ? origin : undefined);
}

/** A CSS colour call that a consumer computes when it is known. */
export const isComputedColorCall = (node: FunctionCall): boolean => isCssColorCall(node) || isSrgbColorMix(node);

/**
 * The colour of a `color-mix(in srgb, …)`. An argument a call written out holds
 * as written, a colour call or a `calc()`, is evaluated again for this consumer,
 * as a relative colour's origin is.
 */
function resolveColorMix(node: FunctionCall, vals: readonly ValueGroup[], bind: ChannelBinder, written: WrittenCall): MaybePromise<Color | WrittenCall> {
  const spelled = (out: Rgba | undefined): Color | WrittenCall =>
    out === undefined ? written : makeColorRgb([out[0], out[1], out[2]], out[3], RGB, { modernSyntax: true, src: written.bytes });
  const known = authoredMix(vals.slice(1));
  return known !== undefined ? spelled(known) : mapMaybe(channelsOf([node.args[1]!.value, node.args[2]!.value], bind(UNBOUND), authoredMix), spelled);
}

/** One argument of a `color-mix()`: a colour, and its percentage if it has one. */
function mixArgument(value: ValueGroup): { readonly color: OriginColor; readonly weight: number | undefined } | undefined {
  let color: OriginColor | undefined;
  let weight: number | undefined;
  for (const item of groupItems(value)) {
    if (isDimension(item) && item.unit === '%' && weight === undefined) {
      weight = item.number;
    } else if (!isValueGroupArray(item) && item.type === 'Color' && color === undefined) {
      /* A missing channel takes the other colour's value (css-color-4 §12.2), which the browser computes. */
      if (holdsNone(item)) {
        return undefined;
      }
      color = item;
    } else if (!isValueGroupArray(item) && item.type === 'Keyword' && color === undefined) {
      color = namedColor(item.text);
      if (color === undefined) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return color === undefined ? undefined : { color, weight };
}

/**
 * An authored `color-mix(in srgb, …)` (css-color-5 §3.1): each percentage in
 * 0–100, their sum not 0. Two that do not sum to 100 are scaled to it, and a sum
 * below 100 is a share of the alpha. Anything else is invalid, so not known.
 */
function authoredMix(values: readonly ValueGroup[]): Rgba | undefined {
  const first = mixArgument(values[0]!);
  const second = mixArgument(values[1]!);
  if (first === undefined || second === undefined) {
    return undefined;
  }
  const w1 = first.weight;
  const w2 = second.weight;
  if ((w1 !== undefined && (w1 < 0 || w1 > 100)) || (w2 !== undefined && (w2 < 0 || w2 > 100))) {
    return undefined;
  }
  if (w1 === undefined || w2 === undefined) {
    return mixed(first.color, second.color, w1 ?? (w2 === undefined ? 50 : 100 - w2));
  }
  const sum = w1 + w2;
  if (sum === 0) {
    return undefined;
  }
  const out = mixed(first.color, second.color, sum === 100 ? w1 : w1 * 100 / sum);
  return sum < 100 ? [out[0], out[1], out[2], out[3] * sum / 100] : out;
}

/**
 * Two colours mixed in sRGB (css-color-5 §3.3, §3.5): each counts by its weight
 * times its opacity. `weight` is the first colour's percentage, the second has
 * the rest; outside 0–100 it extrapolates, clamped, as a built-in's relative
 * form does. Two of one opacity need no premultiplying.
 */
function mixed(c1: OriginColor, c2: OriginColor, weight: number): Rgba {
  const rest = 100 - weight;
  const [r1, g1, b1] = mixOperand(c1);
  const [r2, g2, b2] = mixOperand(c2);
  const a1 = clamp(c1.alpha, 1);
  const a2 = clamp(c2.alpha, 1);
  if (a1 === a2 && a1 !== 0) {
    return [clamp((r1 * weight + r2 * rest) / 100, 255), clamp((g1 * weight + g2 * rest) / 100, 255), clamp((b1 * weight + b2 * rest) / 100, 255), a1];
  }
  const p1 = a1 * weight;
  const p2 = a2 * rest;
  const total = p1 + p2;
  return total === 0
    ? [0, 0, 0, 0]
    : [clamp((r1 * p1 + r2 * p2) / total, 255), clamp((g1 * p1 + g2 * p2) / total, 255), clamp((b1 * p1 + b2 * p2) / total, 255), clamp(total / 100, 1)];
}

/** An operand's channels, with no binary residue of its own to tip a half-byte tie (`hsl(120, 50%, 40%)` holds 51, V4). */
function mixOperand(origin: OriginColor): readonly [number, number, number] {
  const [r, g, b] = originRgb(origin);
  return Number.isInteger(r) && Number.isInteger(g) && Number.isInteger(b) ? [r, g, b] : [trimNumber(r), trimNumber(g), trimNumber(b)];
}

/** A built-in's `color-mix()` form over known values: its weight may lie outside 0–100, which no authored call holds. */
function formMix(values: readonly ValueGroup[]): Rgba | undefined {
  const first = mixArgument(values[0]!);
  const second = mixArgument(values[1]!);
  return first === undefined || second === undefined ? undefined : mixed(first.color, second.color, first.weight ?? 50);
}

/**
 * What a form computes over an `input` that is known: the origin of a relative
 * colour, or an absolute colour's channels, or `undefined` when a channel is not
 * known ({@link hslOf}, {@link rgbOf}, {@link hwbOf}).
 */
export function formColor(form: FormChannels, input: Color | Dimension, channels: MutableChannels, read: (slot: ValueSlot) => MaybePromise<ValueGroup>, kinds: readonly number[]): MaybePromise<Hsla | Rgba | undefined> {
  const { slashed } = form;
  if (form.space === 'mix') {
    return channelsOf(form.slots, read, formMix);
  }
  if (input.type !== 'Color') {
    return channelsOf(form.slots, read, values => hwbOf(values, slashed, 1, false));
  }
  if (form.space === 'hsl') {
    const hsl = originHsl(input);
    channels.alpha.number = input.alpha;
    channels.h.number = hsl[0]!;
    channels.s.number = hsl[1]! * 100;
    channels.l.number = hsl[2]! * 100;
    return channelsOf(form.slots, read, values => hslOf(values, kinds, hsl, input.alpha, slashed));
  }
  const rgb = originRgb(input);
  const alpha = clamp(input.alpha, 1);
  channels.alpha.number = alpha;
  if (form.space === 'hwb') {
    /* A relative `hwb()` reads the origin through sRGB, so a grey `hsl()` has no hue of its own (css-color-5 §4). */
    channels.h.number = rgbToHsl(rgb[0], rgb[1], rgb[2])[0];
    channels.w.number = Math.min(...rgb) / 2.55;
    channels.b.number = 100 - Math.max(...rgb) / 2.55;
    return channelsOf(form.slots, read, values => hwbOf(values, slashed, alpha, true));
  }
  channels.r.number = rgb[0];
  channels.g.number = rgb[1];
  channels.b.number = rgb[2];
  return channelsOf(form.slots, read, values => rgbOf(values, kinds, rgb, alpha, slashed));
}

/** A form's colour, read once for every call: which function it is, and whether it reads an origin. */
export interface FormChannels {
  readonly space: 'hsl' | 'rgb' | 'hwb' | 'mix';
  readonly relative: boolean;
  readonly slots: readonly ValueSlot[];
  readonly kinds: readonly number[];

  /** The parameter each channel is, if any is, so its kind is what each call binds. */
  readonly parameters?: readonly (number | undefined)[];
  readonly slashed: boolean;
}

const FORM_SPACES: Readonly<Record<string, FormChannels['space'] | undefined>> = { hsl: 'hsl', rgb: 'rgb', hwb: 'hwb' };

export function formChannels(node: FunctionCall, params?: AnonymousMixin['params']): FormChannels | undefined {
  if (isSrgbColorMix(node)) {
    return { space: 'mix', relative: true, slots: [node.args[1]!.value, node.args[2]!.value], kinds: [], slashed: false };
  }
  const nodes = node.args[0]!.value;
  const space = FORM_SPACES[node.name];
  if (space === undefined || !isValueSlotArray(nodes)) {
    return undefined;
  }
  const first = nodes[0]!;
  const relative = !isValueSlotArray(first) && first.type === 'Keyword' && first.src === 'from';
  const { slots, slashed } = colorSlots(node, nodes, relative);
  const indexes = new Map<unknown, number>(params?.map((param, index) => [param.name, index]));
  const parameters = slots.map(slot => isValueSlotArray(slot) || slot.type !== 'Lookup' ? undefined : indexes.get(slot.name));
  return { space, relative, slots, kinds: slots.map(channelKind), parameters: parameters.some(index => index !== undefined) ? parameters : undefined, slashed };
}

/** The channels a form reads, one value each, written anew for each call. */
export type MutableChannels = Record<'h' | 's' | 'l' | 'r' | 'g' | 'b' | 'w' | 'alpha', { number: number }>;

export const formChannelValues = (): ColorChannels & MutableChannels => ({ h: channelNumberValue(0), s: channelNumberValue(0), l: channelNumberValue(0), r: channelNumberValue(0), g: channelNumberValue(0), b: channelNumberValue(0), w: channelNumberValue(0), alpha: channelNumberValue(0) }) as ColorChannels & MutableChannels;

/** A space-separated colour's channels with its alpha, as they are read ({@link colorAlphaSlash}, or a `/` list the last channel is). */
function colorSlots(node: FunctionCall, nodes: readonly ValueSlot[], relative: boolean): { readonly slots: readonly ValueSlot[]; readonly slashed: boolean } {
  const alpha = colorAlphaSlash(node);
  const items = relative ? nodes.slice(2) : nodes;
  const last = items[items.length - 1];
  const listed = alpha === null && items.length === 3 && last !== undefined && !isValueSlotArray(last) && last.type === 'List' && last.sep === '/' && last.value.length === 2;
  return {
    slots: alpha !== null ? [...items.slice(0, -1), alpha.left, alpha.right] : listed ? [items[0]!, items[1]!, ...last.value] : items,
    slashed: alpha !== null || listed
  };
}

/** The colour of a space-separated `hsl()`'s channels, the origin's bound in a relative one. */
function hslaOf(node: FunctionCall, nodes: readonly ValueSlot[], origin: OriginColor | undefined, bind: ChannelBinder, evaluated: ValueGroup): MaybePromise<Hsla | undefined> {
  const hsl = origin === undefined ? undefined : originHsl(origin);
  const read = bind(origin === undefined || hsl === undefined ? UNBOUND : hslChannels(hsl, origin.alpha));
  const { slots, slashed } = colorSlots(node, nodes, origin !== undefined);
  return channelsOf(slots, channelReader(read, origin, evaluated, slashed), values => hslOf(values, slots.map(channelKind), hsl, origin?.alpha ?? 1, slashed));
}

/** The colour of a space-separated `rgb()`'s channels, the origin's bound in a relative one. */
function rgbaOf(node: FunctionCall, nodes: readonly ValueSlot[], origin: OriginColor | undefined, bind: ChannelBinder, evaluated: ValueGroup): MaybePromise<Rgba | undefined> {
  const rgb = origin === undefined ? undefined : originRgb(origin);
  const alpha = origin === undefined ? 1 : clamp(origin.alpha, 1);
  const read = bind(rgb === undefined ? UNBOUND : { ...UNBOUND, r: channelNumberValue(rgb[0]), g: channelNumberValue(rgb[1]), b: channelNumberValue(rgb[2]), alpha: channelNumberValue(alpha) });
  const { slots, slashed } = colorSlots(node, nodes, origin !== undefined);
  return channelsOf(slots, channelReader(read, origin, evaluated, slashed), values => rgbOf(values, slots.map(channelKind), rgb, alpha, slashed));
}

/** How an `hsl()` or `rgb()` reads its channels: an absolute call's that the call computed, as it computed them. `evaluated` holds its alpha in a `/` list after the channels ({@link colorChannels}). */
function channelReader(read: (slot: ValueSlot) => MaybePromise<ValueGroup>, origin: OriginColor | undefined, evaluated: ValueGroup, slashed: boolean): (slot: ValueSlot, index: number) => MaybePromise<ValueGroup> {
  if (origin !== undefined || !isValueGroupArray(evaluated)) {
    return read;
  }
  const last = evaluated[evaluated.length - 1];
  const values = slashed && last !== undefined ? [...evaluated.slice(0, -1), ...groupItems(last)] : evaluated;
  return (slot, index) => {
    const value = values[index];
    return isDimension(value) ? value : read(slot);
  };
}

/**
 * A colour's channels read and made one: a channel that fails only bound
 * (`calc(l / 0)`, CSS math the browser rejects) is not known.
 */
function channelsOf<T>(slots: readonly ValueSlot[], read: (slot: ValueSlot, index: number) => MaybePromise<ValueGroup>, of: (values: ValueGroup[]) => T | undefined): MaybePromise<T | undefined> {
  try {
    const resolved = combineAll(slots.map(read), of);
    return isThenable(resolved) ? resolved.catch(() => undefined) : resolved;
  } catch {
    return undefined;
  }
}

/**
 * Whether `op` on two operands is math CSS defines in a colour's channels
 * (css-values-4 §10.9): `+` and `-` on one type, `*` with a number, `/` by a
 * number. A channel keyword is a number (css-color-5 §4.4), so `l - 10%` and
 * `h + 30deg` are not, and leave the colour unresolved. Operands that are not
 * dimensions are left to the operation.
 */
export function channelMath(op: string, left: ValueGroup, right: ValueGroup): boolean {
  if (isValueGroupArray(left) || isValueGroupArray(right) || left.type !== 'Dimension' || right.type !== 'Dimension') {
    return true;
  }
  const l = calcType(left.unit);
  const r = calcType(right.unit);
  return op === '+' || op === '-' ? l === r : op === '*' ? l === '' || r === '' : op === '/' ? r === '' : true;
}

/** A unit's css-values-4 type: `''` a number, `%` a percentage, else its conversion group (or the unit itself). */
function calcType(unit: string): string {
  const group = groupOf(unit);
  return unit === '' || unit === '%' ? unit : group === undefined ? unit.toLowerCase() : String(group);
}

/** Thrown for channel math that is not CSS ({@link channelMath}); {@link resolveColorCall} reads it as a colour not known. */
export class ChannelMathError extends Error {}

/** Rejects channel math that is not CSS ({@link channelMath}). */
export function rejectChannelMath(op: string): never {
  throw new ChannelMathError(`\`${op}\` on these operands is not CSS math in a colour channel.`);
}

/**
 * A math function a form writes in a channel, with its arguments evaluated, or
 * `undefined` when it does not compute there. `clamp(min, val, max)` is
 * `max(min, min(val, max))` over arguments of one type (css-values-4 §10.2,
 * §10.9).
 */
export function channelFunction(name: string, args: readonly ValueGroup[]): Dimension | undefined {
  const [low, value, high] = args;
  if (name.toLowerCase() !== 'clamp' || args.length !== 3 || !isDimension(low) || !isDimension(value) || !isDimension(high)) {
    return undefined;
  }
  return calcType(low.unit) === calcType(value.unit) && calcType(value.unit) === calcType(high.unit)
    ? new DimensionValueNode(Math.max(low.number, Math.min(value.number, high.number)), value.unit, '') as Dimension
    : undefined;
}

const isDimension = (value: ValueGroup | undefined): value is Dimension =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'Dimension';

type OriginColor = Pick<Color, 'rgb' | 'hsl' | 'alpha'>;

/**
 * The origin's channels. An `hsl()` origin's are its own, a grey's hue and
 * saturation included. Any other's are read through the sRGB it prints, clamped,
 * so a grey's hue is 0 and `rgb(300, 0, 0)` is red (Chrome 152,
 * docs/design/CSS-NATIVE-BUILTINS.md §2, Q9).
 */
const originHsl = (origin: OriginColor): readonly number[] => {
  if (origin.hsl !== undefined) {
    return origin.hsl;
  }
  const rgb = originRgb(origin);
  return rgbToHsl(rgb[0], rgb[1], rgb[2]);
};

/** The sRGB an origin prints, clamped: what a relative `rgb()` reads of it (css-color-5 §4.3). */
const originRgb = (origin: OriginColor): readonly [number, number, number] =>
  [clamp(origin.rgb[0], 255), clamp(origin.rgb[1], 255), clamp(origin.rgb[2], 255)];

/** The computed channels are read, never written out, so they are spelled with no bytes. */
const channelNumberValue = (number: number): Dimension => new DimensionValueNode(number, '', '');

const hslChannels = ([h, s, l]: readonly number[], alpha: number): ColorChannels =>
  ({ ...UNBOUND, h: channelNumberValue(h!), s: channelNumberValue(s! * 100), l: channelNumberValue(l! * 100), alpha: channelNumberValue(alpha) });

/**
 * Evaluated `a b c [/ alpha]` channels, the alpha last when there is one, or
 * `undefined` when an alpha is written without its `/` (`slashed`: the call's
 * alpha slash, else a `/` list the last channel is).
 */
function alphaLast(values: readonly ValueGroup[], slashed: boolean): readonly ValueGroup[] | undefined {
  const last = values[values.length - 1];
  const listed = !slashed && values.length === 3 && last !== undefined && !isValueGroupArray(last) && last.type === 'List' && groupSeparator(last) === '/';
  const channels = listed ? [values[0]!, values[1]!, ...groupItems(last)] : values;
  return channels.length === (slashed || listed ? 4 : 3) ? channels : undefined;
}

/**
 * The colour of evaluated `h s l [/ alpha]` channels, or `undefined` when one
 * is not a number CSS reads there ({@link alphaLast}). An omitted alpha is
 * `alpha`: the origin's in a relative colour, else 1 (css-color-5 §4.1).
 */
function hslOf(values: readonly ValueGroup[], kinds: readonly number[], origin: readonly number[] | undefined, alpha: number, slashed: boolean): Hsla | undefined {
  const channels = alphaLast(values, slashed);
  if (channels === undefined) {
    return undefined;
  }
  const h = channelNumber(channels[0]!, 'hue');
  const s = channelNumber(channels[1]!, '%');
  const l = channelNumber(channels[2]!, '%');
  const a = channels[3] === undefined ? alpha : channelNumber(channels[3], 'alpha');
  if (h === undefined || s === undefined || l === undefined || a === undefined) {
    return undefined;
  }
  const saturation = fraction(s, origin?.[1], kinds[1]!);
  const lightness = fraction(l, origin?.[2], kinds[2]!);
  return saturation === undefined || lightness === undefined
    ? undefined
    : [hueOf(h, origin?.[0], kinds[0]!), saturation, lightness, Math.min(Math.max(a, 0), 1)];
}

/**
 * The colour of evaluated `r g b [/ alpha]` channels, or `undefined` when one is
 * not a number CSS reads there. A channel a relative colour moved outside 0–255
 * is not known, as the browser keeps it out of the sRGB gamut; an absolute one
 * clamps (Chrome 152).
 */
function rgbOf(values: readonly ValueGroup[], kinds: readonly number[], origin: readonly number[] | undefined, alpha: number, slashed: boolean): Rgba | undefined {
  const channels = alphaLast(values, slashed);
  if (channels === undefined) {
    return undefined;
  }
  const r = rgbChannel(channels[0]!, origin?.[0], kinds[0]!);
  const g = rgbChannel(channels[1]!, origin?.[1], kinds[1]!);
  const b = rgbChannel(channels[2]!, origin?.[2], kinds[2]!);
  const a = channels[3] === undefined ? alpha : channelNumber(channels[3], 'alpha');
  return r === undefined || g === undefined || b === undefined || a === undefined ? undefined : [r, g, b, clamp(a, 1)];
}

function rgbChannel(channel: ValueGroup, origin: number | undefined, kind: number): number | undefined {
  const value = channelNumber(channel, 'rgb');
  if (value === undefined || origin === undefined) {
    return value === undefined ? undefined : clamp(value, 255);
  }
  return value === origin ? origin : value < 0 || value > 255 ? undefined : kind === 0 ? value : clamp(moved(value, origin, 1, kind), 255);
}

/**
 * The colour of evaluated `h w b [/ alpha]` channels (css-color-4 §8), or
 * `undefined` when one is not a number CSS reads there. A sum above 100%
 * normalizes. A negative whiteness or blackness reads as 0 in an absolute call,
 * and in a relative one is not known, as the browser keeps it out of the sRGB
 * gamut (Chrome 152).
 */
function hwbOf(values: readonly ValueGroup[], slashed: boolean, alpha: number, relative: boolean): Rgba | undefined {
  const channels = alphaLast(values, slashed);
  if (channels === undefined) {
    return undefined;
  }
  const h = channelNumber(channels[0]!, 'hue');
  const w = channelNumber(channels[1]!, '%');
  const b = channelNumber(channels[2]!, '%');
  const a = channels[3] === undefined ? alpha : channelNumber(channels[3], 'alpha');
  if (h === undefined || w === undefined || b === undefined || a === undefined || (relative && (w < 0 || b < 0))) {
    return undefined;
  }
  const rgb = hwbToRgb(hueOf(h, undefined, 0), Math.max(w, 0) / 100, Math.max(b, 0) / 100);
  return [trimNumber(rgb[0]), trimNumber(rgb[1]), trimNumber(rgb[2]), clamp(a, 1)];
}

/**
 * The colour of a comma-separated `rgb()`'s channels (css-color-4 §5): all
 * numbers or all percentages, clamped to 0–255, and never `none`. Anything else
 * is invalid there, so not known.
 */
function legacyRgba(values: readonly ValueGroup[]): Rgba | undefined {
  const [r, g, b, a] = values;
  const alpha = a === undefined ? 1 : isDimension(a) ? channelNumber(a, 'alpha') : undefined;
  if (values.length > 4 || alpha === undefined || !isDimension(r) || !isDimension(g) || !isDimension(b) || r.unit !== g.unit || g.unit !== b.unit || (r.unit !== '' && r.unit !== '%')) {
    return undefined;
  }
  return [clamp(channelNumber(r, 'rgb')!, 255), clamp(channelNumber(g, 'rgb')!, 255), clamp(channelNumber(b, 'rgb')!, 255), clamp(alpha, 1)];
}

/**
 * The colour of a comma-separated `hsl()`'s channels (css-color-4 §7): a hue that
 * is a number or an angle, a saturation and lightness that are percentages,
 * clamped to 0–100, and never `none`. Anything else is invalid there, so not known.
 */
function legacyHsla(values: readonly ValueGroup[]): Hsla | undefined {
  const [hue, s, l, a] = values;
  const h = isDimension(hue) ? channelNumber(hue, 'hue') : undefined;
  const alpha = a === undefined ? 1 : isDimension(a) ? channelNumber(a, 'alpha') : undefined;
  return values.length > 4 || h === undefined || alpha === undefined || !isPercentage(s) || !isPercentage(l)
    ? undefined
    : [hueOf(h, undefined, 0), clamp(s.number, 100) / 100, clamp(l.number, 100) / 100, clamp(alpha, 1)];
}

const isPercentage = (value: ValueGroup | undefined): value is Dimension => isDimension(value) && value.unit === '%';

/** Whether a channel's math multiplies or divides, so that what it changes is a share of what it reads. */
function scalesChannel(slot: ValueSlot): boolean {
  if (isValueSlotArray(slot)) {
    return slot.some(scalesChannel);
  }
  switch (slot.type) {
    case 'Operation': return slot.operator === '*' || slot.operator === '/' || scalesChannel(slot.left) || scalesChannel(slot.right);
    case 'FunctionCall': return slot.args.some(arg => scalesChannel(arg.value));
    default: return false;
  }
}

/** What a channel's math is: `0` a number written, `1` a share of what it reads, `2` a change. */
export const channelKind = (slot: ValueSlot): number =>
  !isValueSlotArray(slot) && slot.type === 'Dimension' ? 0 : scalesChannel(slot) ? 1 : 2;

/**
 * A channel's new value from the origin's exact one, on the origin's own scale.
 * The scale's rounding is no part of what the channel wrote (V4 trims it),
 * whether that is a change (`s + 10` is `s + 0.1` on 0–1), a share of the
 * channel (`l - l * 10 / 100` is `l - l * 0.1`), or a number of its own.
 */
function moved(value: number, origin: number, scale: number, kind: number): number {
  const scaled = origin * scale;
  if (kind === 0) {
    return value / scale;
  }
  return scaled !== 0 && kind === 1
    ? origin + origin * (trimNumber((value - scaled) / scaled * 100) / 100)
    : origin + trimNumber(value - scaled) / scale;
}

/** A hue in degrees, wrapped into 0–360 when the channel changed it. */
function hueOf(value: number, origin: number | undefined, kind: number): number {
  if (value === origin) {
    return value;
  }
  const hue = (origin === undefined ? value : moved(value, origin, 1, kind)) % 360;
  return hue < 0 ? hue + 360 : hue;
}

/**
 * A saturation or lightness on 0–1, or `undefined` outside the 0–100 this
 * computes, which the browser gamut-maps, so the call stays printed. A channel
 * that kept the origin's value keeps it exactly, in range or not.
 */
function fraction(value: number, origin: number | undefined, kind: number): number | undefined {
  if (origin !== undefined && value === origin * 100) {
    return origin;
  }
  if (value < 0 || value > 100) {
    return undefined;
  }
  return origin === undefined || value === 0 || value === 100
    ? value / 100
    : Math.min(Math.max(moved(value, origin, 100, kind), 0), 1);
}

/**
 * A channel as the number CSS reads (css-color-4 §7, css-color-5 §4): `none`
 * is 0; a hue is a number of degrees or an angle; a saturation or lightness a
 * number or a percentage; `rgb` a number or a percentage of 255; an alpha a
 * number or a percentage of 1.
 */
function channelNumber(value: ValueGroup, kind: 'hue' | '%' | 'rgb' | 'alpha'): number | undefined {
  if (isValueGroupArray(value)) {
    return undefined;
  }
  if (value.type === 'Keyword') {
    return value.text.toLowerCase() === 'none' ? 0 : undefined;
  }
  if (value.type !== 'Dimension') {
    return undefined;
  }
  const unit = value.unit.toLowerCase();
  if (unit === '') {
    return value.number;
  }
  if (kind === 'hue') {
    return groupOf(unit) === UnitGroup.Angle ? convertValue(value.number, unit, 'deg') : undefined;
  }
  return unit !== '%' ? undefined : kind === 'alpha' ? value.number / 100 : kind === 'rgb' ? (value.number * 255) / 100 : value.number;
}
