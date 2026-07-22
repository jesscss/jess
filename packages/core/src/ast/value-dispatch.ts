/**
 * Lean typed KIND-DISPATCH + fn registry for the value domain — replaces
 * `define-function.ts`'s `instanceof` coercion. Each built-in fn declares its
 * accepted param `kind`(s) + optionality (its `Fn` spec, co-located with its
 * body in `functions/<fn>.ts`); the registry validates/binds positionally by kind
 * and calls the body. The fn set is CALLER-POPULATED (`registerAll(FN_LIST)`), not
 * hard-imported here, so a later stage can move the fns to `@jesscss/fns` and
 * register them from the consumer without touching this module. Deliberately
 * minimal (owner complexity guardrail): a spec table, NOT a rebuilt coercion monster.
 *
 * HARD MODULE BOUNDARY: value domain + built-in fns only.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { List, ValueObj } from './value-eval.js';
import type {
  DefinedFunction,
  Fn,
  FnCtx,
  FnRecord,
  FnSpec,
  FunctionBodyArgs,
  LazyValue,
  ParamSpec,
  ValueForKinds
} from './functions/types.js';

/**
 * Dispatch a single resolved {@link Fn} spec over the typed arg `List` — the shared
 * primitive behind both the registry's by-name dispatch and the scope-frame path
 * (`ast/` `@plugin`/`@use` fns arrive as a `Fn` object, not a registry key). A
 * variadic fn receives the whole `List` + {@link FnCtx}; a positional fn binds
 * `list.value` by kind and is spread. This evaluator route never forwards a
 * named-record argument; dialects such as Less therefore stay positional-only.
 */
export function dispatchFn(fn: Fn, list: List, ctx: FnCtx): MaybePromise<ValueObj> {
  return fn(list, ctx);
}

type NamedParam = ParamSpec & { readonly name: string };
type DirectInput = ValueObj | LazyValue;

function isRecord(value: DirectInput | FnRecord): value is FnRecord {
  return typeof value === 'object' && value !== null && !('type' in value);
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

function isValueObj(value: unknown): value is ValueObj {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function validateValue<K extends ParamSpec['kinds']>(name: string, index: number, kinds: K, value: unknown): ValueForKinds<K> {
  if (!isValueObj(value)) {
    throw new TypeError(`${name}: direct calls require typed ValueObj arguments`);
  }
  if (kinds !== 'any' && !kinds.includes(value.type)) {
    throw new TypeError(`${name}: arg ${index} expected ${kinds.join('|')}, got ${value.type}`);
  }
  return value as ValueForKinds<K>;
}

function checkedLazy<K extends ParamSpec['kinds']>(
  name: string,
  index: number,
  kinds: K,
  thunk: unknown
): LazyValue<ValueForKinds<K>> {
  if (typeof thunk !== 'function') {
    throw new TypeError(`${name}: lazy argument ${index} must be a thunk`);
  }
  return () => {
    const value = thunk();
    if (value instanceof Promise) {
      return value.then(result => validateValue(name, index, kinds, result));
    }
    return validateValue(name, index, kinds, value);
  };
}

function bindDirect(name: string, params: readonly NamedParam[], inputs: readonly DirectInput[]): unknown[] {
  const out: unknown[] = [];
  let offset = 0;
  for (let index = 0; index < params.length; index++) {
    const param = params[index]!;
    if (param.rest) {
      const supplied = inputs[offset];
      const rest = inputs.length === offset + 1 && Array.isArray(supplied)
        ? supplied
        : inputs.slice(offset);
      out.push(param.lazy
        ? rest.map(value => checkedLazy(name, index, param.kinds, value))
        : rest.map(value => validateValue(name, index, param.kinds, value)));
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
      throw new TypeError(`${name}: missing required argument ${param.name}`);
    }
    out.push(param.lazy
      ? checkedLazy(name, index, param.kinds, input)
      : validateValue(name, index, param.kinds, input));
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
export function defineFunction<const P extends readonly NamedParam[]>(
  name: string,
  spec: {
    readonly params: P;
    readonly body: (...args: FunctionBodyArgs<P>) => MaybePromise<ValueObj>;
    readonly variadic?: false;
  },
): DefinedFunction<P>;
export function defineFunction(name: string, spec: FnSpec & { readonly name?: string }): Fn;
export function defineFunction(
  name: string,
  spec: unknown
): unknown {
  const definition = spec as FnSpec & { readonly params: readonly NamedParam[] };
  const callable = (...args: readonly unknown[]): MaybePromise<ValueObj> => {
    const [first, second] = args;
    if (isValueObj(first) && first.type === 'List' && second && typeof second === 'object' && 'modes' in second) {
      const list = first as List;
      const ctx = second as FnCtx;
      if (definition.variadic) {
        return (definition as FnSpec & { readonly variadic: true }).body(list, ctx);
      }
      const positional = definition.params.map((param, index) => param.lazy
        ? () => list.value[index]!
        : list.value[index]);
      return Reflect.apply(definition.body, undefined, bindDirect(name, definition.params, positional)) as MaybePromise<ValueObj>;
    }
    const positional = positionalFromInputs(definition.params, args as readonly (DirectInput | FnRecord)[]);
    if (definition.variadic) {
      throw new TypeError(`${name}: direct calls to variadic functions require a List and FnCtx`);
    }
    return Reflect.apply(definition.body, undefined, bindDirect(name, definition.params, positional)) as MaybePromise<ValueObj>;
  };
  const fn = callable as Fn;
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  Object.assign(fn, { params: definition.params, variadic: definition.variadic });
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
   * Dispatch a call by name over the typed arg `List`. A VARIADIC fn receives the
   * whole `List` (value + separator/bracket metadata) plus the minimal {@link FnCtx} (modes + the
   * value→string host hook) so a list / rest fn can recover the real elements and a
   * context-sensitive Tier-B fn can serialize / read the separator; a positional fn
   * binds `list.value` by kind and needs no context.
   */
  dispatch(name: string, list: List, ctx: FnCtx): MaybePromise<ValueObj>;
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
    dispatch(name, list, ctx) {
      const spec = table.get(name.toLowerCase());
      if (!spec) {
        throw new Error(`no fn: ${name}`);
      }
      return dispatchFn(spec, list, ctx);
    }
  };
}
