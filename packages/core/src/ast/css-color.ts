/**
 * A CSS `hsl()` that a built-in or an operation consumes, resolved by its CSS
 * definition (css-color-4 §7, css-color-5 §4.4) when every
 * input is known: `darken(hsl(from #336699 h s calc(l - 10)), 5%)` reads the
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
import { colorAlphaSlash, type FunctionCall, type ValueSlot } from './nodes.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { isValueGroupArray, type Color, type Dimension, type FunctionCall as WrittenCall, type ValueGroup } from './value-eval.js';
import { groupItems, groupSeparator } from './value-list.js';
import { makeColorHsl } from './value-factory.js';
import { clamp, HSL, rgbToHsl } from './color.js';
import { namedColor } from './color-names.js';
import { convertValue, groupOf, UnitGroup } from './value-units.js';

/**
 * The channel keywords a relative colour's channels read, bound to the origin's
 * values as numbers (css-color-5 §4.4: `h` in degrees, `s` and `l` on 0–100,
 * `alpha` on 0–1). An absolute colour's channels are evaluated with none bound,
 * so the math in them still computes.
 */
export interface ColorChannels {
  readonly h: Dimension | undefined;
  readonly s: Dimension | undefined;
  readonly l: Dimension | undefined;
  readonly alpha: Dimension | undefined;
}

const UNBOUND: ColorChannels = { h: undefined, s: undefined, l: undefined, alpha: undefined };

/** The value a channel keyword reads on a lane with `channels` bound, if it is one. */
export function channelOf(channels: ColorChannels, keyword: string): Dimension | undefined {
  switch (keyword.toLowerCase()) {
    case 'h': return channels.h;
    case 's': return channels.s;
    case 'l': return channels.l;
    case 'alpha': return channels.alpha;
    default: return undefined;
  }
}

/** Binds `channels` for a colour's channels, and evaluates each of them, typed, with those bound. */
export type ChannelBinder = (channels: ColorChannels) => (slot: ValueSlot) => MaybePromise<ValueGroup>;

/** A colour's computed `h`, `s`, `l` and alpha: degrees, then 0–1. */
export type Hsla = readonly [h: number, s: number, l: number, alpha: number];

/**
 * `hsl()`/`hsla()` with its channels written out: space-separated in one slot
 * (`hsl(120 50% 40%)`, `hsl(from C h s l / 0.5)`) or comma-separated
 * (`hsl(120, 50%, 40%)`).
 */
export function isHslCall(node: FunctionCall): boolean {
  const name = node.name.toLowerCase();
  if (name !== 'hsl' && name !== 'hsla') {
    return false;
  }
  const slot = node.args.length === 1 ? node.args[0]!.value : undefined;
  return node.args.length >= 3 || (Array.isArray(slot) && slot.length >= 3);
}

/**
 * The colour an `hsl()` ({@link isHslCall}) computes, or `written` (the call
 * written out as-is, whose bytes the colour is spelled with) when it is not
 * known. `slot` is the call's first argument as the call evaluated it, so a
 * relative colour's origin (a colour, or a keyword naming one) is read from it,
 * never evaluated again; the channels are evaluated again with the origin's
 * values bound, since the call evaluated them unbound. Each level of nesting is
 * evaluated at most twice, never once per enclosing level.
 */
export function resolveHsl(node: FunctionCall, slot: ValueGroup, bind: ChannelBinder, written: WrittenCall): MaybePromise<Color | WrittenCall> {
  const spelled = (hsla: Hsla | undefined, modern: boolean): Color | WrittenCall =>
    hsla === undefined ? written : makeColorHsl([hsla[0], hsla[1], hsla[2]], hsla[3], HSL, modern, { src: written.bytes });
  if (node.args.length > 1) {
    return mapMaybe(channelsOf(node.args.map(arg => arg.value), bind(UNBOUND), legacyHsla), hsla => spelled(hsla, false));
  }
  const nodes = node.args[0]!.value;
  if (!isValueSlotArray(nodes)) {
    return written;
  }
  const first = nodes[0]!;
  const relative = !isValueSlotArray(first) && first.type === 'Keyword' && first.src.toLowerCase() === 'from';
  const value = relative && isValueGroupArray(slot) ? slot[1] : undefined;
  const origin = value === undefined || isValueGroupArray(value) ? undefined : value.type === 'Color' ? value : value.type === 'Keyword' ? namedColor(value.text) : undefined;
  if (relative && origin === undefined) {
    return written;
  }
  return mapMaybe(hslaOf(node, nodes, relative ? origin : undefined, bind), hsla => spelled(hsla, true));
}

/**
 * What a form's `hsl(from origin …)` computes over an `origin` that is known, or
 * `undefined` when a channel is not ({@link hslaOf}).
 */
export function relativeHsla(form: FormChannels, origin: Color, channels: MutableChannels, read: (slot: ValueSlot) => MaybePromise<ValueGroup>): MaybePromise<Hsla | undefined> {
  const hsl = originHsl(origin);
  channels.h.number = hsl[0]!;
  channels.s.number = hsl[1]! * 100;
  channels.l.number = hsl[2]! * 100;
  channels.alpha.number = origin.alpha;
  return channelsOf(form.slots, read, values => hslOf(values, form.kinds, hsl, origin.alpha, form.slashed));
}

