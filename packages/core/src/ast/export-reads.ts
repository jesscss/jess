import { combineAll, isThenable, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Fn } from './functions/types.js';
import type { FnOrigin } from './module-values.js';
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
  readonly exports: ReadonlySet<string>;

  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Map<string, string>;

  /** Each generated custom property, by its name, with how the runtime computes it. */
  readonly derived: Map<string, ExportRecipe>;

  /** Each generated custom property's name, by its recipe as JSON: one name per recipe, however the call is spelled. */
  readonly named: Map<string, string>;
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
    : { runtime: { exports: [...x.runtime.exports], defaults: Object.fromEntries(x.runtime.defaults), derived: Object.fromEntries(x.runtime.derived) } };
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
  | { readonly name?: undefined; readonly call?: undefined; readonly source: ExportSource<F> | undefined };

/** A rest parameter or `@arguments` holding a mixin argument that reads an export among others: a read a `var()` cannot replace. */
const IN_ARGUMENTS: ExportRef<never> = { name: undefined, call: undefined, source: undefined };

/**
 * What a variable read's value resolves to, as an export: its own ref, or for a
 * rest parameter or `@arguments` (a list of bound arguments) the ref of its one
 * argument, or {@link IN_ARGUMENTS} when one of several reads an export.
 */
function refOf<F>(x: ExportState<F>, value: CallValue): ExportRef<F> | undefined {
  const ref = x.refs.get(value);
  if (ref !== undefined || !isValueSlotArray(value)) {
    return ref;
  }
  if (value.length === 1) {
    return x.refs.get(value[0]!);
  }
  return value.some(slot => x.refs.has(slot)) ? IN_ARGUMENTS : undefined;
}

/**
 * A mixin argument being bound: whether it reads an export. A computed call
 * still pending when the argument's binding is decided marks it as it settles.
 */
export interface ExportArgument {
  read: boolean;
}

/** An export a computed call's argument reads, with the value it read. */
interface ExportInput {
  readonly recipe: ExportRecipe;
  readonly value: object;
}

/** One render's exports ({@link rootExports}). */
export interface ExportState<F> {
  /** By what a variable read resolves to. */
  readonly refs: Map<object, ExportRef<F>>;

  /**
   * The exports read as the arguments of the computed call being evaluated,
   * each with the value it read; undefined outside a computed call.
   */
  inputs: Array<ExportInput> | undefined;

  /** The mixin argument being bound, undefined outside one. */
  argument: ExportArgument | undefined;

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
      refs.set(statement.value, { name: statement.name, call: funcCall('var', [keyword(`--${statement.name}`), statement.value]), source: undefined });
    }
  }
  return { refs, inputs: undefined, argument: undefined, runtime: { exports: names, defaults: new Map(), derived: new Map(), named: new Map() } };
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
  const ref = hit === undefined || reader === READS_EXPORT || x === undefined ? undefined : refOf(x, hit.value);
  if (ref === undefined || x === undefined || hit === undefined) {
    return hit;
  }
  if (e.checks === 'argument') {
    markArgument(x.argument);
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
  const x = e.s.exports;
  const ref = hit === undefined || x === undefined ? undefined : refOf(x, hit.value);
  if (ref === undefined) {
    return hit;
  }
  if (x?.inputs === undefined) {
    exportNotWritten(reader, `@${name}`, name, e, 'as the input of a function the runtime cannot run');
  }
  if (ref === IN_ARGUMENTS) {
    exportNotWritten(reader, `@${name}`, name, e, 'inside a larger argument of a function Jess computes, which the runtime cannot follow');
  }
  return ref.source ?? hit;
}

/** The value a computed function's input read evaluated to, recorded when the read was an export's root binding ({@link exportInput}). */
export function exportInputRead<V extends ValueGroup>(e: ExportLane<unknown>, hit: { value: CallValue }, value: MaybePromise<V>): MaybePromise<V> {
  const x = e.s.exports;
  const inputs = x?.inputs;
  const name = inputs === undefined ? undefined : x?.refs.get(hit.value)?.name;
  return name === undefined || x === undefined || inputs === undefined
    ? value
    : mapMaybe(value, (read) => {
        inputs.push({ recipe: { export: name }, value: read });
        if (!x.runtime.defaults.has(name)) {
          x.runtime.defaults.set(name, emitValue(read));
        }
        return read;
      });
}

/** Note that the mixin argument being bound reads an export. */
function markArgument(argument: ExportArgument | undefined): void {
  if (argument !== undefined) {
    argument.read = true;
  }
}

/**
 * A mixin argument being bound notes whether it reads an export: start, which
 * returns the argument it is part of, then {@link exportArgumentEnd} with that,
 * which returns this one for {@link exportArgumentBound}.
 */
export function exportArgumentStart(x: ExportState<unknown> | undefined): ExportArgument | undefined {
  const outer = x?.argument;
  if (x !== undefined) {
    x.argument = { read: false };
  }
  return outer;
}

