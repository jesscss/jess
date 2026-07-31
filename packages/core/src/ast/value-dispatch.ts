/**
 * Lean typed dispatch + fn registry for the value domain. Each fn declares the
 * semantic value node type(s) it accepts (`type: 'Color'`, `type:
 * ['Keyword', 'Quoted']`, or `type: 'any'`), and the registry validates/binds
 * positionally before calling the tiny function body. The fn set is
 * CALLER-POPULATED (`registerAll(FN_LIST)`), not hard-imported here.
 *
 * HARD MODULE BOUNDARY: value domain + built-in fns only.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { isValueGroup, isValueGroupArray, type ValueGroup } from './value-eval.js';
import { groupItems } from './value-list.js';
import type {
  DefinedFunction,
  Fn,
  FnCtx,
  FnRecord,
  FnSpec,
  FunctionBodyArgs,
  Kind,
  LazyValue,
  ParamSpec
} from './functions/types.js';

/**
 * Dispatch a single resolved {@link Fn} spec over the typed argument group — the shared
 * primitive behind both the registry's by-name dispatch and the scope-frame path
 * (`ast/` `@plugin`/`@use` fns arrive as a `Fn` object, not a registry key). A
 * variadic fn receives the whole group + {@link FnCtx}; a positional fn binds
 * its structural items by kind and is spread. This evaluator route never forwards a
 * named-record argument; dialects such as Less therefore stay positional-only.
 */
export function dispatchFn(fn: Fn, value: ValueGroup, ctx: FnCtx): MaybePromise<ValueGroup> {
  return fn(value, ctx);
}

type NamedParam = ParamSpec & { readonly name: string };
type DirectInput = ValueGroup | LazyValue;
const VALUE_TYPES: ReadonlySet<string> = new Set([
  'Dimension',
  'Color',
  'Quoted',
  'Keyword',
  'Any',
  'List',
  'Block',
  'Bool',
  'Nil',
  'Collection'
]);

function isRecord(value: unknown): value is FnRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !('type' in value);
}

function positionalFromInputs(params: readonly NamedParam[], inputs: readonly (DirectInput | FnRecord)[]): DirectInput[] {
  const positional = inputs.filter((input): input is DirectInput => !isRecord(input));
  const records = inputs.filter(isRecord);
  for (const record of records) {
    for (let index = 0; index < params.length; index++) {
      const param = params[index]!;
      if (Object.prototype.hasOwnProperty.call(record, param.name) && positional[index] === undefined) {
        positional[index] = record[param.name]!;
      }
    }
  }
  return positional;
}

function isLazyValue(value: unknown): value is LazyValue {
  return typeof value === 'function';
}

type NormalizedParamType = readonly Kind[] | 'any';

function isValueForType(value: ValueGroup, type: NormalizedParamType): boolean {
  return type === 'any' || (!isValueGroupArray(value) && type.some(kind => kind === value.type));
}

function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && VALUE_TYPES.has(value);
}

function normalizeParamType(value: unknown): readonly Kind[] | 'any' | null {
  if (value === 'any') {
    return 'any';
  }
  if (isKind(value)) {
    return [value];
  }
  if (Array.isArray(value) && value.every(isKind)) {
    return value;
  }
  return null;
}

function paramType(param: ParamSpec): NormalizedParamType {
  const normalized = normalizeParamType(param.type ?? param.kinds);
  if (normalized === null) {
    throw new TypeError('function parameter must declare a value type');
  }
  return normalized;
}

function isFnCtx(value: unknown): value is FnCtx {
  return typeof value === 'object'
    && value !== null
    && 'modes' in value
    && 'stringify' in value
    && typeof value.stringify === 'function';
}

function isParamSpec(value: unknown): value is ParamSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { readonly type?: unknown; readonly kinds?: unknown };
  return normalizeParamType(record.type ?? record.kinds) !== null;
}

