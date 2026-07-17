import type { JsFunction } from '@jesscss/core';

/**
 * Shared structural types and narrowing guards for the Less.js compatibility
 * runtime. The Less plugin / function / node values crossing the bridge are
 * genuinely dynamic (plugins may be objects, constructors, or plain functions,
 * and Less-created nodes carry ad-hoc shapes), so this module models them with
 * precise structural interfaces plus guards rather than `any`.
 */

/**
 * A Less.js-compatible custom/plugin function. Called with the Jess eval context
 * as `this`; arguments and the return value are dynamic Less/Jess values.
 * Plugins may attach arbitrary metadata onto the function object.
 */
export interface LessFunction {
  (this: unknown, ...args: unknown[]): unknown;
}

/** Sink that forwards Less functions into a Jess function registry. */
export interface JessFunctionSink {
  add(name: string, func: LessFunction): void;
  get?(name: string): unknown;
}

/** A Jess Rules scope that can hold and resolve function bindings. */
export interface FunctionBindingScope {
  setFunctionBinding(name: string, fn: JsFunction): void;
  findFunction(name: string): unknown;
}

/** Registry that binds Less functions onto a {@link FunctionBindingScope}. */
export interface JessBindingRegistry {
  add(name: string, func: JsFunction | LessFunction): void;
  get(name: string): JsFunction | undefined;
}

/**
 * A Less plugin supplied as a function value. In JavaScript any function can be
 * invoked or `new`-constructed, and Less probes both; this models that surface.
 */
export interface PluginFn {
  (...args: unknown[]): unknown;
  new (...args: unknown[]): unknown;
  prototype?: unknown;
}

/**
 * The mock Less.js `functions.functionRegistry` the compat layer hands to
 * plugins. Mirrors the Less.js registry API (add/addMultiple/get/inherit/…).
 */
export interface LessFunctionRegistry {
  readonly _data: Record<string, LessFunction>;
  _base: LessFunctionRegistry | null;
  add(name: string, func: LessFunction): void;
  addMultiple(functions: Record<string, LessFunction>): void;
  get(name: string): unknown;
  getLocalFunctions(): Record<string, LessFunction>;
  inherit(): LessFunctionRegistry;
  create(base: LessFunctionRegistry | null): LessFunctionRegistry;
}

/** `true` when `x` can be called. */
export const isCallable = (x: unknown): x is (...args: unknown[]) => unknown =>
  typeof x === 'function';

/** Narrow a function value to the invokable/constructable {@link PluginFn} shape. */
export const isPluginFn = (x: unknown): x is PluginFn => typeof x === 'function';

/** Array guard that preserves `unknown` elements (unlike `Array.isArray`'s `any[]`). */
export const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);

/**
 * Fields the compat layer reads off dynamic Less/Jess node-ish values. Every key
 * is optional `unknown` so a widening assertion from `unknown` is safe (a plain
 * object structurally satisfies it), unlike an index-signature assertion.
 */
interface FieldProbe {
  type?: unknown;
  name?: unknown;
  value?: unknown;
  prelude?: unknown;
  parent?: unknown;
  caller?: unknown;
  root?: unknown;
  functions?: unknown;
  supportedExtensions?: unknown;
}

/** Methods the compat layer probes for on dynamic Less/Jess values. */
interface MethodProbe {
  setFunctionBinding?: unknown;
  findFunction?: unknown;
  install?: unknown;
  importLessPlugin?: unknown;
  setOptions?: unknown;
  valueOf?: unknown;
  process?: unknown;
}

/** `true` when `x[key]` is a callable method. Narrows `x` to expose that method. */
export const hasMethod = <K extends keyof MethodProbe>(
  x: unknown,
  key: K
): x is Record<K, (...args: unknown[]) => unknown> =>
  x !== null
  && (typeof x === 'object' || typeof x === 'function')
  && typeof (x as MethodProbe)[key] === 'function';

/** Read a known field of an unknown object/function value, else `undefined`. */
export const getProp = <K extends keyof FieldProbe>(x: unknown, key: K): unknown =>
  x !== null && (typeof x === 'object' || typeof x === 'function')
    ? (x as FieldProbe)[key]
    : undefined;

/** `true` when `v` is a thenable (used to await Less plugin function results). */
export const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v
  && (typeof v === 'object' || typeof v === 'function')
  && typeof (v as { then?: unknown }).then === 'function';

/**
 * Structural guard for Less/Jess nodes that expose an `eval(context)` method.
 * Used by the @plugin function wrappers to evaluate node arguments before
 * handing them to legacy Less plugin functions.
 */
export const hasEvalMethod = (
  x: unknown
): x is { eval: (c: unknown) => unknown; evaluated?: boolean } =>
  !!x
  && (typeof x === 'object' || typeof x === 'function')
  && typeof (x as { eval?: unknown }).eval === 'function';

/** Structural guard for nodes that expose a `removeFlag` mutator. */
export const hasRemoveFlag = (x: unknown): x is { removeFlag: (flag: number) => void } =>
  !!x && typeof (x as { removeFlag?: unknown }).removeFlag === 'function';

/**
 * The evaluation context's statement-context flag: a bound function is called in
 * "statement context" when its caller sits directly inside a Rules body. Mirrors
 * `this?.caller?.parent?.type === 'Rules'` without asserting the context shape.
 */
export const isStatementContext = (ctx: unknown): boolean => {
  const caller = getProp(ctx, 'caller');
  const parent = getProp(caller, 'parent');
  return getProp(parent, 'type') === 'Rules';
};
