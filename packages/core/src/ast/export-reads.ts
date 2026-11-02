import { combineAll, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Fn } from './functions/types.js';
import { fnOrigin, type FnOrigin } from './module-values.js';
import { funcCall, keyword, type CallValue, type Declaration, type FunctionCall, type Stylesheet, type VariableDeclaration } from './nodes.js';
import { emitValue, isValueGroupArray, type EvalModes, type EvalValue, type ValueGroup } from './value-eval.js';
import { writeCall } from './evaluator.js';
import { makeKeyword, makeList } from './value-factory.js';

/**
 * Ledger A4: a root variable marked `@export` publishes a custom property, so a
 * CSS value that reads it IS `var(--name, <its value>)`, and a value a
 * function Jess computes from it is a generated custom property the runtime
 * recomputes (docs/architecture/core/spec/R8-browser-runtime.md).
 */

/**
 * How the runtime computes a value derived from exports: an export's value, an
 * argument's compile-time CSS, or an imported function of those.
 */
export type ExportRecipe = { readonly export: string } | { readonly fn: FnOrigin; readonly args: ReadonlyArray<ExportRecipe | string> };

/** What the runtime module is generated from ({@link ExportState.runtime}). */
export interface ExportRuntime {
  /** Every name the root exports. */
  readonly exports: readonly string[];

  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Map<string, string>;

  /** Each generated custom property, by its name, with how the runtime computes it. */
  readonly derived: Map<string, ExportRecipe>;
}

/**
 * What the runtime module is generated from, as data (`SerializeResult.runtime`):
 * every exported name, the compile-time CSS of each one a derived value reads,
 * and each generated custom property with how it is computed.
 */
export interface ExportRuntimeData {
  readonly exports: readonly string[];
  readonly defaults: Readonly<Record<string, string>>;
  readonly derived: Readonly<Record<string, ExportRecipe>>;
}

/** A render's `runtime` result field: none when nothing is exported. */
export function runtimeData(x: ExportState<unknown> | undefined): { runtime?: ExportRuntimeData } {
  return x === undefined
    ? {}
    : { runtime: { exports: x.runtime.exports, defaults: Object.fromEntries(x.runtime.defaults), derived: Object.fromEntries(x.runtime.derived) } };
}

/** A mixin argument as written, in the caller's frame. */
interface ExportSource<F> {
  readonly value: CallValue;
  readonly frame: F;
  readonly evaluated: null;
}

/**
 * A variable read that resolves to an export: a root binding of it, which a
 * CSS value writes as `call`; or a mixin argument bound from one, whose
 * snapshot already writes the `var()` and which a computed function reads as
 * written (`source`).
 */
type ExportRef<F> =
  | { readonly name: string; readonly call: FunctionCall; readonly source?: undefined }
  | { readonly name?: undefined; readonly call?: undefined; readonly source: ExportSource<F> };

/** One render's exports ({@link rootExports}). */
export interface ExportState<F> {
  /** By what a variable read resolves to. */
  readonly refs: Map<object, ExportRef<F>>;

  /** The exports read as the arguments of the computed call being evaluated, each with the value it read. */
  inputs: Array<{ readonly recipe: ExportRecipe; readonly value: object }> | undefined;

  /** Whether the mixin argument being bound reads an export. */
  argument: boolean;

  readonly runtime: ExportRuntime;
}

/** What an export read needs from the evaluator's lane (serialize.ts `Lane`). */
export interface ExportLane<F> {
  /** The declaration whose value is being written, `'argument'` while a mixin argument is bound, else undefined. */
  readonly checks: Declaration | 'argument' | undefined;
  readonly modes: EvalModes;
  readonly s: { readonly context: Context | undefined; readonly exports: ExportState<F> | undefined };
}

/** The `reader` of a variable read that handles an exported binding itself. */
export const READS_EXPORT = {};

/**
 * Every root binding of a name the root exports, each with the call it reads
 * as. A root redeclaration of the name is the export too; a shadow in a nested
 * scope is a different binding and is not. Undefined when nothing is exported.
 */
export function rootExports<F>(root: Stylesheet): ExportState<F> | undefined {
  let names: Set<string> | undefined;
  for (const statement of root.rules) {
    if (statement.type === 'VariableDeclaration' && statement.write.mode === 'export') {
      (names ??= new Set()).add(statement.name);
    }
  }
  if (names === undefined) {
    return undefined;
  }
  const refs = new Map<object, ExportRef<F>>();
  for (const statement of root.rules) {
    if (statement.type === 'VariableDeclaration' && names.has(statement.name)
      && (isValueSlotArray(statement.value) || statement.value.type !== 'MixinCall')) {
      refs.set(statement.value, { name: statement.name, call: funcCall('var', [keyword(`--${statement.name}`), statement.value]) });
    }
  }
  return { refs, inputs: undefined, argument: false, runtime: { exports: [...names], defaults: new Map(), derived: new Map() } };
}

