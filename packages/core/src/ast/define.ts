/**
 * The lean function definer and binder. Each parameter carries its own check,
 * an imported function (`{ type: 'Color', check: checkColor }`), so a function
 * bundles only the checks it names: a runtime page over `lightness` carries the colour check
 * and nothing of the other value types (R8 spec, stage 4).
 * `defineFunction` (`value-dispatch.ts`) is this definer over specs that give
 * a `type` alone, which it fills with the general check.
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { isValueGroup, isValueGroupArray, type Collection, type Value, type ValueGroup } from './value-eval.js';
import { groupItems } from './value-list.js';
import { callKeyword, makeCollection } from './value-factory.js';
import { keepAsWritten } from './value-operate.js';
import type { Check, DefinedFunction, Fn, FnCtx, FunctionBodyArgs, Kind, LazyValue, ParamSpec } from './functions/types.js';

export function valueNode(name: string, value: unknown): ValueGroup {
  if (!isValueGroup(value)) {
    throw new TypeError(`${name}: each argument must be a value node`);
  }
  return value;
}

/** A call written out as-is is read as the keyword that spells it. */
const isWritten = (value: Value): value is Extract<Value, { readonly type: 'FunctionCall' | 'Arithmetic' }> => value.type === 'FunctionCall' || value.type === 'Arithmetic';

/** A value with a call written out as-is read as the keyword that spells it. */
export const readWritten = (value: Value): Value => isWritten(value) ? keepAsWritten(callKeyword(value)) : value;

export function mismatch(name: string, index: number, kind: string, value: ValueGroup): TypeError {
  const got = isValueGroupArray(value) ? 'sequence' : isWritten(value) ? 'Keyword' : value.type;
  return new TypeError(`${name}: arg ${index} expected ${kind}, got ${got}`);
}

/** The check of a parameter of one value type, which takes neither a call nor a name (`checkDimension`). */
function only(kind: Kind, name: string, index: number, input: unknown): ValueGroup {
  const value = valueNode(name, input);
  if (!isValueGroupArray(value) && value.type === kind) {
    return value;
  }
  throw mismatch(name, index, kind, value);
}

/*
 * A parameter is an object literal that names its check, `{ type: 'Color',
 * check: checkColor }`: never a call or a spread, so a bundler drops the checks
 * a page does not use (the published core is minified, which strips purity
 * annotations).
 */

/** Any value. */
export const checkAny = (name: string, _index: number, value: unknown): ValueGroup => valueNode(name, value);
export const checkDimension = (name: string, index: number, value: unknown): ValueGroup => only('Dimension', name, index, value);
export const checkQuoted = (name: string, index: number, value: unknown): ValueGroup => only('Quoted', name, index, value);
export const checkBool = (name: string, index: number, value: unknown): ValueGroup => only('Bool', name, index, value);
export const checkNull = (name: string, index: number, value: unknown): ValueGroup => only('Null', name, index, value);
export const checkList = (name: string, index: number, value: unknown): ValueGroup => only('List', name, index, value);
export const checkUrl = (name: string, index: number, value: unknown): ValueGroup => only('Url', name, index, value);
export const checkBlock = (name: string, index: number, value: unknown): ValueGroup => only('Block', name, index, value);

/**
 * A colour. A colour name is read as that colour where the call's context reads
 * names ({@link FnCtx.colorName}): `lighten(red, 10%)` binds `#ff0000`. A
 * keyword that is not a name, and a call written out as-is, fail the slot.
 */
export function checkColor(name: string, index: number, input: unknown, colorName: FnCtx['colorName']): ValueGroup {
  const value = valueNode(name, input);
  const bound = !isValueGroupArray(value) && value.type === 'Keyword' ? colorName?.(value) ?? value : value;
  if (!isValueGroupArray(bound) && bound.type === 'Color') {
    return bound;
  }
  throw mismatch(name, index, 'Color', bound);
}