function isNamedParam(value: unknown): value is NamedParam {
  return isParamSpec(value) && 'name' in value && typeof value.name === 'string';
}

function isFnSpec(value: unknown): value is FnSpec {
  return typeof value === 'object'
    && value !== null
    && 'params' in value
    && Array.isArray(value.params)
    && value.params.every(isParamSpec)
    && 'body' in value
    && typeof value.body === 'function';
}

function hasNamedParams(value: FnSpec): value is FnSpec & { readonly params: readonly NamedParam[] } {
  return value.params.every(isNamedParam);
}

function toDirectInput(value: unknown): DirectInput | FnRecord {
  if (isValueGroup(value) || isRecord(value) || isLazyValue(value)) {
    return value;
  }
  throw new TypeError('direct calls require typed value nodes, named-record, or lazy arguments');
}

function validateValue(name: string, index: number, type: NormalizedParamType, value: unknown): ValueGroup {
  if (!isValueGroup(value)) {
    throw new TypeError(`${name}: direct calls require structural value arguments`);
  }
  if (!isValueForType(value, type)) {
    const expected = type === 'any' ? 'any' : type.join('|');
    throw new TypeError(`${name}: arg ${index} expected ${expected}, got ${isValueGroupArray(value) ? 'sequence' : value.type}`);
  }
  return value;
}

function checkedLazy(
  name: string,
  index: number,
  type: NormalizedParamType,
  thunk: unknown
): LazyValue<ValueGroup> {
  if (typeof thunk !== 'function') {
    throw new TypeError(`${name}: lazy argument ${index} must be a thunk`);
  }
  return () => {
    const value = thunk();
    if (value instanceof Promise) {
      return value.then(result => validateValue(name, index, type, result));
    }
    return validateValue(name, index, type, value);
  };
}

function bindDirect(name: string, params: readonly ParamSpec[], inputs: readonly (DirectInput | undefined)[]): unknown[] {
  const out: unknown[] = [];
  let offset = 0;
  for (let index = 0; index < params.length; index++) {
    const param = params[index]!;
    if (param.rest) {
      const supplied = inputs[offset];
      const rest = inputs.length === offset + 1 && Array.isArray(supplied)
        ? supplied
        : inputs.slice(offset);
      const type = paramType(param);
      out.push(param.lazy
        ? rest.map(value => checkedLazy(name, index, type, value))
        : rest.map(value => validateValue(name, index, type, value)));
      offset = inputs.length;
      continue;
    }
    const input = inputs[offset++];
    if (input === undefined) {
      if (param.default !== undefined) {
        out.push(param.default);
        continue;
      }
      if (param.optional) {
        out.push(undefined);
        continue;
      }
      throw new TypeError(`${name}: missing required argument ${param.name ?? index}`);
    }
    const type = paramType(param);
    out.push(param.lazy
      ? checkedLazy(name, index, type, input)
      : validateValue(name, index, type, input));
  }
  if (offset < inputs.length) {
    throw new TypeError(`${name}: too many arguments`);
  }
  return out;
}

/**
 * Define a callable canonical value function. Direct Sass/Jess embeddings may
 * use named records (including mixed positional/record calls); evaluator routes
 * call the same function with `(List, FnCtx)` and do not expose that capability.
 */