/** A form's relative colour, read once for every call. */
export interface FormChannels {
  readonly slots: readonly ValueSlot[];
  readonly kinds: readonly number[];
  readonly slashed: boolean;
}

export function formChannels(node: FunctionCall): FormChannels | undefined {
  const nodes = node.args[0]!.value;
  if (!isValueSlotArray(nodes)) {
    return undefined;
  }
  const alpha = colorAlphaSlash(node);
  const items = nodes.slice(2);
  const slots = alpha === null ? items : [...items.slice(0, -1), alpha.left, alpha.right];
  return { slots, kinds: slots.map(channelKind), slashed: alpha !== null };
}

/** The channels a form reads, one value each, written anew for each call. */
export type MutableChannels = { h: { number: number }; s: { number: number }; l: { number: number }; alpha: { number: number } };

export const formChannelValues = (): ColorChannels & MutableChannels => ({ h: channelNumberValue(0), s: channelNumberValue(0), l: channelNumberValue(0), alpha: channelNumberValue(0) }) as ColorChannels & MutableChannels;

/** The colour of a space-separated `hsl()`'s channels, the origin's bound in a relative one. */
function hslaOf(node: FunctionCall, nodes: readonly ValueSlot[], origin: OriginColor | undefined, bind: ChannelBinder): MaybePromise<Hsla | undefined> {
  const hsl = origin === undefined ? undefined : originHsl(origin);
  const read = bind(origin === undefined || hsl === undefined ? UNBOUND : hslChannels(hsl, origin.alpha));
  const alpha = colorAlphaSlash(node);
  const items = origin === undefined ? nodes : nodes.slice(2);
  const channels = alpha === null ? items : [...items.slice(0, -1), alpha.left, alpha.right];
  return channelsOf(channels, read, values => hslOf(values, channels.map(channelKind), hsl, origin?.alpha ?? 1, alpha !== null));
}

/**
 * A colour's channels read and made one: a channel that fails only bound
 * (`calc(l / 0)`, CSS math the browser rejects) is not known.
 */
function channelsOf(slots: readonly ValueSlot[], read: (slot: ValueSlot) => MaybePromise<ValueGroup>, of: (values: ValueGroup[]) => Hsla | undefined): MaybePromise<Hsla | undefined> {
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

/** Thrown for channel math that is not CSS ({@link channelMath}); {@link resolveHsl} reads it as a colour not known. */
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
const originHsl = (origin: OriginColor): readonly number[] =>
  origin.hsl ?? rgbToHsl(clamp(origin.rgb[0], 255), clamp(origin.rgb[1], 255), clamp(origin.rgb[2], 255));

/** The computed channels are read, never written out, so they are spelled with no bytes. */
const channelNumberValue = (number: number): Dimension => new DimensionValueNode(number, '', '');

const hslChannels = ([h, s, l]: readonly number[], alpha: number): ColorChannels =>
  ({ h: channelNumberValue(h!), s: channelNumberValue(s! * 100), l: channelNumberValue(l! * 100), alpha: channelNumberValue(alpha) });

/**
 * The colour of evaluated `h s l [/ alpha]` channels, or `undefined` when one
 * is not a number CSS reads there or an alpha is written without its `/`
 * (`slashed`: the call's alpha slash, else a `/` list the last channel is). An
 * omitted alpha is `alpha`: the origin's in a relative colour, else 1
 * (css-color-5 §4.1).
 */
function hslOf(values: readonly ValueGroup[], kinds: readonly number[], origin: readonly number[] | undefined, alpha: number, slashed: boolean): Hsla | undefined {
  const last = values[values.length - 1];
  const listed = !slashed && values.length === 3 && last !== undefined && !isValueGroupArray(last) && last.type === 'List' && groupSeparator(last) === '/';
  const channels = listed ? [values[0]!, values[1]!, ...groupItems(last)] : values;
  if (channels.length !== (slashed || listed ? 4 : 3)) {
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
const channelKind = (slot: ValueSlot): number =>
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
 * A saturation or lightness on 0–1. A number written in an absolute colour reads
 * as written, above 100 included, a negative as 0 (Chrome 152). In a relative
 * colour, `undefined` when a channel moved it outside the 0–100 this computes; a
 * channel that kept the origin's value keeps it exactly, in range or not.
 */
function fraction(value: number, origin: number | undefined, kind: number): number | undefined {
  if (origin === undefined) {
    return Math.max(value, 0) / 100;
  }
  if (value === origin * 100) {
    return origin;
  }
  if (value < 0 || value > 100) {
    return undefined;
  }
  return value === 0 || value === 100
    ? value / 100
    : Math.min(Math.max(moved(value, origin, 100, kind), 0), 1);
}

/**
 * A channel as the number CSS reads (css-color-4 §7, css-color-5 §4): `none`
 * is 0; a hue is a number of degrees or an angle; a saturation or lightness a
 * number or a percentage; an alpha a number or a percentage of 1.
 */
function channelNumber(value: ValueGroup, kind: 'hue' | '%' | 'alpha'): number | undefined {
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
  return unit !== '%' ? undefined : kind === 'alpha' ? value.number / 100 : value.number;
}