/** A keyword. A call written out as-is is the keyword that spells it. */
export function checkKeyword(name: string, index: number, input: unknown): ValueGroup {
  const value = valueNode(name, input);
  const bound = isValueGroupArray(value) ? value : readWritten(value);
  if (!isValueGroupArray(bound) && bound.type === 'Keyword') {
    return bound;
  }
  throw mismatch(name, index, 'Keyword', bound);
}

/*
 * The empty list is also the empty map, so it satisfies a `Collection` slot as
 * that map at the bind point, as Sass reads it: `map.get((), a)` is `null` and
 * `map.merge((), (z: 9))` is `(z: 9)` (Sass's empty `()` is the empty curly
 * list, owner 2026-10-23: *"so that Sass functions still work"*).
 */
let empty: Collection | undefined;

/** The empty map, built when first read, so only a page that reads one bundles it. */
export const emptyCollection = (): Collection => empty ??= makeCollection([]);
export const isListShaped = (value: ValueGroup): boolean =>
  isValueGroupArray(value) || value.type === 'List' || value.type === 'Block';

/** A map; the empty list is the empty map. */
export function checkCollection(name: string, index: number, input: unknown): ValueGroup {
  const value = valueNode(name, input);
  const bound = groupItems(value).length === 0 && isListShaped(value) ? emptyCollection() : value;
  if (!isValueGroupArray(bound) && bound.type === 'Collection') {
    return bound;
  }
  throw mismatch(name, index, 'Collection', bound);
}

/**
 * Whether `input` is core's absent value: an implicit `null`, never one the
 * author wrote. A call that names a later parameter by keyword fills each
 * parameter it skipped with it (`orderKeywordArgs`), so an optional parameter
 * reads it as an argument that was not passed. Checked by shape, not identity:
 * a provided module may run on a second copy of core.
 */
const isAbsent = (input: unknown): boolean =>
  input === undefined || (isValueGroup(input) && !isValueGroupArray(input) && input.type === 'Null' && !input.explicit);

/*
 * A parameter's binding beyond one checked value is a wrapper over its check,
 * so a function bundles only the bindings it uses. Each keeps the flag the
 * types and the keyword ordering read. `optional` and `withDefault` go
 * outermost: `optional(lazy(param))`.
 */

/** `param` with `flags` and the check that binds it: a new object, so the spec passed in is left as it is. */
const wrapped = <P extends ParamSpec, F extends object>(param: P, flags: F, check: Check): P & F => ({ ...param, ...flags, check });

/** A parameter that may be left out; the body receives `undefined`. */
export const optional = <const P extends ParamSpec>(param: P): P & { readonly optional: true } => {
  const check = checkOf(param);
  return wrapped(param, { optional: true } as const, (name, index, input, colorName, type, inputs) => isAbsent(input) ? undefined : check(name, index, input, colorName, type, inputs));
};

/** A parameter that may be left out; the body receives `value`. */
export const withDefault = <const P extends ParamSpec, const D extends ValueGroup>(param: P, value: D): P & { readonly default: D } => {
  const check = checkOf(param);
  return wrapped(param, { default: value } as const, (name, index, input, colorName, type, inputs) => isAbsent(input) ? value : check(name, index, input, colorName, type, inputs));
};

/** A parameter the body receives as a thunk, checked when it is called. A value given as-is is its own thunk. */
export const lazy = <const P extends ParamSpec>(param: P): P & { readonly lazy: true } => {
  const check = checkOf(param);
  return wrapped(param, { lazy: true } as const, (name, index, input, colorName, type, inputs): LazyValue => {
    const thunk = typeof input === 'function' ? input : () => input;
    return () => {
      const value: unknown = thunk();
      return value instanceof Promise
        ? value.then((result: unknown) => valueNode(name, check(name, index, result, colorName, type, inputs)))
        : valueNode(name, check(name, index, value, colorName, type, inputs));
    };
  });
};

