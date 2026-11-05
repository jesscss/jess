/**
 * A built-in whose definition is its CSS form: an ordinary stylesheet function
 * parsed once at the build of the package that ships it, evaluated on arguments
 * the call evaluated. Known inputs compute through the one evaluator
 * ({@link resolveHsl}), a value only the browser knows leaves the form printed,
 * so a call and its form are one value (docs/design/CSS-NATIVE-BUILTINS.md §2,
 * §3.3).
 *
 * A form runs on a lane of its own, with no function registered: it is not in
 * the document that called it, and every call in it is CSS.
 */
import { isThenable, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import { compressDimensionBytes } from './compress.js';
import { formChannelValues, relativeHsla, type Hsla, type MutableChannels } from './css-color.js';
import { cssMath, isDimension } from './css-math.js';
import { buildEvaluator } from './evaluator.js';
import type { Fn, ParamSpec } from './functions/types.js';
import type { AnonymousMixin } from './nodes.js';
import { evalFormChannel, evalFormResult, formActivation, formChannelLane, formLane, type BindingCell, type FormActivation } from './serialize.js';
import { bindDirect, createFnRegistry, defineFunction } from './value-dispatch.js';
import { isValueGroupArray, type Color, type ValueGroup } from './value-eval.js';
import { makeColorHsl, makeDimension, withFields } from './value-factory.js';
import { groupItems } from './value-list.js';
import { insideParens, keepAsWritten } from './value-operate.js';

/** A form and the values its parameters bind to, the first of them the one its result's format follows. */
export type FormCall = readonly [form: AnonymousMixin, input: ValueGroup, amount?: ValueGroup, one?: ValueGroup];

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
 * The one place a resolved form's result takes its spelling: a colour keeps its
 * input's format (V10), in legacy syntax whatever its input's (Q14, not yet
 * ruled).
 */
const spelled = (hsla: Hsla, input: Color): Color =>
  makeColorHsl([hsla[0], hsla[1], hsla[2]], hsla[3], input.format);

/** A form still unknown is a built-in's result, read by its type (Q10). */
const deferred = (out: ValueGroup): ValueGroup =>
  !isValueGroupArray(out) && out.type === 'FunctionCall' ? keepAsWritten(withFields(out, { computed: true })) : out;

/** What a form's parameter binds: the call inside any paren group, which is what a callable reads (J16). */
const bound = (value: ValueGroup | undefined): ValueGroup | null =>
  value === undefined ? null : !isValueGroupArray(value) && value.type === 'FunctionCall' ? insideParens(value) : value;

/** A form's math over numbers it knows, the channels it reads standing unbound; a number that cannot be spelled fails the call. */
const computed = (out: ValueGroup): ValueGroup =>
  isDimension(out) ? makeDimension(out.number, out.unit) : out;

/** What prints a form spells the numbers it read, under `compress` as compressed. */
function spellCells(cells: readonly BindingCell[], compress: boolean): void {
  for (const cell of cells) {
    const value = cell.evaluated;
    if (value !== null && isDimension(value) && (compress || value.bytes === '')) {
      const bytes = value.bytes === '' ? makeDimension(value.number, value.unit).bytes : value.bytes;
      cell.evaluated = withFields(value, { bytes: compress ? compressDimensionBytes(bytes) : bytes });
    }
  }
}

/**
 * A built-in's CSS form over evaluated arguments: a stylesheet function with its
 * parameters bound to the values, so nothing is evaluated twice. Known inputs
 * compute it first: they need no written-out call, which is what anything not
 * known prints.
 */
function evalForm(form: FormActivation, call: FormCall, lanes: FormLane): MaybePromise<ValueGroup> {
  const { frame, cells, channels, result } = form;
  cells[0]!.evaluated = bound(call[1]);
  if (cells.length > 1) {
    cells[1]!.evaluated = bound(call[2]);
    if (cells.length > 2) {
      cells[2]!.evaluated = bound(call[3]);
    }
  }
  const input = call[1];
  const amount = call[2];
  const known = amount === undefined || isDimension(amount);
  const { channelLane, lane } = lanes;
  if (known && isDimension(input)) {
    return mapMaybe(evalFormChannel(result, frame, channelLane), computed);
  }
  if (known && channels !== undefined && !isValueGroupArray(input) && input.type === 'Color') {
    const hsla = relativeHsla(channels, input, lanes.channels, slot => evalFormChannel(slot, frame, channelLane));
    if (hsla !== undefined && !isThenable(hsla)) {
      return spelled(hsla, input);
    }
  }
  spellCells(cells, lane.compress === true);
  return mapMaybe(evalFormResult(form, lane), deferred);
}

/**
 * A function defined by a CSS form. `form` picks the form and its arguments
 * from the bound parameters. A parameter takes what only the browser knows when
 * its type includes `FunctionCall`; any other reads a call as it always has.
 */
export function defineForm(name: string, spec: { readonly params: readonly ParamSpec[]; readonly form: (...args: never[]) => FormCall }): Fn {
  const activations = new Map<AnonymousMixin, FormActivation>();
  return defineFunction(name, {
    params: spec.params,
    variadic: true,
    body: (args: ValueGroup, ctx: { readonly modes: { readonly compress?: boolean } }): MaybePromise<ValueGroup> => {
      const call: FormCall = Reflect.apply(spec.form, undefined, bindDirect(name, spec.params, groupItems(args)));
      const form = call[0];
      const slot = ctx.modes.compress === true ? 1 : 0;
      const lane = lanes[slot] ?? (lanes[slot] = newLane(slot === 1));
      let activation = activations.get(form);
      if (activation === undefined) {
        activation = formActivation(form);
        activations.set(form, activation);
      }
      return evalForm(activation, call, lane);
    }
  });
}
