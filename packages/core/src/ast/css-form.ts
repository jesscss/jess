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
import { isModernHsl, relativeHsla, type Hsla } from './css-color.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { buildEvaluator } from './evaluator.js';
import type { Fn, ParamSpec } from './functions/types.js';
import type { AnonymousMixin } from './nodes.js';
import { channelBinder, evalFormResult, formActivation, formLane, type FormActivation } from './serialize.js';
import { bindDirect, createFnRegistry, defineFunction } from './value-dispatch.js';
import { isValueGroupArray, type Color, type ValueGroup } from './value-eval.js';
import { makeColorHsl, withFields } from './value-factory.js';
import { groupItems } from './value-list.js';
import { keepAsWritten } from './value-operate.js';

/** A form and the values its parameters bind to, the first of them the one its result's format follows. */
export type FormCall = readonly [form: AnonymousMixin, ...args: ValueGroup[]];

type FormLane = ReturnType<typeof formLane>;

const lanes: Array<FormLane | undefined> = [undefined, undefined];

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

/**
 * A built-in's CSS form over evaluated arguments: a stylesheet function with its
 * parameters bound to the values, so nothing is evaluated twice. A known origin
 * decides first: the colour needs no written-out call, which is what anything
 * not known prints.
 */
function evalForm(form: FormActivation, args: readonly ValueGroup[], lane: FormLane): MaybePromise<ValueGroup> {
  const { frame, cells, result } = form;
  for (let i = 0; i < cells.length; i++) {
    cells[i]!.evaluated = args[i] ?? null;
  }
  const input = args[0];
  if (input !== undefined && !isValueGroupArray(input) && input.type === 'Color' && !isValueSlotArray(result) && result.type === 'FunctionCall' && isModernHsl(result)) {
    const hsla = relativeHsla(result, input, channelBinder(frame, lane));
    if (hsla !== undefined && !isThenable(hsla)) {
      return spelled(hsla, input);
    }
  }
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
 * from the bound parameters. A parameter takes what only the browser knows when
 * its type includes `FunctionCall`; any other reads a call as it always has.
 */
export function defineForm(name: string, spec: { readonly params: readonly ParamSpec[]; readonly form: (...args: never[]) => FormCall }): Fn {
  const activations = new Map<AnonymousMixin, FormActivation>();
  return defineFunction(name, {
    params: spec.params,
    variadic: true,
    body: (args: ValueGroup, ctx: { readonly modes: { readonly compress?: boolean } }): MaybePromise<ValueGroup> => {
      const [form, ...values]: FormCall = Reflect.apply(spec.form, undefined, bindDirect(name, spec.params, groupItems(args)));
      const slot = ctx.modes.compress === true ? 1 : 0;
      const lane = lanes[slot] ?? (lanes[slot] = formLane(buildEvaluator(createFnRegistry()), slot === 1));
      let activation = activations.get(form);
      if (activation === undefined) {
        activation = formActivation(form);
        activations.set(form, activation);
      }
      return evalForm(activation, values, lane);
    }
  });
}
