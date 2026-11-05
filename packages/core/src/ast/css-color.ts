/**
 * A CSS `hsl()` in modern syntax that a built-in or an operation consumes,
 * resolved by its CSS definition (css-color-4 §7, css-color-5 §4.4) when every
 * input is known: `darken(hsl(from #336699 h s calc(l - 10)), 5%)` reads the
 * colour the browser computes for the `hsl()`. Written on its own the call
 * prints as written (docs/design/CSS-NATIVE-BUILTINS.md §3.4, Q12).
 *
 * The channels are evaluated by the one evaluator, on a lane that binds the
 * channel keywords to the origin's values ({@link ColorChannels}), so the math
 * written in them is Less math (V6). Anything not known — a `var()` origin, a
 * channel that does not compute or is not CSS ({@link channelMath}), a
 * saturation or lightness outside 0–100 — leaves the call to ordinary
 * dispatch. Only a call its callable wrote out as-is resolves, spelled with
 * those bytes until an operation consumes it (V1), so a mixin argument or a
 * call written out around it prints it as it did.
 *
 * HARD MODULE BOUNDARY: the value domain and the parse tree's call shape.
 */
import { type MaybePromise, combineAll, isThenable, mapMaybe } from '@jesscss/awaitable-pipe';
import { colorAlphaSlash, type FunctionCall, type ValueSlot } from './nodes.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { isValueGroupArray, type Color, type Dimension, type Keyword, type ValueGroup } from './value-eval.js';
import { groupItems, groupSeparator } from './value-list.js';
import { makeDimension, makeHslColor } from './value-factory.js';
import { rgbToHsl } from './color.js';
import { namedColor } from './color-names.js';
import { convertValue, groupOf, UnitGroup } from './value-units.js';

/**
 * The channel keywords a relative colour's channels read, bound to the origin's
 * values as numbers (css-color-5 §4.4: `h` in degrees, `s` and `l` on 0–100,
 * `alpha` on 0–1). Keyed by the lowercase keyword. An absolute colour's
 * channels are evaluated with none bound, so the math in them still computes.
 */
export type ColorChannels = ReadonlyMap<string, Dimension>;

const UNBOUND: ColorChannels = new Map();

/** Evaluates one channel node, typed, with `channels` bound. */
export type ChannelEval = (slot: ValueSlot, channels: ColorChannels) => MaybePromise<ValueGroup>;

/** `hsl()`/`hsla()` written in one space-separated slot: `hsl(120 50% 40%)`, `hsl(from C h s l / 0.5)`. */
export function isModernHsl(node: FunctionCall): boolean {
  const slot = node.args.length === 1 ? node.args[0]!.value : undefined;
  if (!Array.isArray(slot) || slot.length < 3) {
    return false;
  }
  const name = node.name.toLowerCase();
  return name === 'hsl' || name === 'hsla';
}

/**
 * The colour a modern `hsl()` ({@link isModernHsl}) computes, or `written` (the
 * call written out as-is, whose bytes the colour is spelled with) when it is
 * not known. `slot` is the call's one argument as
 * the call evaluated it, so a relative colour's origin (a colour, or a keyword
 * naming one) is read from it, never evaluated again; the channels are
 * evaluated again with the origin's values bound, since the call evaluated
 * them unbound. Each level of nesting is evaluated at most twice, never once
 * per enclosing level. A channel that fails only bound (`calc(l / 0)`, CSS math
 * the browser rejects) is not known.
 */
export function resolveHsl(node: FunctionCall, slot: ValueGroup, evaluate: ChannelEval, written: Keyword): MaybePromise<Color | Keyword> {
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
  const bound = origin === undefined ? UNBOUND : hslChannels(origin);
  const alpha = colorAlphaSlash(node);
  const items = relative ? nodes.slice(2) : nodes;
  const channels = alpha === null ? items : [...items.slice(0, -1), alpha.left, alpha.right];
  let resolved: MaybePromise<Color | undefined>;
  try {
    resolved = combineAll(channels.map(channel => evaluate(channel, bound)), values => hslOf(values, bound.get('alpha')?.number ?? 1, alpha !== null, written.bytes));
  } catch {
    resolved = undefined;
  }
  return mapMaybe(isThenable(resolved) ? resolved.catch(() => undefined) : resolved, color => color ?? written);
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
 * The origin's channels, from its sRGB value as the browser takes them
 * ("after conversion, if required, to sRGB", css-color-5 §4.4): a grey's hue
 * is powerless and reads as 0, whatever hue a built-in carried (Q9).
 */
function hslChannels(origin: { readonly rgb: readonly number[]; readonly alpha: number }): ColorChannels {
  const [h, s, l] = rgbToHsl(origin.rgb[0]!, origin.rgb[1]!, origin.rgb[2]!);
  return new Map([['h', makeDimension(h)], ['s', makeDimension(s * 100)], ['l', makeDimension(l * 100)], ['alpha', makeDimension(origin.alpha)]]);
}

/**
 * The colour of evaluated `h s l [/ alpha]` channels, or `undefined` when one
 * is not a number CSS reads there or an alpha is written without its `/`
 * (`slashed`: the call's alpha slash, else a `/` list the last channel is). An
 * omitted alpha is `alpha`: the origin's in a relative colour, else 1
 * (css-color-5 §4.1).
 */
function hslOf(values: readonly ValueGroup[], alpha: number, slashed: boolean, src: string): Color | undefined {
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
  if (h === undefined || s === undefined || l === undefined || a === undefined || s < 0 || s > 100 || l < 0 || l > 100) {
    return undefined;
  }
  return makeHslColor([((h % 360) + 360) % 360, s / 100, l / 100], Math.min(Math.max(a, 0), 1), true, { src });
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