/** The mixin argument bound since {@link exportArgumentStart}; what it read so far counts for the one it is part of. */
export function exportArgumentEnd(x: ExportState<unknown> | undefined, outer: ExportArgument | undefined): ExportArgument | undefined {
  const argument = x?.argument;
  if (x !== undefined) {
    x.argument = outer;
    if (argument?.read === true) {
      markArgument(outer);
    }
  }
  return argument;
}

/**
 * A mixin argument, kept for the value it evaluated to as the argument as
 * written (`source`) in the caller's `frame` when it reads an export; the
 * snapshot the parameter binds as takes it over (`invalid-value-syntax.ts`
 * `keepArgumentSyntax`). A pending value is decided once it settles.
 */
export function exportArgumentBound<F, V extends object>(x: ExportState<F> | undefined, argument: ExportArgument | undefined, value: MaybePromise<V>, source: CallValue, frame: F | null): MaybePromise<V> {
  return x === undefined || frame === null || argument === undefined || (!argument.read && !isThenable(value))
    ? value
    : mapMaybe(value, (bound) => {
        if (argument.read) {
          x.refs.set(bound, { name: undefined, call: undefined, source: { value: source, frame, evaluated: null } });
        }
        return bound;
      });
}

/**
 * A computed call, evaluated as `args` then `dispatch`, in a document that
 * exports a variable; `fn` is its callable, undefined when the caller resolved
 * none. When its arguments read exports, it is
 * computed on their compile-time values and recorded: as an input of the
 * computed call it is an argument of, or else as a generated custom property,
 * `var(--<export>-<fn>, <compile-time result>)`, which the runtime recomputes
 * when an export it reads is set. Bound as a mixin argument, it is an export
 * read like a direct one ({@link exportArgumentBound}). An argument that holds an export inside a
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
  const inputs: NonNullable<ExportState<F>['inputs']> = [];
  const checks = e.checks;
  const argument = outer === undefined && checks === 'argument' ? x.argument : undefined;
  let typed: Array<MaybePromise<ValueGroup>>;
  x.inputs = inputs;
  try {
    typed = args();
  } finally {
    x.inputs = outer;
  }
  if (inputs.length === 0 && !typed.some(isThenable)) {
    return dispatch(typed);
  }

  /* An argument still pending reports its exports when it settles. */
  return combineAll(typed, vals => inputs.length === 0
    ? dispatch(vals)
    : mapMaybe(dispatch(vals), (computed) => {
        markArgument(argument);
        const result: ValueGroup = typeof computed === 'string' ? makeKeyword(computed) : computed;
        const recipe = callRecipe(node, fn, vals, inputs, e);
        if (outer !== undefined) {
          outer.push({ recipe, value: result });
          return result;
        }
        if (typeof checks !== 'object' && checks !== 'argument') {
          exportNotWritten(node, `${node.name}()`, recipeExport(recipe), e,
            'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
        }
        return writeCall('var', makeList([makeKeyword(derivedName(x.runtime, recipe, node.name)), result], ','), e.modes);
      }));
}

/** The recipe of a call whose arguments read exports; each argument either is one of `inputs` or holds none. */
function callRecipe<F>(node: FunctionCall, fn: Fn | undefined, vals: readonly ValueGroup[], inputs: NonNullable<ExportState<F>['inputs']>, e: ExportLane<F>): ExportRecipe {
  const lone = (v: ValueGroup): ValueGroup => isValueGroupArray(v) && v.length === 1 ? v[0]! : v;
  const origin = fn?.origin;
  if (origin === undefined) {
    exportNotWritten(node, `${node.name}()`, recipeExport(inputs[0]!.recipe), e, 'as the input of a function the runtime cannot run');
  }
  const written = new Set<object>(vals.map(lone));
  const stray = inputs.find(input => !written.has(input.value));
  if (stray !== undefined) {
    exportNotWritten(node, `${node.name}()`, recipeExport(stray.recipe), e, 'inside a larger argument of a function Jess computes, which the runtime cannot follow');
  }
  const recipes = new Map<object, ExportRecipe>(inputs.map(input => [input.value, input.recipe]));
  return { fn: origin, args: vals.map(v => recipes.get(lone(v)) ?? emitValue(v)) };
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

/** The generated custom property a recipe writes: one name per recipe, `--<export>-<fn>` with the function as `called` names it, numbered when another recipe or an export has it. */
function derivedName(runtime: ExportRuntime, recipe: ExportRecipe, called: string): string {
  const key = JSON.stringify(recipe);
  const known = runtime.named.get(key);
  if (known !== undefined) {
    return known;
  }
  const base = `--${recipeExport(recipe)}-${called.slice(called.lastIndexOf('.') + 1)}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!runtime.exports.has(name.slice(2)) && !runtime.derived.has(name)) {
      runtime.derived.set(name, recipe);
      runtime.named.set(key, name);
      return name;
    }
  }
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
