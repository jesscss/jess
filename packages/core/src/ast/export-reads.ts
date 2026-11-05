import { combineAll, isThenable, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Fn } from './functions/types.js';
import type { FnOrigin } from './module-values.js';
import { funcCall, keyword, type CallValue, type Declaration, type FunctionCall, type Statement, type VariableExpose } from './nodes.js';
import { emitValue, isValueGroupArray, type EvalModes, type EvalValue, type ValueGroup } from './value-eval.js';
import { writeCall } from './evaluator.js';
import type { ValueCheckLane } from './invalid-value-syntax.js';
import { makeKeyword, makeList } from './value-factory.js';
import { exposedOperand } from './value-operate.js';

/**
 * Ledger A4: a variable an `@expose` names (A20) publishes a custom property, so a
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
  /** Every name exported. */
  readonly exports: Set<string>;

  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Map<string, string>;

  /** Each generated custom property, by its name, with how the runtime computes it. */
  readonly derived: Map<string, ExportRecipe>;

  /** Each generated custom property's name, by its recipe as JSON: one name per recipe, however the call is spelled. */
  readonly named: Map<string, string>;
}

/**
 * What the runtime module is generated from, as data (`SerializeResult.runtime`):
 * every exposed name, its JavaScript key, the compile-time CSS of each one a
 * derived value reads, and each generated custom property with how it is
 * computed.
 */
export interface ExportRuntimeData {
  readonly exports: readonly string[];

  /** Each exposed name by its JavaScript key ({@link exportKey}), the one the clash check uses. */
  readonly keys: Readonly<Record<string, string>>;
  readonly defaults: Readonly<Record<string, string>>;
  readonly derived: Readonly<Record<string, ExportRecipe>>;
}