/**
 * A resolved variable read, checked for an export. Read where a CSS value is
 * written, or bound as a mixin argument, an exported binding resolves to its
 * `var()` call, which then evaluates as the call an author would write: kept in
 * `calc()`, `color-mix()` and any call written as-is, an operand error in math
 * outside a calculation. Anywhere else a `var()` cannot stand in, and the read
 * is an error.
 */
export function exportChecked<F, H extends { value: CallValue; frame: F; evaluated: unknown }>(
  hit: H | undefined,
  name: string,
  lookup: 'live' | 'scoped',
  e: ExportLane<F>,
  reader: object | undefined
): H | { value: FunctionCall; frame: F; evaluated: null } | undefined {
  const x = e.s.exports;
  const ref = hit === undefined || reader === READS_EXPORT ? undefined : x?.refs.get(hit.value);
  if (ref === undefined || x === undefined || hit === undefined) {
    return hit;
  }
  if (e.checks === 'argument') {
    x.argument = true;
  } else if (typeof e.checks !== 'object') {
    exportNotWritten(reader, lookup === 'live' ? `$${name}` : `@${name}`, name, e,
      'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
  }
  return ref.call === undefined ? hit : { value: ref.call, frame: hit.frame, evaluated: null };
}

/**
 * A variable read a function Jess computes takes as input (`@less.lightness(@c)`),
 * resolved with {@link READS_EXPORT}. The function computes on the export's
 * compile-time value, read through the mixin argument that holds it, if one
 * does; {@link exportInputRead} records the read for the call
 * ({@link exportCall}). A function that does not record its inputs, such as a
 * plugin's, cannot be run by the runtime, so an export is an error there.
 */
export function exportInput<F, H extends { value: CallValue }>(hit: H | undefined, name: string, reader: object, e: ExportLane<F>): H | ExportSource<F> | undefined {
  const ref = hit === undefined ? undefined : e.s.exports?.refs.get(hit.value);
  if (ref === undefined) {
    return hit;
  }
  if (e.s.exports?.inputs === undefined) {
    exportNotWritten(reader, `@${name}`, name, e, 'as the input of a function the runtime cannot run');
  }
  return ref.source ?? hit;
}

/** The value a computed function's input read evaluated to, recorded when the read was an export's root binding ({@link exportInput}). */
export function exportInputRead<V extends ValueGroup>(e: ExportLane<unknown>, hit: { value: CallValue }, value: MaybePromise<V>): MaybePromise<V> {
  const x = e.s.exports;
  const name = x?.inputs === undefined ? undefined : x.refs.get(hit.value)?.name;
  return name === undefined
    ? value
    : mapMaybe(value, (read) => {
        x?.inputs?.push({ recipe: { export: name }, value: read });
        x?.runtime.defaults.set(name, emitValue(read));
        return read;
      });
}

/**
 * Bind a mixin argument (`bind`), noting whether it reads an export. One that
 * does is kept for the value it evaluated to, as the argument as written
 * (`source`) in the caller's `frame`; the snapshot the parameter binds as takes
 * it over (`invalid-value-syntax.ts` `keepArgumentSyntax`).
 */
export function exportArgument<F, V extends object>(
  x: ExportState<F> | undefined,
  source: CallValue,
  frame: F | null,
  bind: () => MaybePromise<V>
): MaybePromise<V> {
  if (x === undefined) {
    return bind();
  }
  const outer = x.argument;
  let read = false;
  let value: MaybePromise<V>;
  x.argument = false;
  try {
    value = bind();
  } finally {
    read = x.argument;
    x.argument = outer || read;
  }
  return read && frame !== null
    ? mapMaybe(value, (bound) => {
        x.refs.set(bound, { source: { value: source, frame, evaluated: null } });
        return bound;
      })
    : value;
}

/**
 * A computed call, evaluated as `args` then `dispatch`, in a document that
 * exports a variable; `fn` is its callable, undefined when the caller resolved
 * none. When its arguments read exports, it is
 * computed on their compile-time values and recorded: as an input of the
 * computed call it is an argument of, or else as a generated custom property,
 * `var(--<export>-<fn>, <compile-time result>)`, which the runtime recomputes
 * when an export it reads is set. An argument that holds an export inside a
 * larger value (`@w 2`) cannot be followed, and the call is an error.
 */
export function exportCall<F>(
  e: ExportLane<F>,
  node: FunctionCall,
  fn: Fn | undefined,
  args: () => Array<MaybePromise<ValueGroup>>,
  dispatch: (args: Array<MaybePromise<ValueGroup>>) => MaybePromise<EvalValue>
): MaybePromise<EvalValue> {
  const x = e.s.exports;
  if (x === undefined) {
    return dispatch(args());
  }
  const outer = x.inputs;
  let typed: Array<MaybePromise<ValueGroup>>;
  let inputs: NonNullable<ExportState<F>['inputs']> = [];
  x.inputs = inputs;
  try {
    typed = args();
  } finally {
    inputs = x.inputs;
    x.inputs = outer;
  }
  if (inputs.length === 0) {
    return dispatch(typed);
  }
  return combineAll(typed, vals => mapMaybe(dispatch(vals), (computed) => {
    const result: ValueGroup = typeof computed === 'string' ? makeKeyword(computed) : computed;
    const recipe = callRecipe(node, fn, vals, inputs, e);
    if (outer !== undefined) {
      outer.push({ recipe, value: result });
      return result;
    }
    if (typeof e.checks !== 'object' && e.checks !== 'argument') {
      exportNotWritten(node, `${node.name}()`, recipeExport(recipe), e,
        'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
    }
    return writeCall('var', makeList([makeKeyword(derivedName(x.runtime, recipe)), result], ','), e.modes);
  }));
}

/** The recipe of a call whose arguments read exports; each argument either is one of `inputs` or holds none. */
function callRecipe<F>(node: FunctionCall, fn: Fn | undefined, vals: readonly ValueGroup[], inputs: NonNullable<ExportState<F>['inputs']>, e: ExportLane<F>): ExportRecipe {
  const lone = (v: ValueGroup): ValueGroup => isValueGroupArray(v) && v.length === 1 ? v[0]! : v;
  const origin = fn === undefined ? undefined : fnOrigin(fn);
  if (origin === undefined) {
    exportNotWritten(node, `${node.name}()`, recipeExport(inputs[0]!.recipe), e, 'as the input of a function the runtime cannot run');
  }
  const stray = inputs.find(input => !vals.some(v => lone(v) === input.value));
  if (stray !== undefined) {
    exportNotWritten(node, `${node.name}()`, recipeExport(stray.recipe), e, 'inside a larger argument of a function Jess computes, which the runtime cannot follow');
  }
  return { fn: origin, args: vals.map(v => inputs.find(input => input.value === lone(v))?.recipe ?? emitValue(v)) };
}

/** The first export a recipe reads. */
function recipeExport(recipe: ExportRecipe): string {
  if ('export' in recipe) {
    return recipe.export;
  }
  for (const arg of recipe.args) {
    if (typeof arg !== 'string') {
      return recipeExport(arg);
    }
  }
  return '';
}

/** The generated custom property a recipe writes: one name per recipe, `--<export>-<fn>`, numbered when another recipe has it. */
function derivedName(runtime: ExportRuntime, recipe: ExportRecipe): string {
  const fn = 'fn' in recipe ? recipe.fn.name : 'value';
  const base = `--${recipeExport(recipe)}-${fn}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    const taken = runtime.derived.get(name);
    if (taken === undefined || sameRecipe(taken, recipe)) {
      runtime.derived.set(name, recipe);
      return name;
    }
  }
}

function sameRecipe(a: ExportRecipe | string, b: ExportRecipe | string): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  if ('export' in a || 'export' in b) {
    return 'export' in a && 'export' in b && a.export === b.export;
  }
  return a.fn.module === b.fn.module && a.fn.name === b.fn.name && a.args.length === b.args.length && a.args.every((arg, i) => sameRecipe(arg, b.args[i]!));
}

/** An exported variable read where a `var()` cannot replace it. */
function exportNotWritten(reader: object | undefined, symbol: string, name: string, e: ExportLane<unknown>, where: string): never {
  const node = reader ?? {};
  throw ERR.exportNotAValue({ node, ...callSiteLocation(node, e.s), meta: { symbol, name, where } });
}

/** `@export` publishes a stylesheet's top-level variable; one in a body (`nested`) is an error. */
export function rejectNestedExport(node: VariableDeclaration, nested: boolean, e: ExportLane<unknown>): void {
  if (node.write.mode === 'export' && nested) {
    throw ERR.exportNotTopLevel({ node, ...callSiteLocation(node, e.s) });
  }
}
