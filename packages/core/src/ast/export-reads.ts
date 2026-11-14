import { combineAll, isThenable, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { JessError } from '../error/jess-error.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { isDimension, knownUnit } from './css-math.js';
import type { Fn, ParamSpec } from './functions/types.js';
import type { FnOrigin } from './module-values.js';
import { namedColor } from './color-names.js';
import { funcCall, keyword, type CallValue, type Declaration, type FunctionCall, type Statement, type VariableExpose } from './nodes.js';
import { calcOperand } from './math-operand.js';
import { isBrowserColor, takesColor } from './value-dispatch.js';
import { emitValue, isValueGroupArray, type CallResult, type EvalModes, type EvalValue, type Value, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { writeCall } from './evaluator.js';
import { groupItems } from './value-list.js';
import type { ValueCheckLane } from './invalid-value-syntax.js';
import { makeDimension, makeKeyword, makeList, withFields } from './value-factory.js';
import { cancelPercent, exposedOperand, insideParens, keepAsWritten, mathOnDeferred, ratioOf } from './value-operate.js';

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
export type ExportRecipe = { readonly export: string } | { readonly fn: FnOrigin; readonly args: ReadonlyArray<ExportRecipe | ExportColor | string> };

/**
 * A colour name a recipe's own argument writes for a parameter checked as a
 * colour (`gray` in `lightness(multiply(@brand, gray))`), read as that colour
 * at compile time, as the compile's binder reads it, so the runtime needs no
 * name table for it: the name as written, and its channels.
 */
export interface ExportColor {
  readonly color: string;
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
}

/** What the runtime module is generated from ({@link ExportState.runtime}). */
export interface ExportRuntime {
  /** Every name exported. */
  readonly exports: Set<string>;

  /** The compile-time CSS of each export a derived value reads. */
  readonly defaults: Map<string, string>;

  /** The unit of each export a CSS form reads, `%` for each percentage export: the only one the runtime takes for it ({@link recordUnits}, {@link noteRatio}). */
  readonly units: Map<string, string>;

  /** Each export whose custom property holds its ratio, `50%` as `0.5`: one whose compile-time value is a percentage ({@link ratioOfHeld}). */
  readonly ratios: Set<string>;

  /** The read of each `%` export, built once ({@link percentRead}). */
  readonly percent: Map<string, ValueGroup>;

  /** Each generated custom property, by its name, with how the runtime computes it. */
  readonly derived: Map<string, ExportRecipe>;

  /** Each colour export: one whose value holds a colour and that reaches a parameter checked as a colour, directly or through another function ({@link markColors}). A colour name given for one at runtime takes the hex check (R8 §colour names). */
  readonly colors: Set<string>;

  /** Whether a recipe's own argument spells a colour name (`mix(@brand, red)`), which the runtime then reads ({@link spellsColorName}). */
  literalNames: boolean;

  /** Whether a colour export's own value spells a colour name (`@brand: red`), so the runtime takes names for it ({@link spellsColorName}). */
  ownNames: boolean;

  /** Each generated custom property's name, by its recipe as JSON: one name per recipe, however the call is spelled. */
  readonly named: Map<string, string>;

  /** Each export by its custom property, `--a` for `a`: what a `var()` read names. */
  readonly properties: Map<string, string>;

  /** By export of no known unit, the function whose slot fixed the unit it takes ({@link formUnits}). */
  readonly slots: Map<string, string>;
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
  readonly units: Readonly<Record<string, string>>;
  readonly ratios: readonly string[];
  readonly derived: Readonly<Record<string, ExportRecipe>>;

  /** Each export a recipe passes to a parameter checked as a colour. */
  readonly colors: readonly string[];

  /** Whether the runtime reads colour names even when the page does not opt in ({@link readsNames}). */
  readonly names: boolean;

  /** Whether a colour export's own value spells a colour name, so a name given for a colour export is read rather than refused. */
  readonly ownNames: boolean;
}

/**
 * Whether the runtime has to read colour names (R8-13). It does when the
 * stylesheet itself writes one it reads: a colour export's own value or a
 * recipe's own argument. A colour export a recipe passes through another function
 * (`luma(extract(@list, 1))`) takes the hex check like any other (owner,
 * 2026-11-13: *"I agree with the reco"*).
 */
const readsNames = (runtime: ExportRuntime): boolean => runtime.literalNames || runtime.ownNames;

/** A render's `runtime` result field: none when nothing is exported. */
export function runtimeData(x: ExportState<unknown>): { runtime?: ExportRuntimeData } {
  settle(x);
  const runtime = x.runtime;
  return runtime === undefined
    ? {}
    : { runtime: { exports: [...runtime.exports], keys: Object.fromEntries(Array.from(x.keys, ([key, { name }]) => [key, name])), defaults: Object.fromEntries(runtime.defaults), units: Object.fromEntries(runtime.units), ratios: [...runtime.ratios], derived: Object.fromEntries(runtime.derived), colors: [...runtime.colors], names: readsNames(runtime), ownNames: runtime.ownNames } };
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

  /** The exports the call being dispatched read as its arguments ({@link onlyExportsUnknown}). */
  callReads: ReadonlyArray<ExportInput> | undefined;

  /** Exports read as their compile-time values, for what fills a slot ({@link knownArguments}). */
  knownReads: boolean;

  /** An export the arguments of the computed call being evaluated read inside a call written out, which names it if that call fails. */
  writtenRead: string | undefined;

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
  readonly ev?: SlotEvaluator | null;

  /** The declaration whose value is being written, `'argument'` while a mixin argument is bound, else undefined. */
  checks: Declaration | 'argument' | undefined;
  readonly modes: EvalModes;
  readonly s: { readonly context: Context | undefined; readonly exports: ExportState<F> };

  /** A colour's channels being read again for its consumer, where an export is not known. */
  readonly channels?: unknown;

  /** How many `(reference)` imports the render walk is inside, where the lane walks one. */
  readonly referenceImportDepth?: number;
}

type SlotEvaluator = Pick<ValueEvaluator, 'operate' | 'sassOperands' | 'sassCalculations'>;

const IN_LARGER_ARGUMENT = 'inside a larger argument of a function Jess computes, which the runtime cannot follow';

/** The `reader` of a variable read that handles an exported binding itself. */
export const READS_EXPORT = {};

/** A render's export state, holding nothing until an `@expose` activates ({@link declareExpose}). */
export function exportState<F>(): ExportState<F> {
  return { refs: new Map(), behind: new Map(), inputs: undefined, callReads: undefined, knownReads: false, writtenRead: undefined, argument: undefined, runtime: undefined, bound: new Map(), keys: new Map(), declared: [], pending: [], pendingNames: new Set(), owners: new Map() };
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
  x.runtime ??= { exports: new Set(), defaults: new Map(), units: new Map(), ratios: new Set(), percent: new Map(), derived: new Map(), colors: new Set(), literalNames: false, ownNames: false, named: new Map(), properties: new Map(), slots: new Map() };
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
      runtime.properties.set(`--${name}`, name);
      if (!isValueSlotArray(hit.value) && hit.value.type === 'Dimension' && hit.value.unit === '%') {
        noteRatio(runtime, name);
      }
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
): H | ExportSource<F> | { value: FunctionCall; frame: F; evaluated: null } | undefined {
  const x = exporting(e.s.exports);
  if (x?.pendingNames.has(name) === true && reader !== READS_EXPORT) {
    settle(x);
  }
  const ref = hit === undefined || reader === READS_EXPORT || x === undefined ? undefined : refOf(x, hit);
  if (ref === undefined || x === undefined || hit === undefined) {
    return hit;
  }
  if (x.knownReads) {
    return ref.source ?? hit;
  }
  if (e.checks === 'argument') {
    markArgument(x.argument);
  } else if (typeof e.checks !== 'object') {
    exportNotWritten(reader, lookup === 'live' ? `$${name}` : `@${name}`, name, e,
      'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
  }
  x.writtenRead = name;
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
  if (x?.inputs === undefined || e.channels !== undefined) {
    exportNotWritten(reader, `@${name}`, name, e, 'as the input of a function the runtime cannot run');
  }
  if (ref === IN_ARGUMENTS) {
    exportNotWritten(reader, `@${name}`, name, e, IN_LARGER_ARGUMENT);
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
  if (x === undefined) {
    return value;
  }
  if (x.behind.has(hit.value)) {
    return mapMaybe(value, read => percentRead(exposedOperand(read), e.modes, x.runtime));
  }
  const inputs = x.inputs;
  const name = inputs === undefined ? undefined : refOf(x, hit)?.name;
  return name === undefined || inputs === undefined
    ? value
    : mapMaybe(value, (read) => {
        if (ratioOfHeld(read) !== undefined) {
          noteRatio(x.runtime, name);
        }
        inputs.push({ recipe: { export: name }, value: read });
        return read;
      });
}

/**
 * A `%` export's read. The browser holds its ratio (`@a: 50%` is `--a: 0.5`) and
 * every read multiplies it back, `calc(var(--a, 0.5) * 100%)`, so a form that
 * reads it as a number or a length never divides a percentage the property
 * resolves first ({@link mathOnDeferred}; docs/architecture/core/spec/R8-browser-runtime.md,
 * *Percentages*).
 */
function percentRead(read: ValueGroup, modes: EvalModes, runtime: ExportRuntime): ValueGroup {
  if (isValueGroupArray(read) || read.type !== 'FunctionCall' || read.name !== 'var') {
    return read;
  }
  const [name, held] = groupItems(read.args);
  if (name === undefined || isValueGroupArray(name) || name.type !== 'Keyword') {
    return read;
  }
  const key = runtime.properties.get(name.text);
  if (key === undefined) {
    return read;
  }
  let built = runtime.percent.get(key);
  if (built === undefined) {
    const ratio = ratioOfHeld(held);
    if (ratio === undefined) {
      return read;
    }
    noteRatio(runtime, key);
    built = mathOnDeferred('*', keepAsWritten(withFields(writeCall('var', makeList([name, ratio], ','), modes), { result: 'numeric' as const })), makeDimension(100, '%'));
    runtime.percent.set(key, built);
  }
  return built;
}

/**
 * The ratio a `%` export's custom property holds, from its compile-time value:
 * `50%` is `0.5`, and an export that is another's read, `@b: @a`, holds that
 * one's, `var(--a, 0.25)`. Undefined for any other value. The one decision
 * that makes an export a ratio (docs/architecture/core/spec/R8-browser-runtime.md, *Percentages*).
 */
function ratioOfHeld(held: ValueGroup | undefined): Value | undefined {
  if (held === undefined || isValueGroupArray(held)) {
    return undefined;
  }
  return isDimension(held) ? (held.unit === '%' ? makeDimension(ratioOf(held.number, 100)) : undefined) : cancelPercent(held, 100);
}

/** `name` holds its ratio, and the runtime takes only a percentage for it. */
function noteRatio(runtime: ExportRuntime, name: string): void {
  runtime.ratios.add(name);
  runtime.units.set(name, '%');
}

/** An operand of math written in a math function (`calc(@a * 2)`): an export's `var()` is of its value's type there too ({@link exposedOperand}). */
export function exposedWritten<F>(e: ExportLane<F>, operand: EvalValue): EvalValue {
  if (typeof operand === 'string' || isValueGroupArray(operand) || operand.type !== 'FunctionCall' || operand.name !== 'var') {
    return operand;
  }
  const name = varName(operand);
  const x = exporting(e.s.exports);
  return name !== undefined && x?.runtime.exports.has(name.slice(2)) === true ? percentRead(exposedOperand(operand), e.modes, x.runtime) : operand;
}

/**
 * A read of an export's `var()` stand-in where nothing reads it as an operand: a
 * `%` export is its ratio ({@link percentRead}). The stand-in is the compile's,
 * not the author's text, so an F5 colour call's written lane reads it in the
 * lane that evaluates (`writtenFrom`), as every other reader does. With nothing
 * exposed, `read` in `e` as it is.
 */
export function exposedRead<F, L extends ExportLane<F> & { readonly writtenFrom: L | undefined }>(e: L, hit: { value: CallValue }, read: (lane: L) => MaybePromise<EvalValue>): MaybePromise<EvalValue> {
  const runtime = e.s.exports.runtime;
  if (runtime === undefined || !e.s.exports.behind.has(hit.value)) {
    return read(e);
  }
  const lane = e.writtenFrom ?? e;
  return mapMaybe(read(lane), value => typeof value === 'string' ? value : percentRead(value, lane.modes, runtime));
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
  const outerWritten = x.writtenRead;
  let typed: Array<MaybePromise<ValueGroup>>;
  let written: string | undefined;
  let knownSlots: ValueGroup[] | undefined;
  x.inputs = inputs;
  x.writtenRead = undefined;
  try {
    typed = args(false);
  } finally {
    x.inputs = outer;
    written = x.writtenRead;
    x.writtenRead = outerWritten ?? written;
  }

  const computedOver = (vals: Array<MaybePromise<ValueGroup>>): MaybePromise<EvalValue> =>
    written === undefined
      ? dispatchReading(x, inputs, dispatch, vals)
      : mapMaybe(slotsKnown(x, fn, args, e.ev), (slots) => {
          knownSlots = slots;
          if (slots !== undefined && !fitsWritten(fn, vals, slots)) {
            exportNotWritten(node, `@${written}`, written, e, IN_LARGER_ARGUMENT);
          }
          return mapMaybe(recovering(() => dispatchReading(x, inputs, dispatch, vals), namingExport(e, node, written)), form => recordUnits(x.runtime, [], form, node, e));
        });
  if (inputs.length === 0 && !typed.some(isThenable)) {
    return computedOver(typed);
  }

  /* An argument still pending reports its exports when it settles. */
  return combineAll(typed, vals => inputs.length === 0
    ? computedOver(vals)
    : mapMaybe(computedOver(vals), (computed) => {
        /* Whether the export's own value is one the form takes (§3.6): a wrong one has failed by now, or is written out. */
        const recorded = (): EvalValue => {
          if (written !== undefined) {
            exportNotWritten(node, `@${written}`, written, e, IN_LARGER_ARGUMENT);
          }
          markArgument(argument);
          const result: ValueGroup = typeof computed === 'string' ? makeKeyword(computed) : computed;
          const recipe = callRecipe(node, fn, vals, inputs, e);
          const reads = readsOf(inputs);
          if (outer !== undefined) {
            outer.push({ recipe, value: result, reads });
            return result;
          }
          recordDefaults(x.runtime, reads);
          if (typeof checks !== 'object' && checks !== 'argument') {
            exportNotWritten(node, `@${recipeExport(recipe)}`, recipeExport(recipe), e,
              'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
          }
          return writeCall('var', makeList([makeKeyword(derivedName(x.runtime, recipe, node.name)), result], ','), e.modes);
        };
        if (outer === undefined && (typeof checks === 'object' || checks === 'argument') && isFormResult(computed, vals) && takesForm(fn, knownSlots ?? vals.map(val => slotValue(val, e.ev)), vals, inputs, e.ev)) {
          /* After an await the lane holds no argument, so the reads below cannot mark this one. */
          markArgument(argument);
          return mapMaybe(
            recovering(() => dispatch(asWritten(e, checks, args).map((read, index) => mapMaybe(read, value => typedRead(vals[index], value)))), onNoForm(recorded)),
            form => isUnwrittenBuiltin(form) ? recorded() : recordUnits(x.runtime, readsOf(inputs), form, node, e)
          );
        }
        return recorded();
      }));
}

/** A call's dispatch over the exports it read, for {@link onlyExportsUnknown}. */
function dispatchReading<F>(x: ExportState<F>, inputs: ReadonlyArray<ExportInput>, dispatch: (args: Array<MaybePromise<ValueGroup>>) => MaybePromise<EvalValue>, vals: Array<MaybePromise<ValueGroup>>): MaybePromise<EvalValue> {
  x.callReads = inputs;
  return dispatch(vals);
}

/** The exports a call's arguments read, with the values they read. */
const readsOf = (inputs: ReadonlyArray<ExportInput>): ReadonlyArray<{ name: string; value: ValueGroup }> =>
  inputs.flatMap(input => 'export' in input.recipe ? [{ name: input.recipe.export, value: input.value }] : input.reads ?? []);

/**
 * The unit of each export a CSS form reads, so the runtime takes no other: CSS
 * converts `2em` over `/ 1px`, where Less reads it as 2. A read is in its
 * compile-time value's unit, `reads` as an argument or a `var()` in `form`
 * inside a larger one (`(@a * 2)`); one of no known unit is in the unit its slot
 * reads: the unit the form divides it by (`var(--a, var(--y)) / 100%`), a number
 * as an operand or in `sqrt()`, a sibling's unit in `min()` ({@link slotUnit}),
 * two such units being `eval/expose-unit-conflict`. A `%` export is its ratio's
 * ({@link noteRatio}) (docs/architecture/core/spec/R8-browser-runtime.md).
 * Returns `form`.
 */
function recordUnits<F>(runtime: ExportRuntime, reads: ReadonlyArray<{ name: string; value: ValueGroup }>, form: EvalValue, node: FunctionCall, e: ExportLane<F>): EvalValue {
  for (const read of reads) {
    if (ratioOfHeld(read.value) !== undefined) {
      noteRatio(runtime, read.name);
    } else if (isDimension(read.value)) {
      runtime.units.set(read.name, read.value.unit);
    }
  }
  formUnits(runtime, form, undefined, false, (name, unit) => {
    const had = runtime.units.get(name);
    if (had === undefined) {
      runtime.units.set(name, unit);
      runtime.slots.set(name, node.name);
    } else if (had !== unit) {
      throw ERR.exposeUnitConflict({ node, ...callSiteLocation(node, e.s), meta: { name, fn: node.name, unit: unitWord(unit), other: runtime.slots.get(name) ?? 'another function', otherUnit: unitWord(had) } });
    }
  });
  return form;
}

const unitWord = (unit: string): string => unit === '' ? 'a number' : unit === '%' ? 'a percentage' : `a value in ${unit}`;

/**
 * {@link recordUnits} of each export `var()` in `v`, `over` the unit of the divisor
 * it is under, an `operand` of math or not. One of no known unit (`@a: var(--y)`)
 * takes the unit its slot reads, `reads` it: the divisor's, or a number's as an
 * operand (`calc(h + var(--a, var(--y)))`); anywhere else the browser reads any value.
 */
function formUnits(runtime: ExportRuntime, v: EvalValue, over: string | undefined, operand: boolean, reads: (name: string, unit: string) => void): void {
  if (typeof v === 'string') {
    return;
  }
  if (isValueGroupArray(v) || v.type === 'List') {
    for (const item of isValueGroupArray(v) ? v : v.value) {
      formUnits(runtime, item, over, operand, reads);
    }
  } else if (v.type === 'Arithmetic') {
    const by = typeof v.right !== 'string' && isDimension(v.right) && v.right.unit !== '' ? v.right.unit : undefined;
    formUnits(runtime, v.left, by === undefined ? over : v.op === '/' ? by : v.op === '*' ? '' : over, true, reads);
    formUnits(runtime, v.right, over, true, reads);
  } else if (v.type === 'FunctionCall' && v.name !== 'var') {
    const slot = slotUnit(v.name, v.args);
    formUnits(runtime, v.args, slot ?? over, operand || slot !== undefined, reads);
  } else if (v.type === 'FunctionCall') {
    const [name, held] = groupItems(v.args);
    const key = name !== undefined && !isValueGroupArray(name) && name.type === 'Keyword' ? runtime.properties.get(name.text) : undefined;
    if (key === undefined || runtime.ratios.has(key)) {
      return;
    }
    if (isDimension(held)) {
      if (!runtime.units.has(key)) {
        runtime.units.set(key, held.unit);
      }
      return;
    }
    const unit = over ?? (operand ? '' : undefined);
    if (unit !== undefined) {
      reads(key, unit);
    }
  }
}

/** CSS math functions that read their arguments as numbers (css-values-4 §10.4–10.5). */
const NUMBER_SLOTS: ReadonlySet<string> = new Set(['sqrt', 'pow', 'exp', 'log', 'asin', 'acos', 'atan']);

/** CSS math functions whose arguments share one type (css-values-4 §10.2, §10.6–10.7). */
const SHARED_SLOTS: ReadonlySet<string> = new Set(['min', 'max', 'clamp', 'round', 'rem', 'mod', 'hypot', 'atan2']);

/** The unit a math function's arguments are read in: a number, or the unit of an argument that knows one. */
function slotUnit(name: string, args: ValueGroup): string | undefined {
  if (NUMBER_SLOTS.has(name)) {
    return '';
  }
  if (SHARED_SLOTS.has(name)) {
    for (const argument of groupItems(args)) {
      const unit = knownUnit(argument, true);
      if (unit !== undefined) {
        return unit;
      }
    }
  }
  return undefined;
}

/**
 * The compile-time value of each export a recipe reads, the first read
 * standing.
 */
function recordDefaults(runtime: ExportRuntime, reads: ReadonlyArray<{ name: string; value: ValueGroup }>): void {
  for (const read of reads) {
    if (!runtime.defaults.has(read.name)) {
      runtime.defaults.set(read.name, emitValue(read.value));
    }
  }
}

/**
 * Each export that reaches a colour parameter, directly or through another
 * function (`luma(extract(@list, 1))`), and whose value holds a colour, is a
 * colour export; one whose own value spells a name turns names on (R8-13;
 * owner, 2026-11-13).
 */
function markColors(runtime: ExportRuntime, reads: ReadonlyArray<{ name: string; value: ValueGroup }>): void {
  for (const read of reads) {
    if (holdsColor(read.value)) {
      runtime.colors.add(read.name);
      runtime.ownNames ||= spellsColorName(read.value);
    }
  }
}

/** Whether a value is or lists a colour: a hex, a function's colour, or a name. */
const holdsColor = (v: ValueGroup): boolean =>
  isValueGroupArray(v)
    ? v.some(holdsColor)
    : v.type === 'List'
      ? holdsColor(v.value)
      : v.type === 'Color' || (v.type === 'Keyword' && namedColor(v.text) !== undefined);

/** A value no form holds over what only the browser knows runs on the runtime (§3.4a, rung 4). */
const onNoForm = (recorded: () => EvalValue) => (error: unknown): EvalValue => {
  if (isNoForm(error)) {
    return recorded();
  }
  throw error;
};

/** A call's arguments with each export written as its `var()`, possibly after an await, where the lane no longer checks for this call ({@link probedAsValueOf}). */
function asWritten<F>(e: ExportLane<F>, checks: ExportLane<F>['checks'], args: (asWritten: boolean) => Array<MaybePromise<ValueGroup>>): Array<MaybePromise<ValueGroup>> {
  const current = e.checks;
  e.checks = checks;
  try {
    return args(true);
  } finally {
    e.checks = current;
  }
}

/** A call that failed over an export written inside an argument says which, not only that it failed. */
function namingExport<F>(e: ExportLane<F>, node: FunctionCall, written: string) {
  return (error: unknown): never => {
    if (isInvalidFunction(error)) {
      exportNotWritten(node, `@${written}`, written, e, `${IN_LARGER_ARGUMENT} (${error.reason})`);
    }
    throw error;
  };
}

function recovering(run: () => MaybePromise<EvalValue>, recover: (error: unknown) => EvalValue): MaybePromise<EvalValue> {
  try {
    const result = run();
    return isThenable(result) ? result.catch(recover) : result;
  } catch (error) {
    return recover(error);
  }
}

/** The custom property a `var()` names. */
function varName(call: { readonly args: ValueGroup }): string | undefined {
  const first = isValueGroupArray(call.args) ? call.args[0] : call.args.type === 'List' ? call.args.value[0] : call.args;
  return first !== undefined && !isValueGroupArray(first) && first.type === 'Keyword' ? first.text : undefined;
}

/**
 * Whether a call read an export and everything else it was given is known, so
 * all it waits on is the export, which is deferred on purpose. A `var()` or a
 * `currentColor` beside the export is not, however deep in its math.
 */
export function onlyExportsUnknown<F>(state: ExportState<F>, vals: readonly ValueGroup[]): boolean {
  const x = exporting(state);
  if (x === undefined) {
    return false;
  }
  const read = new Set<EvalValue>((x.callReads ?? []).map(input => input.value));
  let exported = read.size > 0;
  const browserOnly = (value: EvalValue): boolean => {
    if (read.has(value)) {
      return false;
    }
    if (typeof value === 'string') {
      return true;
    }
    if (isValueGroupArray(value)) {
      return value.some(browserOnly);
    }
    switch (value.type) {
      case 'Keyword':
        return isBrowserColor(value.text);
      case 'List':
        return value.value.some(browserOnly);
      case 'Arithmetic':
        return browserOnly(value.left) || browserOnly(value.right);
      case 'FunctionCall': {
        const name = value.name === 'var' ? varName(value) : undefined;
        if (name !== undefined && (x.runtime.exports.has(name.slice(2)) || x.runtime.derived.has(name))) {
          exported = true;
          return false;
        }
        return value.result === null || browserOnly(value.args);
      }
      default:
        return false;
    }
  };
  return !vals.some(browserOnly) && exported;
}

/** A built-in's own call written out because it failed, which is no CSS, unlike a call its callable declined. */
const isUnwrittenBuiltin = (result: EvalValue): boolean =>
  typeof result !== 'string' && !isValueGroupArray(result) && result.type === 'FunctionCall' && !result.computed && result.result === null;

const isInvalidFunction = (error: unknown): error is JessError =>
  error instanceof JessError && error.code === 'eval/invalid-function';

/** By name: a provided module (`#less`) is loaded by its resolved path, and may run another build of the class. */
const isNoForm = (error: unknown): boolean =>
  error instanceof JessError && error.cause instanceof Error && error.cause.name === 'NoCssForm';

const lone = (v: ValueGroup): ValueGroup => isValueGroupArray(v) && v.length === 1 ? v[0]! : v;

const isCallValue = (v: ValueGroup): boolean => {
  const value = lone(v);
  return !isValueGroupArray(value) && value.type === 'FunctionCall';
};

/** What a built-in's CSS form computes: its colour or number, the form itself, or a call CSS reads as written over what only the browser knows. */
const isFormResult = (result: EvalValue, vals: readonly ValueGroup[]): boolean =>
  typeof result !== 'string' && !isValueGroupArray(result) && (result.type === 'Color' || result.type === 'Dimension' || (result.type === 'FunctionCall' && (result.computed || vals.some(isCallValue))));

/** The type of an export's own value, the one thing a form knows of it. */
function exportResult(known: ValueGroup | undefined): CallResult {
  const value = known === undefined ? known : lone(known);
  if (value === undefined || isValueGroupArray(value)) {
    return null;
  }
  switch (value.type) {
    case 'Color': return 'color';
    case 'Dimension': return 'numeric';
    case 'Keyword': return namedColor(value.text) !== undefined || isBrowserColor(value.text) ? 'color' : null;
    case 'FunctionCall': return value.result;
    default: return null;
  }
}

/** An export's `var()` has the type of the export's value, so it is not a substitution that may hold channels (docs/design/CSS-NATIVE-BUILTINS.md §3.8). */
function typedRead(known: ValueGroup | undefined, written: ValueGroup): ValueGroup {
  const call = lone(written);
  return !isValueGroupArray(call) && call.type === 'FunctionCall' && call.name === 'var'
    ? keepAsWritten(withFields(insideParens(call), { result: exportResult(known) }))
    : written;
}

/** The parameter a slot fills: past the last, a variadic's or a rest's last. */
const slotParam = (fn: Fn, slot: number): ParamSpec | undefined => fn.params[Math.min(slot, fn.params.length - 1)];

/** Whether every export a call read is an argument its CSS form takes as what only the browser knows. */
function takesForm<F>(fn: Fn | undefined, known: readonly ValueGroup[], vals: readonly ValueGroup[], inputs: NonNullable<ExportState<F>['inputs']>, ev: SlotEvaluator | null | undefined): boolean {
  if (fn === undefined) {
    return false;
  }
  const slots = new Map<ValueGroup, number>();
  vals.forEach((val, index) => {
    if (!slots.has(lone(val))) {
      slots.set(lone(val), index);
    }
  });
  return inputs.every((input) => {
    const slot = slots.get(input.value);
    return slot !== undefined && slotParam(fn, slot)?.fits?.(slotValue(input.value, ev), known) === true;
  });
}

/** What fills a slot at compile time: the number a `calc()` computes to. */
function slotValue(val: ValueGroup, ev: SlotEvaluator | null | undefined): ValueGroup {
  const value = lone(val);
  return ev != null && !isValueGroupArray(value) && value.type === 'FunctionCall' ? calcOperand(value, ev) : value;
}

/** A call's arguments again, every export read as its compile-time value. */
function knownArguments<F>(x: ExportState<F>, args: (asWritten: boolean) => Array<MaybePromise<ValueGroup>>): Array<MaybePromise<ValueGroup>> {
  const { inputs, writtenRead } = x;
  x.inputs = [];
  x.knownReads = true;
  try {
    return args(false);
  } finally {
    x.inputs = inputs;
    x.writtenRead = writtenRead;
    x.knownReads = false;
  }
}

/** What fills each slot with every export read as its compile-time value, for a call with a slot that asks ({@link fitsWritten}). */
function slotsKnown<F>(x: ExportState<F>, fn: Fn | undefined, args: (asWritten: boolean) => Array<MaybePromise<ValueGroup>>, ev: SlotEvaluator | null | undefined): MaybePromise<ValueGroup[] | undefined> {
  return fn?.params.some(param => param.fits !== undefined) === true
    ? combineAll(knownArguments(x, args), known => known.map(val => slotValue(val, ev)))
    : undefined;
}

/**
 * Whether each slot holds the number an export read inside it computes to
 * (`(@a * 2)`), as `fits` asks of a bare `@a`, in a unit the form can read from what
 * is written. No recipe follows such a read, so a slot that does not is the
 * caller's to report.
 */
function fitsWritten(fn: Fn | undefined, vals: ReadonlyArray<MaybePromise<ValueGroup>>, slots: readonly ValueGroup[]): boolean {
  return slots.every((value, index) => {
    const fits = fn === undefined ? undefined : slotParam(fn, index)?.fits;
    const read = vals[index];
    if (fits === undefined || read === undefined || isThenable(read)) {
      return true;
    }
    if (mixedSum(lone(read))) {
      return false;
    }
    return !isDimension(value) || isDimension(lone(read)) || (fits(value, slots) && (value.unit === '' || knownUnit(lone(read)) !== undefined));
  });
}

/**
 * Whether `v` adds terms of two known units (`(@a + 1px)` of `@a: 50%`), which the
 * known value does not compute either: no form reads it as one quantity.
 */
function mixedSum(v: EvalValue): boolean {
  if (typeof v === 'string' || isValueGroupArray(v)) {
    return false;
  }
  if (v.type === 'FunctionCall') {
    return v.name === 'calc' && mixedSum(v.args);
  }
  return v.type === 'Arithmetic' && (mixedSum(v.left) || mixedSum(v.right)
    || ((v.op === '+' || v.op === '-') && knownUnit(v.left) !== undefined && knownUnit(v.right) !== undefined && knownUnit(v) === undefined));
}

/** Whether a value spells a colour name in any of its items: what the runtime would have to read back as a colour. */
const spellsColorName = (v: ValueGroup): boolean =>
  isValueGroupArray(v)
    ? v.some(spellsColorName)
    : v.type === 'List'
      ? spellsColorName(v.value)
      : v.type === 'Keyword'
        ? namedColor(v.text) !== undefined
        : v.type === 'Color' && namedColor(emitValue(v)) !== undefined;

/** The recipe of a call whose arguments read exports; each argument either is one of `inputs` or holds none. */
function callRecipe<F>(node: FunctionCall, fn: Fn | undefined, vals: readonly ValueGroup[], inputs: NonNullable<ExportState<F>['inputs']>, e: ExportLane<F>): ExportRecipe {
  const origin = fn?.origin;
  if (origin === undefined) {
    exportNotWritten(node, `@${recipeExport(inputs[0]!.recipe)}`, recipeExport(inputs[0]!.recipe), e, 'as the input of a function the runtime cannot run');
  }
  const written = new Set<object>(vals.map(lone));
  const stray = inputs.find(input => !written.has(input.value));
  if (stray !== undefined) {
    exportNotWritten(node, `@${recipeExport(stray.recipe)}`, recipeExport(stray.recipe), e, 'inside a larger argument of a function Jess computes, which the runtime cannot follow');
  }
  const byValue = new Map<object, ExportInput>(inputs.map(input => [input.value, input]));
  const rest = fn?.params.find(param => param.rest === true);
  const runtime = e.s.exports.runtime;
  const args = vals.map((v, index): ExportRecipe | ExportColor | string => {
    const input = byValue.get(lone(v));
    const color = takesColor(fn?.params[index] ?? rest);
    if (input !== undefined) {
      if (color && runtime !== undefined) {
        markColors(runtime, readsOf([input]));
      }
      return input.recipe;
    }
    const keyword = color && !isValueGroupArray(v) && v.type === 'Keyword' ? v : undefined;
    const named = keyword === undefined ? undefined : namedColor(keyword.text);
    if (keyword !== undefined && named !== undefined) {
      return { color: keyword.text, rgb: named.rgb, alpha: named.alpha };
    }
    if (runtime !== undefined && !runtime.literalNames && spellsColorName(v)) {
      runtime.literalNames = true;
    }
    return emitValue(v);
  });
  return { fn: origin, args };
}

/** The first export a recipe reads. */
function recipeExport(recipe: ExportRecipe): string {
  if ('export' in recipe) {
    return recipe.export;
  }
  for (const arg of recipe.args) {
    if (typeof arg !== 'string' && !('color' in arg)) {
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
