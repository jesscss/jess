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
import { formChannelValues, formColor, type FormChannels, type Hsla, type MutableChannels, type Rgba } from './css-color.js';
import { buildEvaluator } from './evaluator.js';
import type { Fn, ParamSpec } from './functions/types.js';
import type { AnonymousMixin } from './nodes.js';
import { evalFormChannel, evalFormResult, formActivation, formChannelLane, formLane, type FormActivation } from './serialize.js';
import { bindDirect, createFnRegistry, defineFunction } from './value-dispatch.js';
import { HEX, RGB } from './color.js';
import { isValueGroupArray, type Color, type Dimension, type Value, type ValueGroup } from './value-eval.js';
import { makeColorHsl, makeColorRgb, withFields } from './value-factory.js';
import { groupItems } from './value-list.js';
import { insideParens, keepAsWritten } from './value-operate.js';

/** A form and the values its parameters bind to, the first of them the one its result's format follows. */
export type FormCall = readonly [form: AnonymousMixin, input: ValueGroup, ...rest: readonly ValueGroup[]];

type Lane = ReturnType<typeof formLane>;

/** A form lane, and its one lane for a colour's channels with the values they read. */
interface FormLane {
  readonly lane: Lane;
  readonly channelLane: Lane;
  readonly channels: MutableChannels;
}

const lanes: Array<FormLane | undefined> = [undefined, undefined];

function newLane(compress: boolean): FormLane {
  const lane = formLane(buildEvaluator(createFnRegistry()), compress);
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
    return makeColorHsl([out[0], out[1], out[2]], out[3], input.format);
  }
  if (channels.space === 'mix' && input.type === 'Color') {
    return makeColorRgb([out[0], out[1], out[2]], out[3], out[3] < 1 ? format ?? input.format : input.format);
  }
  if (format !== undefined || input.type !== 'Color') {
    return makeColorRgb([out[0], out[1], out[2]], out[3], format ?? RGB);
  }
  const { src } = input;
  const hexDigits = typeof src === 'string' && src.startsWith('#') ? src.length - 1 : 0;
  const translucent = input.format === HEX && (hexDigits === 4 || hexDigits === 8) ? HEX : RGB;
  return makeColorRgb([out[0], out[1], out[2]], out[3], out[3] < 1 ? translucent : input.format, { modernSyntax: input.modernSyntax === true });
}

/** The input a form computes from: the colour a relative form reads, or the first channel of an absolute one. */
const knownInput = (channels: FormChannels, input: Value): Color | Dimension | undefined =>
  input.type === 'Color' ? (channels.relative ? input : undefined) : input.type === 'Dimension' && !channels.relative ? input : undefined;

/** A form still unknown is a built-in's result, read by its type (Q10). */
const deferred = (out: ValueGroup): ValueGroup =>
  !isValueGroupArray(out) && out.type === 'FunctionCall' ? keepAsWritten(withFields(out, { computed: true })) : out;

/** What a form's parameter binds: the call inside any paren group, which is what a callable reads (J16). */
const bound = (value: ValueGroup | undefined): ValueGroup | null =>
  value === undefined ? null : !isValueGroupArray(value) && value.type === 'FunctionCall' ? insideParens(value) : value;

/**
 * A built-in's CSS form over evaluated arguments: a stylesheet function with its
 * parameters bound to the values, so nothing is evaluated twice. A known origin
 * decides first: the colour needs no written-out call, which is what anything
 * not known prints.
 */
function evalForm(form: FormActivation, call: FormCall, lanes: FormLane, format: number | undefined): MaybePromise<ValueGroup> {
  const { frame, cells, channels } = form;
  for (let i = 0; i < cells.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- every element after a FormCall's form is a value.
    cells[i]!.evaluated = bound(call[i + 1] as ValueGroup | undefined);
  }
  const input = call[1];
  const known = channels === undefined || isValueGroupArray(input) ? undefined : knownInput(channels, input);
  if (channels !== undefined && known !== undefined) {
    const { channelLane } = lanes;
    const out = formColor(channels, known, lanes.channels, slot => evalFormChannel(slot, frame, channelLane));
    if (out !== undefined && !isThenable(out)) {
      return spelled(channels, out, known, format);
    }
  }
  const lane = lanes.lane;
  if (lane.compress === true) {
    for (const cell of cells) {
      const value = cell.evaluated;
      if (value !== null && !isValueGroupArray(value) && value.type === 'Dimension') {
        cell.evaluated = withFields(value, { bytes: compressDimensionBytes(value.bytes) });
      }
    }
  }
  return mapMaybe(evalFormResult(form, lane), deferred);
}

/**
 * A function defined by a CSS form. `form` picks the form and its arguments
 * from the bound parameters, or gives the colour when the form cannot compute it
 * (`contrast-color()`'s algorithm is the browser's). A parameter takes what only the browser knows when
 * its type includes `FunctionCall`; any other reads a call as it always has.
 */
export function defineForm(name: string, spec: { readonly params: readonly ParamSpec[]; readonly form: (...args: never[]) => FormCall | Color; readonly format?: number }): Fn {
  const activations = new Map<AnonymousMixin, FormActivation>();
  return defineFunction(name, {
    params: spec.params,
    variadic: true,
    body: (args: ValueGroup, ctx: { readonly modes: { readonly compress?: boolean } }): MaybePromise<ValueGroup> => {
      const call: FormCall | Color = Reflect.apply(spec.form, undefined, bindDirect(name, spec.params, groupItems(args)));
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
