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
import { mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import { buildEvaluator } from './evaluator.js';
import type { Fn, ParamSpec } from './functions/types.js';
import type { AnonymousMixin } from './nodes.js';
import { evalForm, formLane } from './serialize.js';
import { bindDirect, createFnRegistry, defineFunction } from './value-dispatch.js';
import { isValueGroupArray, type Color, type ValueGroup } from './value-eval.js';
import { colorRawRgb, makeColorHsl, makeColorRgb, withFields } from './value-factory.js';
import { groupItems } from './value-list.js';
import { keepAsWritten } from './value-operate.js';

/** A form and the values its parameters bind to, the first of them the one its result's format follows. */
export type FormCall = readonly [form: AnonymousMixin, ...args: ValueGroup[]];

const lanes: Array<ReturnType<typeof formLane> | undefined> = [undefined, undefined];
const evaluator = buildEvaluator(createFnRegistry());

/**
 * The one place a resolved form's result takes its spelling. A colour keeps its
 * input's format (V10) and syntax, modern in, modern out (Q14). A form still
 * unknown is a built-in's result, read by its type (Q10).
 */
function resultOf(out: ValueGroup, input: ValueGroup | undefined): ValueGroup {
  if (isValueGroupArray(out)) {
    return out;
  }
  if (out.type === 'FunctionCall') {
    return keepAsWritten(withFields(out, { computed: true }));
  }
  return out.type === 'Color' && input !== undefined && !isValueGroupArray(input) && input.type === 'Color' ? spelledAs(out, input) : out;
}

function spelledAs(color: Color, input: Color): Color {
  const modernSyntax = input.modernSyntax === true;
  return color.hsl === undefined
    ? makeColorRgb(colorRawRgb(color), color.alpha, input.format, { modernSyntax })
    : makeColorHsl(color.hsl, color.alpha, input.format, modernSyntax);
}

/**
 * A function defined by a CSS form. `form` picks the form and its arguments
 * from the bound parameters. A parameter takes what only the browser knows when
 * its type includes `FunctionCall`; any other reads a call as it always has.
 */
export function defineForm(name: string, spec: { readonly params: readonly ParamSpec[]; readonly form: (...args: never[]) => FormCall }): Fn {
  return defineFunction(name, {
    params: spec.params,
    variadic: true,
    body: (args: ValueGroup, ctx: { readonly modes: { readonly compress?: boolean } }): MaybePromise<ValueGroup> => {
      const called: FormCall = Reflect.apply(spec.form, undefined, bindDirect(name, spec.params, groupItems(args)));
      const [form, ...values] = called;
      const slot = ctx.modes.compress === true ? 1 : 0;
      const lane = lanes[slot] ?? (lanes[slot] = formLane(evaluator, slot === 1));
      return mapMaybe(evalForm(form, values, lane), out => resultOf(out, values[0]));
    }
  });
}
