/**
 * A built-in whose definition is its CSS form: an ordinary stylesheet function
 * parsed once at the build of the package that ships it, evaluated on arguments
 * the call evaluated. Known inputs compute through the one evaluator
 * ({@link formColor}), a value only the browser knows leaves the form printed,
 * so a call and its form are one value (docs/design/CSS-NATIVE-BUILTINS.md §2,
 * §3.3).
 *
 * A form runs on a lane of its own, with no function registered: it is not in
 * the document that called it, and every call in it is CSS.
 */
import { isThenable, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import { compressDimensionBytes } from './compress.js';
import { channelKind, formChannelValues, formColor, type FormChannels, type Hsla, type MutableChannels, type Rgba } from './css-color.js';
import { cssMath, isDimension } from './css-math.js';
import { buildEvaluator } from './evaluator.js';
import type { Fn, ParamSpec } from './functions/types.js';
import { keyword, type AnonymousMixin } from './nodes.js';
import { evalFormChannel, evalFormResult, formActivation, formChannelLane, formLane, type BindingCell, type FormActivation } from './serialize.js';
import { bindDirect, createFnRegistry, defineFunction } from './value-dispatch.js';
import { HEX, RGB } from './color.js';
import { isValueGroupArray, type Color, type Dimension, type Value, type ValueGroup } from './value-eval.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { DimensionValueNode } from './node-ctors.js';
import { makeColorHsl, makeColorRgb, makeDimension, withFields } from './value-factory.js';
import { groupItems } from './value-list.js';
import { insideParens, keepAsWritten } from './value-operate.js';
import { negated } from './math-operand.js';

/**
 * A channel of a relative colour's form that reads the origin: a small form over
 * values and channel names ({@link FormSlot}).
 */
class ChannelForm {
  constructor(readonly form: AnonymousMixin, readonly args: readonly FormSlot[]) {}
}

export const channelForm = (form: AnonymousMixin, ...args: readonly FormSlot[]): ChannelForm => new ChannelForm(form, args);

/**
 * What a form's parameter binds: a value, or what is read when the parameter is,
 * so that it reads the origin's channels where they are bound and prints as
 * written where they are not: a string, the name of a channel, or a {@link ChannelForm}.
 */
export type FormSlot = ValueGroup | string | ChannelForm;

/** A form and what its parameters bind, the first of them the value its result's format follows. */
export type FormCall = readonly [form: AnonymousMixin, input: ValueGroup, ...rest: readonly FormSlot[]];

type Lane = ReturnType<typeof formLane>;

/** A form lane, and its one lane for a colour's channels with the values they read. */
interface FormLane {
  readonly lane: Lane;
  readonly channelLane: Lane;
  readonly channels: MutableChannels;
}

const lanes: Array<FormLane | undefined> = [undefined, undefined];

function newLane(compress: boolean): FormLane {
  const lane = formLane(buildEvaluator(createFnRegistry(), { cssMath }), compress);
  const channels = formChannelValues();
  return { lane, channels, channelLane: formChannelLane(lane, channels) };
}

/**
 * The one place a resolved form's result takes its spelling (V10). A relative
 * `hsl()` keeps its input's format, in legacy syntax whatever its input's (Q14,
 * not yet ruled). A `color-mix()` keeps its input's format, or the one its
 * built-in names once translucent, in legacy syntax (Q14). A built-in that names
 * a format has it, in legacy syntax. Any other keeps its input's format and syntax until the result is translucent,
 * when a hex that had no alpha digit of its own turns to `rgb()`.
 */
function spelled(channels: FormChannels, out: Hsla | Rgba, input: Color | Dimension, format: number | undefined): Color {
  if (channels.space === 'hsl' && input.type === 'Color') {
    return makeColorHsl([out[0], out[1], out[2]], out[3], out[3] < 1 && input.alpha >= 1 && input.format === HEX ? RGB : input.format);
  }
  if (channels.space === 'mix' && input.type === 'Color') {
    return makeColorRgb([out[0], out[1], out[2]], out[3], out[3] < 1 ? format ?? input.format : input.format);
  }
  if (format !== undefined || input.type !== 'Color') {
    return makeColorRgb([out[0], out[1], out[2]], out[3], format ?? RGB);
  }
  return makeColorRgb([out[0], out[1], out[2]], out[3], out[3] < 1 ? translucentHex(input) : input.format, { modernSyntax: input.modernSyntax === true });
}

/** A translucent result's format from a colour without its own: hex only from a hex with an alpha digit. */
function translucentHex({ format, src }: Color): number {
  const hexDigits = typeof src === 'string' && src.startsWith('#') ? src.length - 1 : 0;
  return format === HEX && (hexDigits === 4 || hexDigits === 8) ? HEX : RGB;
}

/** The input a form computes from: the colour a relative form reads, or the first channel of an absolute one. */
const knownInput = (channels: FormChannels, input: Value): Color | Dimension | undefined =>
  input.type === 'Color' ? (channels.relative ? input : undefined) : input.type === 'Dimension' && !channels.relative ? input : undefined;

/** A form still unknown is a built-in's result, read by its type (Q10). */
const deferred = (out: ValueGroup): ValueGroup =>
  !isValueGroupArray(out) && out.type === 'FunctionCall' ? keepAsWritten(withFields(out, { computed: true })) : out;

/**
 * What a form's parameter binds: the call inside any paren group, which is what a
 * callable reads (J16). The form's math is written around a `calc()` it reads, so
 * no `calc()` prints inside it.
 */
function bound(value: ValueGroup | undefined): ValueGroup | null {
  if (value === undefined) {
    return null;
  }
  if (isValueGroupArray(value) || value.type !== 'FunctionCall') {
    return value;
  }
  const call = insideParens(value);
  if (call.name === 'calc' && !call.computed) {
    return keepAsWritten(withFields(call, { computed: true }));
  }

  /* A glued minus is one function token to CSS, invalid here as anywhere it is read as a number. */
  return negated(call);
}

/** A form's math over numbers it knows, the channels it reads standing unbound; a number that cannot be spelled fails the call. */
const computed = (out: ValueGroup): ValueGroup =>
  isDimension(out) && out.bytes === '' ? makeDimension(out.number, out.unit) : out;

/** What prints a form spells the numbers it read, under `compress` as compressed. */
function spellCells(cells: readonly BindingCell[], compress: boolean): void {
  for (const cell of cells) {
    const value = cell.evaluated;
    if (value !== null && isDimension(value) && (compress || value.bytes === '')) {
      const bytes = value.bytes === '' ? makeDimension(value.number, value.unit).bytes : value.bytes;
      cell.evaluated = new DimensionValueNode(value.number, value.unit, compress ? compressDimensionBytes(bytes) : bytes);
    }
  }
}

/** A channel form's activation in each slot of a call, as two slots can hold the same form. */
const channelActivations: Array<Map<AnonymousMixin, FormActivation> | undefined> = [];

function channelActivation(form: AnonymousMixin, slot: number): FormActivation {
  const own = channelActivations[slot] ?? (channelActivations[slot] = new Map());
  let activation = own.get(form);
  if (activation === undefined) {
    activation = formActivation(form);
    own.set(form, activation);
  }
  return activation;
}

/** What a channel a template leaves to a parameter is: what this call bound there (`hsl(from $c $h $s $l)`). */
function boundKinds({ slots }: FormChannels, call: FormCall): readonly number[] {
  return slots.map((slot) => {
    if (isValueSlotArray(slot) || slot.type !== 'Lookup') {
      return channelKind(slot);
    }
    const index = call[0].params?.findIndex(param => param.name === slot.name) ?? -1;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- every element after a FormCall's form is what a parameter binds.
    const value = call[index + 1] as FormSlot | undefined;
    return value instanceof ChannelForm
      ? channelKind(channelActivation(value.form, index).result)
      : typeof value === 'object' && isDimension(value) ? 0 : 2;
  });
}

function bindSlot(cell: BindingCell, value: FormSlot | undefined, slot: number, compress: boolean): void {
  if (typeof value === 'string') {
    cell.value = keyword(value);
    cell.evaluated = null;
  } else if (value instanceof ChannelForm) {
    const { cells, result, frame } = channelActivation(value.form, slot);
    for (let i = 0; i < cells.length; i++) {
      bindSlot(cells[i]!, value.args[i], slot, compress);
    }
    spellCells(cells, compress);
    cell.value = result;
    cell.valueFrame = frame;
    cell.evaluated = null;
  } else {
    cell.evaluated = bound(value);
  }
}

/**
 * A built-in's CSS form over evaluated arguments: a stylesheet function with its
 * parameters bound to the values, so nothing is evaluated twice. Known inputs
 * compute it first: they need no written-out call, which is what anything not
 * known prints.
 */
function evalForm(form: FormActivation, call: FormCall, lanes: FormLane, format: number | undefined): MaybePromise<ValueGroup> {
  const { frame, cells, channels, result } = form;
  const { channelLane, lane } = lanes;
  const compress = lane.compress === true;
  for (let i = 0; i < cells.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- every element after a FormCall's form is what a parameter binds.
    bindSlot(cells[i]!, call[i + 1] as FormSlot | undefined, i, compress);
  }
  const input = call[1];
  const amount = call[2];
  if (channels === undefined && isDimension(input) && (amount === undefined || (typeof amount === 'object' && !(amount instanceof ChannelForm) && isDimension(amount)))) {
    return mapMaybe(evalFormChannel(result, frame, channelLane), computed);
  }
  const origin = channels === undefined || isValueGroupArray(input) ? undefined : knownInput(channels, input);
  if (channels !== undefined && origin !== undefined) {
    const out = formColor(channels, origin, lanes.channels, slot => evalFormChannel(slot, frame, channelLane), channels.parameters ? boundKinds(channels, call) : channels.kinds);
    if (out !== undefined && !isThenable(out)) {
      return spelled(channels, out, origin, format);
    }
  }
  spellCells(cells, compress);
  return mapMaybe(evalFormResult(form, lane), deferred);
}

/**
 * A function defined by a CSS form. `form` picks the form and its arguments
 * from the bound parameters, or gives the colour when the form cannot compute it
 * (`contrast-color()`'s algorithm is the browser's). A parameter takes what only the browser knows when
 * its type includes `FunctionCall`; any other reads a call as it always has.
 *
 * `filter`: the name is also a CSS filter function, so one argument of a number
 * only the browser knows fails as a known number does, and the dispatch writes
 * out one of no known type where the call may be the filter (`filter-position.ts`).
 */
export function defineForm(name: string, spec: { readonly params: readonly ParamSpec[]; readonly form: (...args: never[]) => FormCall | Color; readonly format?: number; readonly filter?: boolean }): Fn {
  const activations = new Map<AnonymousMixin, FormActivation>();
  return defineFunction(name, {
    params: spec.params,
    variadic: true,
    filter: spec.filter,
    body: (args: ValueGroup, ctx: { readonly modes: { readonly compress?: boolean } }): MaybePromise<ValueGroup> => {
      const items = groupItems(args);
      const lone = items[0];
      if (spec.filter === true && items.length === 1 && lone !== undefined && !isValueGroupArray(lone) && lone.type === 'FunctionCall' && lone.result === 'numeric') {
        throw new TypeError(`${name}: arg 0 expected Color, got a number`);
      }
      const call: FormCall | Color = Reflect.apply(spec.form, undefined, bindDirect(name, spec.params, items));
      if ('type' in call) {
        return call;
      }
      const form = call[0];
      const slot = ctx.modes.compress === true ? 1 : 0;
      const lane = lanes[slot] ?? (lanes[slot] = newLane(slot === 1));
      let activation = activations.get(form);
      if (activation === undefined) {
        activation = formActivation(form);
        activations.set(form, activation);
      }
      return evalForm(activation, call, lane, spec.format);
    }
  });
}