export function defineFunction<const P extends readonly ParamSpec[]>(
  name: string,
  spec: {
    readonly params: P;
    readonly body: (...args: FunctionBodyArgs<NoInfer<P>>) => MaybePromise<ValueGroup>;
    readonly variadic?: false;
  },
): DefinedFunction<P>;
export function defineFunction<const P extends readonly ParamSpec[]>(
  name: string,
  spec: {
    readonly params: P;
    readonly body: (...args: never[]) => MaybePromise<ValueGroup>;
    readonly variadic?: false;
  },
): DefinedFunction<P>;
export function defineFunction(name: string, spec: FnSpec & { readonly name?: string }): Fn;
export function defineFunction(
  name: string,
  spec: unknown
): unknown {
  if (!isFnSpec(spec)) {
    throw new TypeError(`${name}: function definition must contain params and a callable body`);
  }
  const definition = spec;
  const callable = (...args: readonly unknown[]): MaybePromise<ValueGroup> => {
    const [first, second] = args;
    if (isValueGroup(first) && isFnCtx(second)) {
      const value = first;
      const ctx: FnCtx = second;
      if (definition.variadic) {
        return definition.body(value, ctx);
      }

      /*
       * Evaluator invocation stays positional: a raw nested group is still ONE
       * argument, `bindDirect` accepts it only for `type: 'any'` and rejects it
       * for a typed scalar parameter, and flattening would destroy ordinary
       * adjacency.
       *
       * The array is built from the SUPPLIED items, never from `params`. Mapping
       * over `params` silently truncated every call to the declared arity, which
       * made `bindDirect`'s `too many arguments` throw unreachable from this
       * route and starved a `rest` parameter of everything past its own slot.
       * Each index is governed by its own parameter, or by the `rest` parameter
       * once the declared slots run out, so `lazy` is honoured for rest items too.
       */
      const items = groupItems(value);
      const restParam = definition.params.find(param => param.rest);
      const positional = items.map((item, index) => (definition.params[index] ?? restParam)?.lazy
        ? () => items[index]!
        : item);
      return Reflect.apply(definition.body, undefined, bindDirect(name, definition.params, positional));
    }
    const inputs = args.map(toDirectInput);
    const named = hasNamedParams(definition);
    if (inputs.some(isRecord) && !named) {
      throw new TypeError(`${name}: named records require parameter names`);
    }
    const positional = named
      ? positionalFromInputs(definition.params, inputs)
      : inputs.filter((input): input is DirectInput => !isRecord(input));
    if (definition.variadic) {
      throw new TypeError(`${name}: direct calls to variadic functions require a List and FnCtx`);
    }
    return Reflect.apply(definition.body, undefined, bindDirect(name, definition.params, positional));
  };
  const fn = Object.assign(callable, { params: definition.params, variadic: definition.variadic });
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  return fn;
}

/**
 * A caller-populated table of built-in fns plus the dispatch over it. Fn `name`s
 * are lower-case; lookups fold case.
 */
export interface FnRegistry {
  /** Register a single fn (overwrites any prior entry with the same name). */
  register(fn: Fn): void;

  /** Register every fn in a list (bulk `register`). */
  registerAll(fns: readonly Fn[]): void;

  /** Whether a built-in implementation exists for `name`. */
  has(name: string): boolean;

  /**
   * Dispatch a call by name over the typed argument group. A VARIADIC fn receives the
   * whole group plus the minimal {@link FnCtx} (modes + the
   * value→string host hook) so a list / rest fn can recover the real elements and a
   * context-sensitive Tier-B fn can serialize / read the separator; a positional fn
   * binds structural items by kind and needs no context.
   */
  dispatch(name: string, value: ValueGroup, ctx: FnCtx): MaybePromise<ValueGroup>;
}

/** Create an empty {@link FnRegistry}; the caller populates it via `registerAll`. */
export function createFnRegistry(): FnRegistry {
  const table = new Map<string, Fn>();

  // Keys are stored lower-cased so lookups (also lower-cased) can't silently miss.
  return {
    register(fn) {
      table.set(fn.name.toLowerCase(), fn);
    },
    registerAll(fns) {
      for (const fn of fns) {
        table.set(fn.name.toLowerCase(), fn);
      }
    },
    has(name) {
      return table.has(name.toLowerCase());
    },
    dispatch(name, value, ctx) {
      const spec = table.get(name.toLowerCase());
      if (!spec) {
        throw new Error(`no fn: ${name}`);
      }
      return dispatchFn(spec, value, ctx);
    }
  };
}