/** A render's `runtime` result field: none when nothing is exported. */
export function runtimeData(x: ExportState<unknown>): { runtime?: ExportRuntimeData } {
  settle(x);
  const runtime = x.runtime;
  return runtime === undefined
    ? {}
    : { runtime: { exports: [...runtime.exports], keys: Object.fromEntries(Array.from(x.keys, ([key, { name }]) => [key, name])), defaults: Object.fromEntries(runtime.defaults), derived: Object.fromEntries(runtime.derived) } };
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
  | { readonly name: string; readonly call: FunctionCall; readonly frame: F; readonly source?: undefined }
  | { readonly name?: undefined; readonly call?: undefined; readonly frame?: undefined; readonly source: ExportSource<F> | undefined };

/** A rest parameter or `@arguments` holding a mixin argument that reads an export among others: a read a `var()` cannot replace. */
const IN_ARGUMENTS: ExportRef<never> = { name: undefined, call: undefined, source: undefined };

/**
 * What a variable read's value resolves to, as an export: its own ref, or for a
 * rest parameter or `@arguments` (a list of bound arguments) the ref of its one
 * argument, or {@link IN_ARGUMENTS} when one of several reads an export. A
 * binding is its value in the frame it was bound in: a mixin's declaration,
 * bound by another call of the mixin, is another binding.
 */
function refOf<F>(x: ExportState<F>, hit: { value: CallValue; frame: F }): ExportRef<F> | undefined {
  const value = hit.value;
  const ref = x.refs.get(value);
  if (ref !== undefined || !isValueSlotArray(value)) {
    return ref?.frame === undefined || ref.frame === hit.frame ? ref : undefined;
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

  /** The exports read through it and their values, recorded as defaults when a recipe holding them is written. */
  readonly reads?: ReadonlyArray<{ readonly name: string; readonly value: ValueGroup }>;
  readonly value: ValueGroup;
}

/** One render's exports ({@link exportState}). */
export interface ExportState<F> {
  /** By what a variable read resolves to. */
  readonly refs: Map<object, ExportRef<F>>;

  /** By `var()` stand-in ({@link ExportRef}`.call`), the declaration value it stands in for. */
  readonly behind: Map<object, CallValue>;

  /**
   * The exports read as the arguments of the computed call being evaluated,
   * each with the value it read; undefined outside a computed call.
   */
  inputs: Array<ExportInput> | undefined;

  /** The mixin argument being bound, undefined outside one. */
  argument: ExportArgument | undefined;

  /** Undefined until a stylesheet exports a name: an export read pays one check. */
  runtime: ExportRuntime | undefined;

  /** By name, the binding each export resolved to, and where the `@expose` that named it first is. */
  readonly bound: Map<string, { readonly value: CallValue; readonly frame: F; readonly site: string }>;

  /** By JS key ({@link exportKey}), the name that has it and where it is exported. */
  readonly keys: Map<string, { readonly name: string; readonly site: string }>;

  /** Each `@expose` activated, in the frame it binds in. */
  readonly declared: Array<{ readonly node: VariableExpose; readonly frame: F }>;

  /** The `@expose`s not yet resolved ({@link settle}), and the names they list. */
  pending: Array<PendingExpose<F>>;
  readonly pendingNames: Set<string>;

  /** By name, the top-level statements of the first file to declare and expose it, and where. */
  readonly owners: Map<string, { readonly own: readonly Statement[]; readonly site: string }>;
}

/** An `@expose` waiting for its frame to be complete, with how its names resolve there. */
interface PendingExpose<F> {
  readonly node: VariableExpose;
  readonly resolve: (name: string) => { value: CallValue; frame: F } | undefined;

  /** Where each name is, taken while its file is the one evaluated. */
  readonly at: ReadonlyArray<ReturnType<typeof callSiteLocation>>;

  /** The top-level statements of the `@expose`'s file, where the activation knows them. */
  readonly own: readonly Statement[] | undefined;

  /** The names that file declares at its top level. */
  readonly declares: ReadonlySet<string>;
}

/** Where an `@expose` binds: how a name resolves there, and its file's top level when the caller knows it. */
export interface ExposeScope<F> {
  readonly resolve: PendingExpose<F>['resolve'];
  readonly own: readonly Statement[] | undefined;
}

/**
 * The key an exposed name has in the JS runtime: its dash-case turned to
 * camelCase, letter case otherwise kept (`brand-color` is `brandColor`,
 * `Brand-color` is `BrandColor`; a leading or trailing dash is dropped).
 */
export function exportKey(name: string): string {
  return name.replace(/-+(.?)/g, (_dashes, next: string, at: number) => (at === 0 ? next : next.toUpperCase()));
}

/** `file:line:column` of a location, for a diagnostic naming another site. */
function siteOf(at: ReturnType<typeof callSiteLocation>): string {
  return `${at.ctx.file?.name ?? ''}:${at.line ?? 1}:${at.column ?? 1}`;
}

/** What an export read needs from the evaluator's lane (serialize.ts `Lane`). */
export interface ExportLane<F> {
  /** The declaration whose value is being written, `'argument'` while a mixin argument is bound, else undefined. */
  readonly checks: Declaration | 'argument' | undefined;
  readonly modes: EvalModes;
  readonly s: { readonly context: Context | undefined; readonly exports: ExportState<F> };

  /** How many `(reference)` imports the render walk is inside, where the lane walks one. */
  readonly referenceImportDepth?: number;
}

/** The `reader` of a variable read that handles an exported binding itself. */
export const READS_EXPORT = {};

/** A render's export state, holding nothing until an `@expose` activates ({@link declareExpose}). */
export function exportState<F>(): ExportState<F> {
  return { refs: new Map(), behind: new Map(), inputs: undefined, argument: undefined, runtime: undefined, bound: new Map(), keys: new Map(), declared: [], pending: [], pendingNames: new Set(), owners: new Map() };
}

/**
 * Excludes `node` from lookups while a read evaluates it (`on`), or releases it.
 * An exposed variable's read evaluates its `var()` stand-in, whose fallback is
 * the declaration's own value, so the declaration is excluded with it: in
 * `@b: @b + 1` the `@b` then reads the earlier `@b`, as it does unexposed.
 */
export function excluding<F>(e: { readonly excluded: Set<CallValue>; readonly s: { readonly exports: ExportState<F> } }, node: CallValue, on: boolean): void {
  const behind = e.s.exports.runtime === undefined ? undefined : e.s.exports.behind.get(node);
  if (on) {
    e.excluded.add(node);
    if (behind !== undefined) {
      e.excluded.add(behind);
    }
  } else {
    e.excluded.delete(node);
    if (behind !== undefined) {
      e.excluded.delete(behind);
    }
  }
}

/** The state when something is exported, else undefined. */
function exporting<F>(x: ExportState<F>): (ExportState<F> & { runtime: ExportRuntime }) | undefined {
  return hasRuntime(x) ? x : undefined;
}

function hasRuntime<F>(x: ExportState<F>): x is ExportState<F> & { runtime: ExportRuntime } {
  return x.runtime !== undefined;
}

/** Each `@expose` among a document's top-level statements. */
export function forEachExpose(statements: readonly Statement[], declare: (node: VariableExpose) => void): void {
  for (const statement of statements) {
    if (statement.type === 'VariableExpose') {
      declare(statement);
    }
  }
}

/**
 * Ledger A20: an `@expose` at the top level of a stylesheet, whether rendered,
 * `@import`ed at the top level or `@compose`d, publishes each name it lists as
 * the binding a read in `frame` resolves to (`resolve`): one declared there, by
 * an imported file or by a mixin called there. One in a body (`nested`), or in
 * a file imported into one, is an error; one in a `(reference)` import does
 * nothing, as that file's rules are not written. The names resolve once the frame is
 * complete, at the first read of one of them ({@link settle}), so a read
 * written before the `@expose` is an export read too; the render activates the
 * root's before it starts, and the import planner a top-level sheet's.
 */
export function declareExpose<F>(node: VariableExpose, nested: boolean, frame: F, { resolve, own }: ExposeScope<F>, e: ExportLane<F>): void {
  rejectNestedExpose(node, nested, e);
  const x = e.s.exports;
  if ((e.referenceImportDepth ?? 0) !== 0 || x.declared.some(declared => declared.node === node && declared.frame === frame)) {
    return;
  }
  x.declared.push({ node, frame });
  const declares = new Set<string>();
  for (const statement of own ?? []) {
    if (statement.type === 'VariableDeclaration') {
      declares.add(statement.name);
    }
  }
  x.pending.push({ node, resolve, own, declares, at: node.names.map(exported => callSiteLocation(exported, e.s)) });
  for (const exported of node.names) {
    x.pendingNames.add(exported.name);
  }
  x.runtime ??= { exports: new Set(), defaults: new Map(), derived: new Map(), named: new Map() };
}

/**
 * Resolves every pending `@expose`. A name nothing declares is an error,
 * located at the name, and so are two exports of one name that resolve to
 * different bindings (an export is one custom property the runtime sets) and
 * two names with one JS key ({@link exportKey}); those name the other site.
 */
function settle<F>(x: ExportState<F>): void {
  const pending = x.pending;
  const runtime = x.runtime;
  if (pending.length === 0 || runtime === undefined) {
    return;
  }
  x.pending = [];
  x.pendingNames.clear();
  for (const { node, resolve, at, own, declares } of pending) {
    node.names.forEach((exported, i) => {
      const name = exported.name;
      const where = at[i]!;
      const site = siteOf(where);
      const hit = resolve(name);
      if (hit === undefined) {
        throw ERR.exposeNotDeclared({ node: exported, ...where, meta: { name } });
      }
      const bound = x.bound.get(name);
      if (bound !== undefined && (bound.value !== hit.value || bound.frame !== hit.frame)) {
        throw ERR.exposeConflict({ node: exported, ...where, meta: { name, other: bound.site } });
      }

      /* Owner 2026-11-02: two files that each declare and expose a name clash, though an import shares one top level. */
      const declaring = declares.has(name) ? own : undefined;
      const owner = declaring === undefined ? undefined : x.owners.get(name);
      if (owner !== undefined && owner.own !== declaring) {
        throw ERR.exposeConflict({ node: exported, ...where, meta: { name, other: owner.site } });
      }
      if (declaring !== undefined && owner === undefined) {
        x.owners.set(name, { own: declaring, site });
      }
      const key = exportKey(name);
      const keyed = x.keys.get(key);
      if (keyed !== undefined && keyed.name !== name) {
        throw ERR.exposeKeyConflict({ node: exported, ...where, meta: { name, key, other: keyed.name, at: keyed.site } });
      }
      x.bound.set(name, bound ?? { value: hit.value, frame: hit.frame, site });
      x.keys.set(key, keyed ?? { name, site });
      runtime.exports.add(name);
      if (isValueSlotArray(hit.value) || hit.value.type !== 'MixinCall') {
        const call = funcCall('var', [keyword(`--${name}`), hit.value]);
        x.refs.set(hit.value, { name, call, frame: hit.frame, source: undefined });
        x.behind.set(call, hit.value);
      }
    });
  }
}

/**
 * `probe` of `node`'s value, which looks at what it resolves to and writes
 * nothing, run as that value's reads: an export it reaches resolves to its
 * `var()` rather than raising as a read outside a CSS value.
 */
export function probedAsValueOf<F, L extends ValueCheckLane & { readonly s: { readonly exports: ExportState<unknown> } }, T>(
  node: Declaration,
  frame: F,
  e: L,
  probe: (value: Declaration['value'], frame: F, e: L) => T
): T {
  if (e.s.exports.runtime === undefined) {
    return probe(node.value, frame, e);
  }
  const outer = e.checks;
  e.checks = node;
  try {
    return probe(node.value, frame, e);
  } finally {
    e.checks = outer;
  }
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
  const x = exporting(e.s.exports);
  if (x?.pendingNames.has(name) === true && reader !== READS_EXPORT) {
    settle(x);
  }
  const ref = hit === undefined || reader === READS_EXPORT || x === undefined ? undefined : refOf(x, hit);
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
export function exportInput<F, H extends { value: CallValue; frame: F }>(hit: H | undefined, name: string, reader: object, e: ExportLane<F>): H | ExportSource<F> | undefined {
  const x = exporting(e.s.exports);
  if (x?.pendingNames.has(name) === true) {
    settle(x);
  }
  const ref = hit === undefined || x === undefined ? undefined : refOf(x, hit);
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

/**
 * A variable's read, as what follows it reads it: the `var()` of an export is of
 * its value's type ({@link exposedOperand}), and the value a computed function's
 * input read evaluated to is recorded when the read was an export's root binding
 * ({@link exportInput}).
 */
export function exportInputRead<F>(e: ExportLane<F>, hit: { value: CallValue; frame: F }, value: MaybePromise<ValueGroup>): MaybePromise<ValueGroup> {
  const x = exporting(e.s.exports);
  if (x?.behind.has(hit.value) === true) {
    return mapMaybe(value, exposedOperand);
  }
  const inputs = x?.inputs;
  const name = inputs === undefined || x === undefined ? undefined : refOf(x, hit)?.name;
  return name === undefined || inputs === undefined
    ? value
    : mapMaybe(value, (read) => {
        inputs.push({ recipe: { export: name }, value: read });
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
export function exportArgumentStart(state: ExportState<unknown>): ExportArgument | undefined {
  const x = exporting(state);
  const outer = x?.argument;
  if (x !== undefined) {
    x.argument = { read: false };
  }
  return outer;
}

/** The mixin argument bound since {@link exportArgumentStart}; what it read so far counts for the one it is part of. */
export function exportArgumentEnd(state: ExportState<unknown>, outer: ExportArgument | undefined): ExportArgument | undefined {
  const x = exporting(state);
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
export function exportArgumentBound<F, V extends object>(state: ExportState<F>, argument: ExportArgument | undefined, value: MaybePromise<V>, source: CallValue, frame: F | null): MaybePromise<V> {
  const x = exporting(state);
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
 *
 * A function with a CSS form takes an export it reads there as the `var()` it
 * is written as (R8; docs/design/CSS-NATIVE-BUILTINS.md §3.4a): the
 * browser recomputes the form, so nothing is recorded. An input of a computed
 * call stays computed, as that call's runtime reads it.
 */
export function exportCall<F>(
  e: ExportLane<F>,
  node: FunctionCall,
  fn: Fn | undefined,
  args: (asWritten: boolean) => Array<MaybePromise<ValueGroup>>,
  dispatch: (args: Array<MaybePromise<ValueGroup>>) => MaybePromise<EvalValue>
): MaybePromise<EvalValue> {
  const x = exporting(e.s.exports);
  if (x === undefined) {
    return dispatch(args(false));
  }
  const outer = x.inputs;
  const inputs: NonNullable<ExportState<F>['inputs']> = [];
  const checks = e.checks;
  const argument = outer === undefined && checks === 'argument' ? x.argument : undefined;
  let typed: Array<MaybePromise<ValueGroup>>;
  x.inputs = inputs;
  try {
    typed = args(false);
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
        /* Whether the export's own value is one the form takes (§3.6): a wrong one has failed by now, or is written out. */
        if (outer === undefined && (typeof checks === 'object' || checks === 'argument') && isFormResult(computed) && takesForm(fn, vals, inputs)) {
          return dispatch(args(true));
        }
        markArgument(argument);
        const result: ValueGroup = typeof computed === 'string' ? makeKeyword(computed) : computed;
        const recipe = callRecipe(node, fn, vals, inputs, e);
        const reads = inputs.flatMap(input => 'export' in input.recipe ? [{ name: input.recipe.export, value: input.value }] : input.reads ?? []);
        if (outer !== undefined) {
          outer.push({ recipe, value: result, reads });
          return result;
        }
        for (const read of reads) {
          if (!x.runtime.defaults.has(read.name)) {
            x.runtime.defaults.set(read.name, emitValue(read.value));
          }
        }
        if (typeof checks !== 'object' && checks !== 'argument') {
          exportNotWritten(node, `${node.name}()`, recipeExport(recipe), e,
            'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
        }
        return writeCall('var', makeList([makeKeyword(derivedName(x.runtime, recipe, node.name)), result], ','), e.modes);
      }));
}

/** What a built-in's CSS form computes: its colour, or the form itself. A call written out is neither. */
const isFormResult = (result: EvalValue): boolean =>
  typeof result !== 'string' && !isValueGroupArray(result) && (result.type === 'Color' || result.type === 'Dimension' || (result.type === 'FunctionCall' && result.computed));

const lone = (v: ValueGroup): ValueGroup => isValueGroupArray(v) && v.length === 1 ? v[0]! : v;

/** Whether every export a call read is an argument its CSS form takes as what only the browser knows. */
function takesForm<F>(fn: Fn | undefined, vals: readonly ValueGroup[], inputs: NonNullable<ExportState<F>['inputs']>): boolean {
  if (fn === undefined) {
    return false;
  }
  return inputs.every(input => holdsFormSlot(fn, vals, input.value));
}

/** Whether a slot has a form, and an export's value there is what the form takes it to hold, so the form means what the value computes to. */
function holdsFormSlot(fn: Fn, vals: readonly ValueGroup[], value: ValueGroup): boolean {
  const slot = fn.params[vals.findIndex(val => lone(val) === value)]?.formSlot;
  if (slot === undefined || isValueGroupArray(value)) {
    return false;
  }

  /* A value it cannot judge, a list above all, has no form: the call keeps its recipe. */
  if (value.type !== 'Dimension') {
    return value.type === 'Color' || value.type === 'Keyword' || value.type === 'FunctionCall' || value.type === 'Arithmetic';
  }
  const first = lone(vals[0]!);
  const unit = slot === 'first' && !isValueGroupArray(first) && first.type === 'Dimension' ? first.unit : slot;
  return value.unit.toLowerCase() === unit.toLowerCase();
}

/** The recipe of a call whose arguments read exports; each argument either is one of `inputs` or holds none. */
function callRecipe<F>(node: FunctionCall, fn: Fn | undefined, vals: readonly ValueGroup[], inputs: NonNullable<ExportState<F>['inputs']>, e: ExportLane<F>): ExportRecipe {
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
  throw ERR.exposeNotAValue({ node, ...callSiteLocation(node, e.s), meta: { symbol, name, where } });
}

/** `@expose` publishes a stylesheet's top-level variables; one in a body (`nested`) is an error. */
export function rejectNestedExpose(node: VariableExpose, nested: boolean, e: ExportLane<unknown>): void {
  if (nested) {
    throw ERR.exposeNotTopLevel({ node, ...callSiteLocation(node, e.s) });
  }
}

/**
 * What a ruleset argument's body holds that it cannot write, for its error. An
 * `@expose` there (an `each()` body) is one below the top level and raises so.
 */
export function argumentStatementKind(rule: Statement, e: ExportLane<unknown>): string {
  if (rule.type === 'VariableExpose') {
    rejectNestedExpose(rule, true, e);
  }
  return `a ${rule.type}`;
}