/** The last parameter, which takes every argument from its slot on, as an array (one array given there is taken as those arguments). */
export const rest = <const P extends ParamSpec>(param: P): P & { readonly rest: true } => {
  const check = checkOf(param);
  return wrapped(param, { rest: true } as const, (name, index, input, colorName, type, inputs) => {
    const items: readonly unknown[] = inputs.length === index + 1 && Array.isArray(input) ? input : inputs.slice(index);
    return items.map(item => check(name, index, item, colorName, type, inputs));
  });
};

function checkOf(param: ParamSpec, name = 'define'): Check {
  if (param.check === undefined) {
    throw new TypeError(`${name}: a parameter has no check; define the function with defineFunction`);
  }
  return param.check;
}

/** Each parameter's value through its check, in order; a check that binds more than one value is a wrapper's ({@link rest}). */
export function bindDirect(name: string, params: readonly ParamSpec[], inputs: readonly unknown[], colorName?: FnCtx['colorName']): unknown[] {
  const out: unknown[] = [];
  for (let index = 0; index < params.length; index++) {
    const param = params[index]!;
    const input = inputs[index];
    if (input === undefined && param.optional !== true && param.rest !== true && param.default === undefined) {
      throw new TypeError(`${name}: missing required argument ${param.name ?? index}`);
    }
    out.push(checkOf(param, name)(name, index, input, colorName, param.type, inputs));
  }
  if (inputs.length > params.length && params.at(-1)?.rest !== true) {
    throw new TypeError(`${name}: too many arguments`);
  }
  return out;
}

type VariadicBody = (args: readonly ValueGroup[], ctx: FnCtx) => MaybePromise<ValueGroup>;

/** A variadic spec's body takes the arguments and the context. */
const isVariadic = <S extends { readonly variadic?: boolean }>(spec: S): spec is S & { readonly body: VariadicBody } => spec.variadic === true;

/**
 * A function over the call's arguments ({@link Fn}). A positional body receives
 * each parameter's value, checked by its parameter's check, a `lazy` one as a
 * thunk, a `rest` one as an array; a variadic body receives the arguments and
 * the {@link FnCtx}.
 */
export function define<const P extends readonly ParamSpec[]>(
  name: string,
  spec: {
    readonly params: P;
    readonly body: (...args: FunctionBodyArgs<NoInfer<P>>) => MaybePromise<ValueGroup>;
    readonly variadic?: false;
    readonly filter?: boolean;
    readonly cssFunction?: never;
  },
): DefinedFunction<P>;
export function define(
  name: string,
  spec: {
    readonly params: readonly ParamSpec[];
    readonly body: (args: readonly ValueGroup[], ctx: FnCtx) => MaybePromise<ValueGroup>;
    readonly variadic: true;
    readonly filter?: boolean;
    readonly cssFunction?: never;
  },
): Fn;
export function define(
  name: string,
  spec: {
    readonly params: readonly ParamSpec[];
    readonly body: (...args: never[]) => MaybePromise<ValueGroup>;
    readonly variadic?: boolean;
    readonly filter?: boolean;
    readonly cssFunction?: never;

    /** Runs over the bound arguments before the body (`defineFunction`'s CSS-function decline). */
    readonly afterBind?: (bound: readonly unknown[]) => void;
  },
): Fn;
export function define(
  name: string,
  spec: {
    readonly params: readonly ParamSpec[];
    readonly body: (...args: never) => MaybePromise<ValueGroup>;
    readonly variadic?: boolean;
    readonly filter?: boolean;
    readonly cssFunction?: never;
    readonly afterBind?: (bound: readonly unknown[]) => void;
  }
): unknown {
  /* Each closure reads only constants captured here, never the caller's spec literal, whose key set varies by caller. */
  let callable: VariadicBody;
  const { params, afterBind } = spec;
  if (isVariadic(spec)) {
    const { body } = spec;
    callable = (args, ctx) => body(args, ctx);
  } else {
    const { body } = spec;
    callable = (args, ctx) => {
      const bound = bindDirect(name, params, args, ctx.colorName);
      afterBind?.(bound);
      return Reflect.apply(body, undefined, bound);
    };
  }
  const fn = Object.assign(callable, { params, variadic: spec.variadic, filter: spec.filter });
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  return fn;
}
