/**
 * Clean-room tree2 eval + byte-faithful serializer.
 *
 * This is the decisive rung: tree2 does NOT pre-compose a tree and then print
 * it — it PRODUCES the compositions during a single eval+emit walk. The design
 * is departure #4 (canonical-body + placement-overlay):
 *
 *   - A mixin DEFINITION's body is stored ONCE.
 *   - A mixin CALL is a cheap OVERLAY: a binding frame (param -> arg value node)
 *     plus the current parent-selector context. The call expands by WALKING the
 *     shared body in place — no node is cloned, there is no `cloneForPlacement`
 *     / `inherit` analog. Selector composition happens via the interned-string
 *     primitive; declaration values resolve param refs through the frame.
 *
 * So the eval path stays O(placements) with a tiny constant: each placed nested
 * selector costs one interned-string build, each declaration one frame lookup.
 *
 * Scope is intentionally minimal (mixin defs + positional param bindings +
 * static/spaced values + `@param` substitution). Operations, guards, extend,
 * @media, imports, real variable scoping beyond params are deferred rungs.
 *
 * Entry points:
 *   - `serialize(root)`                     — fast path, no position tracking.
 *   - `serialize(root, { trackPositions })` — + node->offset sourcemap map.
 */

import { renderCombinator } from './node.js';
import type { Node, NodeType } from './node.js';
import {
  any,
  decl,
  dimension,
  interpolation,
  mixinCall,
  operation,
  spaced,
  variableDeclaration,
  isLiteralNode,
  isTypedLiteral,
  compoundCanonical,
  compoundHasInterp,
  complexCanonical,
  complexHasInterp,
  complexHasAmpersand,
  simpleSelector
} from './nodes.js';
import type {
  Any,
  Apply,
  Collection,
  Color,
  Comment,
  ComplexSelector,
  CompoundSelector,
  Declaration,
  DetachedRuleset,
  Dimension,
  For,
  If,
  FunctionCall,
  Interpolation,
  GeneralEnclosed,
  Keyword,
  Reference,
  MixinCall,
  MixinDef,
  ModuleImport,
  Operation,
  PropertyReference,
  Quoted,
  RawInline,
  Range,
  Stylesheet,
  Rule,
  SpacedValue,
  SimpleSelector,
  SelectorList,
  Statement,
  StyleImport,
  ValueNode,
  ValueSlot,
  VarIndirect,
  VariableDeclaration,
  VariableReference
} from './nodes.js';
// [atrule] block + statement at-rule node types
import type { AtRuleBlock, AtRuleStatement, ImportAtRule, OpaqueAtRuleBlock, Plugin } from './at-rule.js';
// typed synchronous value evaluator seam + boundary-clean value domain.
import {
  DEFAULT_MODES,
  emitValue,
  isLiteral,
  literal,
  type EvalModes,
  type FnScope,
  type PluginHost,
  type List as ValueList,
  type Value,
  type ValueEvaluator,
  type ValueObj
} from './value-eval.js';
import type { Fn, FnIo } from './functions/types.js'; // [plugin/P1] scoped-fn registry; [io] file-read seam
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { colorFromSrc, dimensionFromFields, quotedFromFields, materializeAny } from './literal-tag.js'; // [value node model]
import { calcInner, validateFinalUnits } from './value-operate.js'; // [calc/unit validation]
import { emitValueInterp } from './serialize-value.js'; // [interp-precision]
import { makeBlock, makeKeyword, makeBool, makeList } from './value-factory.js'; // [calc]
import { DefaultGuardAmbiguityError, selectDefinitions, type Selection, type DefaultResolver, type CallArg, type CallValue } from './mixin-dispatch.js'; // [guards]
import { evalGuard, guardUsesDefault, type GuardNode, type ValueResolver, type TypedResolver } from './guard.js'; // [guards]
import { computeExtends, type ExtendPlacementResults, type ExtendResults } from './extend.js'; // [extend]
import { documentHasExtend, recordAstExtendProfile } from './extend/plan.js'; // [extend/selector-interp]
import type { PlanInstruction, PlanOverlay, PlanSubject } from './extend/plan.js';
import type { Branch, Level } from './extend/ir.js';
import type { Context } from '../context.js';
import { ERR, WARN } from '../error/diagnostics.js';
import { JessError } from '../error/jess-error.js';
import { lineColAt } from '../error/code-frame.js';
import { sourceSpanOf, valueLayoutOf } from './provenance.js';

/* ---------------------------------------------------- MaybePromise glue */

function mapMaybe<T, U>(m: MaybePromise<T>, f: (t: T) => MaybePromise<U>): MaybePromise<U> {
  return isThenable(m) ? m.then(f) : f(m);
}

function isResolvedArray<T>(arr: Array<MaybePromise<T>>): arr is T[] {
  for (let i = 0; i < arr.length; i++) {
    if (isThenable(arr[i])) {
      return false;
    }
  }
  return true;
}

function combineAll<T, U>(arr: Array<MaybePromise<T>>, f: (ts: T[]) => MaybePromise<U>): MaybePromise<U> {
  return isResolvedArray(arr) ? f(arr) : Promise.all(arr).then(f);
}

/**
 * Narrow the recursive readonly-array arm shared by authored values and mixin
 * call arguments. `Array.isArray` narrows only mutable arrays in TypeScript, so
 * it leaves the public `readonly ValueSlot[]` arm in the scalar branch.
 */
function isValueSlotArray(value: ValueSlot | MixinCall): value is readonly ValueSlot[] {
  return !('type' in value);
}

/** A callable binding is the one scalar arm that is not an ordinary value. */
function isMixinCallValue(value: ValueSlot | MixinCall): value is MixinCall {
  return !isValueSlotArray(value) && value.type === 'MixinCall';
}

export interface Position {
  node: Node;
  type: NodeType;
  start: number;
  end: number;
}

export interface SerializeOptions {
  trackPositions?: boolean;
  /**
   * Injected TYPED synchronous value evaluator (the boundary-safe seam).
   * When present, tree2's `Operation` / `FunctionCall` value nodes are COMPUTED
   * through it over materialized typed value objects; when absent they fall back
   * to un-evaluated source assembly (tree2 does no math itself). tree2 depends
   * only on the `ValueEvaluator` interface.
   */
  evaluator?: ValueEvaluator;
  /** Active canonical execution session. Public rendering uses this Context directly. */
  context?: Context;
  /** Explicit modes for context-free AST consumers (defaults to Context, then `DEFAULT_MODES`). */
  modes?: EvalModes;
  /**
   * [nested/R0] Selector collapse policy (arch E1). `true` (default, 4.x /
   * `collapseNesting:true`) flattens the authored block structure into composed
   * selector strings. `false` (the Less v5 DEFAULT) preserves the authored block
   * structure: a parent rule contains its nested child rules verbatim (each child
   * emits its OWN local selector — `&`/`> .x`/`.b, .c` stay literal), placed
   * mixin bodies splice inline under the call site, and `@media` bodies keep
   * their inner rules nested. Same single walk, second emit form.
   */
  collapseNesting?: boolean;
  /**
   * [resolver] OPTIONAL resolution mode. Default (unset) is STRICT: a
   * value-position variable/lookup that resolves to nothing is a hard eval error
   * (`ReferenceError`). When `true`, a miss instead passes the sigil through as a
   * literal sentinel (no throw) — for opt-in callers that inspect STRUCTURE with
   * intentionally-unbound refs (e.g. serializing a mixin-def body or an interp
   * shape in isolation), and the `isdefined` family.
   */
  optional?: boolean;
  /**
   * [io] OPTIONAL per-render file-read capability handed to the IO built-ins
   * (`data-uri`/`image-size`/`image-width`/`image-height`) via {@link FnCtx.io}.
   * Callers bind it to the relevant source-file directory. Absent → those fns
   * degrade gracefully (a `url()` / verbatim fallback), never throw.
   */
  io?: FnIo;
  /**
   * [plugin/P2] OPTIONAL driver-injected plugin runtime. When present, a
   * `@plugin "specifier"` directive registers the module's functions into its
   * enclosing block's frame, and `host.globalFns` seeds the root frame with
   * config-injected `install`-plugin functions. Absent (the idle path) ⇒ no
   * scoped functions anywhere ⇒ byte- and cost-identical to a plain render.
   */
  pluginHost?: PluginHost;
  /**
   * Optional document-loading capability supplied by the public driver. Core
   * only evaluates the typed import fact and asks for a canonical document; it
   * never resolves paths or selects a parser. `undefined` keeps the import as
   * a CSS terminal, while `{ document: null }` is an intentionally empty
   * import (for example an optional missing Less file).
   */
  importDocument?: (request: ImportDocumentRequest) => MaybePromise<ImportDocument | undefined>;
}

export interface ImportDocumentRequest {
  node: ImportAtRule;
  /** Evaluated, unquoted specifier supplied to the Context/plugin dispatcher. */
  specifier: string;
  /** Evaluated parenthesized option bytes, without the enclosing parentheses. */
  options: string | null;
  /** Evaluated import postlude; `(inline)` uses it as its media wrapper. */
  tail: string | null;
}

export interface ImportDocumentTree {
  document: Stylesheet | null;
  /** Driver-owned canonical identity used only for Less's default import-once rule. */
  key?: string;
  /**
   * Optional driver-owned source scope for a loaded document. Core invokes the
   * child body inside it, so a recursive import resolves relative to that child
   * without giving core a Context, resolver, or parser dependency.
   */
  withinDocument?: (emit: () => MaybePromise<void>) => MaybePromise<void>;
}

/** A Context-read `(inline)` import: raw source is deliberately never parsed. */
export interface ImportDocumentInline {
  readonly inline: string;
  readonly media: string | null;
}

export type ImportDocument = ImportDocumentTree | ImportDocumentInline;

interface PlannedImportDocument {
  request: ImportDocumentRequest;
  loaded: ImportDocument | undefined;
}

/**
 * CSS-terminal imports are facts of the typed import node, not resolver work.
 * Every other eligible target goes through Context's existing plugin dispatcher;
 * Context itself keeps external identifiers terminal unless a plugin claims them.
 */
function canLoadImport(node: ImportAtRule, specifier: string, options: string | null): boolean {
  const optionWords = options === null ? [] : options.toLowerCase().split(',').map(word => word.trim());
  return !optionWords.includes('inline')
    && !optionWords.includes('css')
    && node.alias === null
    && !(specifier.toLowerCase().endsWith('.css') && !optionWords.includes('less'));
}

function importHasOption(options: string | null, option: string): boolean {
  return options !== null && options.toLowerCase().split(',').some(word => word.trim() === option);
}

/**
 * The public path deliberately calls Context itself: there is no Jess-side
 * resolver callback, secondary cache, or AST import bridge. The optional
 * `importDocument` option remains a narrow context-free test seam.
 */
function importThroughContext(context: Context): NonNullable<SerializeOptions['importDocument']> {
  return async ({ node, specifier, options, tail }) => {
    if (importHasOption(options, 'inline')) {
      const bytes = await context.readBinary(specifier);
      return { inline: bytes.toString(), media: tail };
    }
    if (!canLoadImport(node, specifier, options)) {
      return undefined;
    }
    // Parse-mode selection remains Context/plugin-owned. The typed Less `(less)`
    // flag asks the existing dispatcher for its `less` plugin even when the path
    // ends in `.css`; core never chooses or invokes a parser itself.
    const loaded = await context.loadImport(specifier, importHasOption(options, 'less') ? { type: 'less' } : {});
    if (loaded === undefined) {
      return undefined;
    }
    if (loaded.node?.type !== 'Stylesheet') {
      return undefined;
    }
    const document = loaded.node;
    return {
      document,
      key: loaded.resolvedPath,
      withinDocument: emit => context.withDocument(document, emit)
    };
  };
}

export interface SerializeResult {
  css: string;
  /** Present only when `trackPositions` is set. */
  positions?: Position[];
}

/**
 * `serialize` stays SYNCHRONOUS for all-sync value graphs and lifts to
 * `Promise<SerializeResult>` ONLY when a genuinely async built-in (a color-format
 * fn / file-IO fn) forces a leaf onto the async branch — the `isThenable` fork,
 * NOT a global record pre-pass.
 */
export type SerializeReturn = MaybePromise<SerializeResult>;

const INDENT = '  ';

/* ------------------------------------------------------------------- scope */

/**
 * A binding frame (the placement overlay). `mixins` holds definitions visible
 * at this level; `vars` holds param bindings for a mixin call. Frames chain to
 * their lexical parent for lookup.
 */
/**
 * A value bound to a `@name`. Usually a {@link ValueNode}; a `@p: .mk-map()`
 * binding carries a {@link MixinCall} whose OUTPUT the name accesses (`@p[text]`),
 * dispatched lazily on read (see {@link resolveBaseDeclMap}).
 */
type Binding = CallValue;

type MixinRank = readonly number[];

interface OrderedMixinCandidate {
  readonly definition: MixinDef;
  readonly rank: MixinRank;
}

interface OrderedMixinIndex {
  readonly byName: Map<string, OrderedMixinCandidate[]>;
}

interface SelectedMixinPath {
  readonly node: If;
  readonly body: Statement[];
}

interface MixinDefinitionMeta {
  readonly rank: MixinRank;
  readonly selectedPath: readonly SelectedMixinPath[];
}

/** Shared, source-order declaration facts for one lexical body. Never mutated. */
interface DeclIndex {
  readonly byName: Map<string, VariableDeclaration[]>;
}

/** One activation's current binding for a name. */
interface BindingCell {
  declaration: VariableDeclaration;
  value: Binding;
}

/** Render-local closure/source facts for one detached-ruleset binding. */
interface DetachedBinding {
  readonly lexicalFrame: Frame;
  readonly sourceOwner: object | null;
}

/** A declaration as it actually became visible in one rendered ruleset scope.
 * Unlike `statements`, this contains selected control bodies and mixin output in
 * the order the evaluator spliced them. `frame` is deliberately retained: a
 * declaration produced by a mixin evaluates its value in that call frame, while
 * being visible to the caller's property-accessor scope. */
interface PropertyDeclarationFact {
  readonly node: Declaration;
  readonly frame: Frame;
}

/**
 * The authored selector path that led to one nested call site.  This is
 * render-local placement data, not a rewritten selector or an AST overlay:
 * each link keeps the selector node and the exact frame that resolves it.
 */
interface NestedHeaderSource {
  readonly parent: NestedHeaderSource | null;
  readonly selector: SelectorList;
  readonly frame: Frame;
}

/**
 * A selected paren-less ruleset mixin may project its first `&` header onto
 * the call site's authored selector path.  Real mixin definitions never get
 * this fact, so normal nested authored `&` remains literal.
 */
interface NestedRuleMixinPlacement {
  readonly source: NestedHeaderSource;
  readonly callFrame: Frame;
}

/** A canonical ruleset body placed by an already-executed explicit mixin call.
 *
 * This is deliberately a render-frame fact, rather than an AST copy or a
 * `Rule` mutation: a later namespaced call must enter the activation that
 * actually evaluated the rule (and therefore owns its live bindings/imports).
 */
interface PublishedRulesetPlacement {
  readonly rule: Rule;
  readonly frame: Frame;
}

export interface Frame {
  parent: Frame | null;
  /**
   * Identity of one executed `$for`/`each()` iteration when this frame descends
   * from it. This is render-local placement state, never a property of the
   * canonical `For` or `Rule` AST: the same rule body may execute repeatedly
   * with distinct bindings and therefore needs distinct extend-plan facts.
   */
  extendPlacement?: object;
  // [guards] a name maps to ALL same-name defs (overloads), in definition order.
  mixins: Map<string, MixinDef[]> | null;
  /** Immutable, shared declaration stacks. Scoped reads use this only. */
  declIndex: DeclIndex | null;
  /** Per-activation current values. Live reads use this only. */
  cells: Map<string, BindingCell> | null;
  /** Per-activation scoped writes (`:=` and activated scoped conditionals). */
  reassign: Map<string, VariableDeclaration> | null;
  /** Branches selected by this activation; absent until a Jess `$if` executes. */
  selectedIfBodies?: Map<If, Statement[]>;
  /** Source-ordered direct + selected-branch declaration index for this activation. */
  selectedDeclIndex?: DeclIndex | null;
  // [scope-leak] variables UNLOCKED into this frame by a mixin call in its body
  // (`leakBodyVars`). v5 "outer-binding-wins": the mixin-injected variable is NOT
  // hoisted into the ordinary `vars` scope — it is consulted ONLY after the whole
  // lexical chain (`vars` up every `parent`, plus `fallback`) misses. So a name
  // that ANY enclosing scope already binds resolves to that lexical binding
  // (`.tiny-scope`'s `@mix` → root `blue`), while a name bound NOWHERE else falls
  // through to the leaked value (`.heightIsSet`'s `@height` → the leaked `1024px`).
  // This drops the 4.x mixin-injected-variable hoist (which put the leak in `vars`
  // and let it shadow the outer binding → `#989`). See DESIGN-DECISIONS R2.
  leaked?: Map<string, Binding[]> | null;
  // secondary scope consulted after the `parent` chain is exhausted (the
  // detached-ruleset definition closure — caller-first, definition-fallback).
  fallback?: Frame | null;
  // rulesets visible at this level, keyed by their own-local selector
  // string (namespace path descent). Lazily built only when a namespaced call or
  // map/namespace accessor needs it.
  rulesets?: Map<string, Rule[]> | null;
  /** Root rulesets spliced by already-executed imports, in import/source order. */
  importedRules?: Rule[] | null;
  /**
   * Source-ordered direct ruleset placements unlocked by executed explicit
   * mixins. They are visible only to later lookup in this caller frame.
   */
  publishedRules?: PublishedRulesetPlacement[] | null;
  /**
   * Render-local placement frames for rules evaluated in this lexical frame.
   * A nested import executes in the Rule's child frame; namespace descent must
   * therefore retain that frame's imported prefix instead of reconstructing a
   * scope from authored `Rule.body` alone. This belongs to the render frame,
   * never to the immutable AST Rule.
   */
  rulePlacements?: Map<Rule, Frame>;
  // [dedup] source-ordered dispatch candidates keyed by name: parametric MixinDefs
  // AND paren-less ruleset-mixins INTERLEAVED in authored order (unlike `mixins`,
  // which groups all parametric defs). Lazily built once from `statements` and
  // cached; published (unlocked) defs are merged in at lookup from `mixins`.
  orderedMixins?: OrderedMixinIndex | null;
  /** Lexical rank/path facts; indexing does not publish any selected-arm definition. */
  mixinDefinitionMeta?: Map<MixinDef, MixinDefinitionMeta>;
  /** Definitions reached while walking selected arms in this activation. */
  selectedMixinEvents?: Map<string, OrderedMixinCandidate[]>;
  // [closure/publish] a mixin def UNLOCKED into this frame by a body expansion
  // (`publishMixins`) carries its CLOSURE — the callee frame it was authored in,
  // where its params/locals are bound. A later call to that def resolves its free
  // variables + guard in this home, not the frame it was published into
  // (`.lock-mixin(1)` publishes `.inner-locked-mixin` whose `when (@a = 1)` reads
  // the `@a` bound during that expansion). Absent an entry a def's home is the
  // frame it is found in (the ordinary lexical case).
  mixinHomes?: Map<MixinDef, Frame> | null;
  // the statements this frame was built from (for lazy rulesets / decl-map).
  statements?: Statement[] | null;
  /** Evaluated declaration visibility for Less `$property` accessors. */
  propertyTimeline?: PropertyDeclarationFact[] | null;
  // [plugin/P1] functions registered by a `@plugin` (or, later, `@use`) directive
  // textually inside THIS frame's block, keyed lower-case like the global registry.
  // `null`/absent on EVERY frame unless this exact block loaded a scoped function
  // Resolution
  // walks `fns` up the `parent` chain (nearest-first), so a scoped fn is visible in
  // its subtree and shadows a same-name built-in; the chain IS the `parent` chain —
  // no parallel scope structure.
  fns?: Map<string, Fn> | null;
  /** Detached-ruleset closure facts for this activation; never stored on AST nodes. */
  detachedBindings?: Map<DetachedRuleset, DetachedBinding>;
  /** Opaque Context source identity that authored this activation's body. */
  sourceOwner?: object | null;
}

function sourceOwnerForBody(body: object, frame: Frame, e: EvalCtx): object | null {
  return e.context?.sourceOwnerForBody?.(body) ?? frame.sourceOwner ?? null;
}

function withSourceOwner<T>(e: EvalCtx, owner: object | null | undefined, run: () => T | Promise<T>): T | Promise<T> {
  return e.context?.withSourceOwner ? e.context.withSourceOwner(owner, run) : run();
}

function bindDetached(frame: Frame, value: Binding, lexicalFrame: Frame, sourceOwner: object | null): void {
  if (!isDetachedRulesetBinding(value)) {
    return;
  }
  (frame.detachedBindings ??= new Map()).set(value, { lexicalFrame, sourceOwner });
}

function isDetachedRulesetBinding(value: Binding): value is DetachedRuleset {
  return 'type' in value && value.type === 'DetachedRuleset';
}

function detachedBinding(frame: Frame | null, value: Binding): DetachedBinding | undefined {
  if (!isDetachedRulesetBinding(value)) {
    return undefined;
  }
  let fallback: Frame | null | undefined;
  for (let current = frame; current; current = current.parent) {
    const hit = current.detachedBindings?.get(value);
    if (hit) {
      return hit;
    }
    if (current.fallback && !fallback) {
      fallback = current.fallback;
    }
  }
  return fallback ? detachedBinding(fallback, value) : undefined;
}

/** Add already-resolved functions to one lexical frame. */
function addScopedFns(frame: Frame, fns: readonly Fn[], e: EvalCtx): void {
  if (fns.length === 0) {
    return;
  }
  const map = frame.fns ??= new Map();
  for (const fn of fns) {
    map.set(fn.name.toLowerCase(), fn);
  }
  e.anyScopedFns = true;
}

/** Root-only configured functions; typed `Plugin` facts are prepared per body below. */
function globalScopedFns(host: PluginHost | undefined): Map<string, Fn> | null {
  if (!host?.globalFns?.length) {
    return null;
  }
  const fns = new Map<string, Fn>();
  for (const fn of host.globalFns) {
    fns.set(fn.name.toLowerCase(), fn);
  }
  return fns;
}

/**
 * Prepare exactly one lexical body before evaluating it. This deliberately scans
 * only its direct statements (historic Less evaluates imports/plugins before the
 * rest of that same Ruleset), never descends, and never recovers source syntax.
 */
function prepareBodyPlugins(statements: readonly Statement[], frame: Frame, e: EvalCtx): MaybePromise<void> {
  const load = e.pluginHost?.loadPlugin;
  if (!load) {
    return;
  }
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const statement = statements[index]!;
      if (statement.type !== 'Plugin') {
        continue;
      }
      const specifier = statement.target.type === 'Quoted'
        ? statement.target.value
        : statement.target.type === 'Url' && statement.target.value.type === 'Quoted'
          ? statement.target.value.value
          : evalBytesSync(statement.target, frame, e);
      const options = statement.options === null ? null : evalBytesSync(statement.options, frame, e);
      const loaded = load({ specifier, options });
      if (isThenable(loaded)) {
        return loaded.then((fns) => {
          addScopedFns(frame, fns, e);
          return run(index + 1);
        });
      }
      addScopedFns(frame, loaded, e);
    }
  };
  return run(0);
}

/**
 * [plugin/P1] Build the {@link FnScope} a named call consults: a thin view that
 * walks `frame.fns` up the `parent` chain nearest-first, returning the first
 * registration for `name` (lower-cased, like the global registry), or `undefined`
 * so the evaluator falls back to the global built-in registry. Callers gate
 * construction on {@link EvalCtx.anyScopedFns}, so this is never even reached on the
 * idle path (no scoped fn anywhere ⇒ no `FnScope` allocated, no walk).
 */
export function makeFnScope(frame: Frame | null): FnScope {
  return {
    lookup(name: string): Fn | undefined {
      const lname = name.toLowerCase();
      for (let f = frame; f; f = f.parent) {
        const hit = f.fns?.get(lname);
        if (hit) {
          return hit;
        }
      }
      return undefined;
    }
  };
}

// [guards] collect ALL definitions per name (overloaded dispatch), not last-wins.
function collectMixins(statements: Statement[]): Map<string, MixinDef[]> | null {
  let map: Map<string, MixinDef[]> | null = null;
  for (const s of statements) {
    if (s.type === 'MixinDef') {
      const list = (map ??= new Map()).get(s.name);
      if (list) {
        list.push(s);
      } else {
        map.set(s.name, [s]);
      }
    }
  }
  return map;
}

/**
 * Collect immutable, source-ordered declaration facts. Scoped reads walk the
 * resulting stacks lazily and backward; live reads never consult this index.
 */
function collectDeclIndex(
  statements: Statement[],
  params: Map<string, Binding> | null = null
): DeclIndex | null {
  const byName = new Map<string, VariableDeclaration[]>();
  if (params) {
    for (const [name, value] of params) {
      const stack = byName.get(name);
      const declaration = variableDeclaration(name, value, { mode: 'declare' });
      if (stack) {
        stack.push(declaration);
      } else {
        byName.set(name, [declaration]);
      }
    }
  }
  for (const s of statements) {
    if (s.type === 'VariableDeclaration') {
      const stack = byName.get(s.name);
      if (stack) {
        stack.push(s);
      } else {
        byName.set(s.name, [s]);
      }
    }
  }
  return byName.size === 0 ? null : { byName };
}

/**
 * Augment this frame's ordinary declaration index with branches selected by this
 * activation. The ordinary index can contain parameter bindings that do not
 * occur in `statements`; retain those as a prefix while rebuilding authored body
 * declarations around the selected control-flow paths.
 */
function collectSelectedDeclIndex(
  statements: Statement[],
  selected: ReadonlyMap<If, Statement[]>,
  ordinary: DeclIndex | null
): DeclIndex | null {
  const byName = new Map<string, VariableDeclaration[]>();
  const direct = new Set<VariableDeclaration>();
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration') {
      direct.add(statement);
    }
  }
  if (ordinary) {
    for (const [name, stack] of ordinary.byName) {
      const prefix = stack.filter(declaration => !direct.has(declaration));
      if (prefix.length > 0) {
        byName.set(name, prefix);
      }
    }
  }
  const visit = (body: Statement[]): void => {
    for (const statement of body) {
      if (statement.type === 'VariableDeclaration') {
        const stack = byName.get(statement.name);
        if (stack) {
          stack.push(statement);
        } else {
          byName.set(statement.name, [statement]);
        }
      } else if (statement.type === 'If') {
        const branch = selected.get(statement);
        if (branch) {
          visit(branch);
        }
      }
    }
  };
  visit(statements);
  return byName.size === 0 ? null : { byName };
}

/** Seed one activation's live cells from mixin/function parameters. */
function cellsForParams(params: Map<string, Binding> | null): Map<string, BindingCell> | null {
  if (!params) {
    return null;
  }
  const cells = new Map<string, BindingCell>();
  for (const [name, value] of params) {
    const declaration = variableDeclaration(name, value, { mode: 'declare' });
    cells.set(name, { declaration, value });
  }
  return cells;
}

// collect the rulesets defined directly in a scope, keyed by own-local
// selector string (namespace-path descent). Built lazily on first path lookup.
function collectRulesets(statements: Statement[]): Map<string, Rule[]> | null {
  let map: Map<string, Rule[]> | null = null;
  const add = (key: string, s: Rule): void => {
    const list = (map ??= new Map()).get(key);
    if (list) {
      if (!list.includes(s)) {
        list.push(s);
      }
    } else {
      map.set(key, [s]);
    }
  };
  for (const s of statements) {
    if (s.type === 'Rule') {
      for (const c of s.selector.selectors) {
        const key = complexCanonical(c);
        add(key, s);
        // A leading combinator (`#theme { > .mixin {} }` → key `> .mixin`) is a
        // child-descent placement; a namespace-accessor call (`#theme > .mixin()`)
        // dispatches by the bare own-local selector, so also key the stripped form.
        const stripped = key.replace(/^[>+~]\s*/u, '');
        if (stripped !== key) {
          add(stripped, s);
        }
      }
    }
  }
  return map;
}

function frameRulesets(frame: Frame): Map<string, Rule[]> | null {
  if (frame.rulesets !== undefined) {
    return frame.rulesets;
  }
  const built = collectRulesets([...(frame.importedRules ?? []), ...(frame.statements ?? [])]);
  frame.rulesets = built;
  return built;
}

// [guards] collect every visible same-name def up the scope chain (nearest
// scope first), so overload resolution sees all candidates. after the
// `parent` chain, consult the first `fallback` seen (detached-ruleset closure).
function lookupMixinCandidates(frame: Frame | null, name: string): MixinDef[] {
  let out: MixinDef[] | null = null;
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const hit = f.mixins?.get(name);
    if (hit) {
      if (!out) {
        out = hit.slice();
      } else {
        out.push(...hit);
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    // The fallback (caller) chain can rejoin the parent (definition) chain at a
    // shared ancestor, so a def already collected must NOT be dispatched twice —
    // merge by identity, first occurrence wins (mirrors `lookupCandidates`).
    const more = lookupMixinCandidates(fb, name);
    for (const d of more) {
      if (!out?.includes(d)) {
        (out ??= []).push(d);
      }
    }
  }
  return out ?? [];
}

/**
 * [guards] Source-ordered candidate set for `name` within ONE frame: explicit
 * parametric `MixinDef`s AND paren-less rulesets callable as zero-arg mixins,
 * INTERLEAVED in authored order. Less expands every matching body in definition
 * order, and a braceless `.m {…}` sits at its source position AMONG the `.m(…)`
 * overloads — not lumped after all of them (the bug the old `[...defs, ...rules]`
 * concat produced). A frame with no `statements` list (e.g. a decl-map closure)
 * has no rule-mixins and falls back to its explicit-def map.
 */
/**
 * [dedup] Build (once, cached) a frame's source-ordered candidate map: for every
 * name, its parametric `MixinDef`s and paren-less ruleset-mixins in the order they
 * were authored. One O(statements) pass — the same cost class as
 * {@link collectMixins} / {@link collectRulesets} — so per-call lookup stays O(1)
 * (a map `get`), not a per-call statement walk.
 */
function orderedMixinsForStatements(statements: Statement[], f: Frame, e: EvalCtx): OrderedMixinIndex | null {
  const byName = new Map<string, OrderedMixinCandidate[]>();
  const add = (name: string, definition: MixinDef, rank: MixinRank): void => {
    const list = byName.get(name);
    const candidate = { definition, rank };
    if (list) {
      list.push(candidate);
    } else {
      byName.set(name, [candidate]);
    }
  };
  for (let index = 0; index < statements.length; index++) {
    const s = statements[index]!;
    if (s.type === 'MixinDef') {
      add(s.name, s, [index]);
    } else if (s.type === 'Rule') {
      // The names this rule answers to as a zero-arg mixin: each selector's
      // canonical form plus its leading-combinator-stripped form (mirrors the keys
      // `collectRulesets` builds). Collect UNIQUE keys first so a rule with two
      // selectors that canonicalize alike adds ONE candidate, not two.
      // [mixin-interp] an INTERPOLATED selector (`.@{name}`) keys under its RESOLVED
      // name in this frame (`.@{a1}` with `@a1: foo` answers to `.foo()`), so a call
      // dispatches on the concrete name the parser could not know statically.
      let keys: Set<string> | null = null;
      for (const c of s.selector.selectors) {
        const key = complexHasInterp(c) ? resolveComplexSync(c, f, e) : complexCanonical(c);
        (keys ??= new Set<string>()).add(key);
        const stripped = key.replace(/^[>+~]\s*/u, '');
        if (stripped !== key) {
          keys.add(stripped);
        }
      }
      if (keys) {
        for (const key of keys) {
        // one synthesized candidate per name, interleaved at the rule's source position.
        // [guards] a guarded ruleset called as a zero-arg mixin filters on its guard.
          const rm: MixinDef = {
            type: 'MixinDef', name: key, params: [], body: s.body, ruleMixin: true,
            ...(s.guard !== undefined ? { guard: s.guard } : {})
          };
          add(key, rm, [index]);
        }
      }
    }
  }
  return byName.size === 0 ? null : { byName };
}

function frameOrderedMixins(f: Frame, e: EvalCtx): OrderedMixinIndex | null {
  if (f.orderedMixins !== undefined) {
    return f.orderedMixins;
  }
  const st = f.statements;
  return (f.orderedMixins = st ? orderedMixinsForStatements(st, f, e) : null);
}

function compareMixinRanks(a: MixinRank, b: MixinRank): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return a[i]! - b[i]!;
    }
  }
  return a.length - b.length;
}

function frameMixinDefinitionMeta(frame: Frame): Map<MixinDef, MixinDefinitionMeta> {
  if (frame.mixinDefinitionMeta) {
    return frame.mixinDefinitionMeta;
  }
  const meta = new Map<MixinDef, MixinDefinitionMeta>();
  const visit = (body: Statement[], rank: MixinRank, selectedPath: readonly SelectedMixinPath[]): void => {
    for (let index = 0; index < body.length; index++) {
      const statement = body[index]!;
      const at = [...rank, index];
      if (statement.type === 'MixinDef') {
        meta.set(statement, { rank: at, selectedPath });
      } else if (statement.type === 'If') {
        for (const branch of statement.branches) {
          visit(branch.body, at, [...selectedPath, { node: statement, body: branch.body }]);
        }
      }
    }
  };
  if (frame.statements) {
    visit(frame.statements, [], []);
  }
  frame.mixinDefinitionMeta = meta;
  return meta;
}

/** Publish one definition only when execution reaches it through an active `$if` arm. */
function publishSelectedMixinDefinition(frame: Frame, definition: MixinDef): void {
  const meta = frameMixinDefinitionMeta(frame).get(definition);
  if (!meta || meta.selectedPath.length === 0) {
    return;
  }
  const selected = frame.selectedIfBodies;
  if (!selected || !meta.selectedPath.every(path => selected.get(path.node) === path.body)) {
    return;
  }
  const events = frame.selectedMixinEvents ??= new Map<string, OrderedMixinCandidate[]>();
  const list = events.get(definition.name);
  if (list?.some(candidate => candidate.definition === definition)) {
    return;
  }
  const candidate = { definition, rank: meta.rank };
  if (!list) {
    events.set(definition.name, [candidate]);
    return;
  }
  let index = list.length;
  while (index > 0 && compareMixinRanks(candidate.rank, list[index - 1]!.rank) < 0) {
    index--;
  }
  list.splice(index, 0, candidate);
}

/**
 * An imported document is a lexical splice, not a new evaluator root. Its
 * definitions become visible only after the import has executed; keep that
 * fact on the existing frame map rather than creating a wrapper document or a
 * second lookup path.
 */
function publishImportedMixinDefinition(frame: Frame, definition: MixinDef): void {
  const mixins = frame.mixins ??= new Map();
  const candidates = mixins.get(definition.name);
  if (candidates) {
    candidates.push(definition);
  } else {
    mixins.set(definition.name, [definition]);
  }
}

/** Publish an imported declaration into the current frame's existing scoped index. */
function publishImportedVariableDeclaration(frame: Frame, declaration: VariableDeclaration): void {
  const index = frame.declIndex ??= { byName: new Map() };
  const declarations = index.byName.get(declaration.name);
  if (declarations) {
    declarations.push(declaration);
  } else {
    index.byName.set(declaration.name, [declaration]);
  }
}

/** Publish an imported root ruleset for namespace-path descent. Import rules are
 * ordered before the importing document's own source facts, matching lexical
 * splice order for an import that has executed at this point. */
function publishImportedRuleset(frame: Frame, rule: Rule): void {
  (frame.importedRules ??= []).push(rule);
  // It may have been materialized before this import; rebuild lazily with the
  // newly published import prefix on the next namespace lookup.
  frame.rulesets = undefined;
}

/**
 * Imported callables execute later in their importer frame, but any nested
 * import in their shared body remains relative to the source document that
 * authored it. Record that source scope on Context's session-owned provenance
 * table; AST facts stay plain and no render-local ownership map is needed.
 */
function rememberImportedCallableBodies(
  document: Stylesheet,
  children: readonly Statement[],
  context: Context | undefined
): void {
  if (!context) {
    return;
  }
  for (const child of children) {
    if (child.type === 'MixinDef' || child.type === 'Rule') {
      context.rememberDocumentBody(document, child.body);
    }
  }
}

/**
 * [dedup] A frame's source-ordered candidate list for `name`: the cached
 * interleaved parametric-def/ruleset-mixin list, plus any dynamically PUBLISHED
 * defs (detached-ruleset scope unlocking via `@rs()`, which pushes into `mixins`
 * without touching `statements`) appended.
 */
function frameCandidatesInOrder(f: Frame, name: string, e: EvalCtx): MixinDef[] {
  const mapDefs = f.mixins?.get(name);
  if (!f.statements) {
    return mapDefs?.slice() ?? [];
  }
  const base = frameOrderedMixins(f, e)?.byName.get(name) ?? [];
  const events = f.selectedMixinEvents?.get(name) ?? [];
  const out: MixinDef[] = [];
  let baseIndex = 0;
  let eventIndex = 0;
  while (baseIndex < base.length || eventIndex < events.length) {
    const direct = base[baseIndex];
    const selected = events[eventIndex];
    if (!selected || (direct !== undefined && compareMixinRanks(direct.rank, selected.rank) <= 0)) {
      out.push(direct!.definition);
      baseIndex++;
    } else {
      out.push(selected.definition);
      eventIndex++;
    }
  }
  if (!mapDefs) {
    return out;
  }
  // Append published defs (in `mixins` but not authored in `statements`).
  for (const d of mapDefs) {
    if (!out.includes(d)) {
      out.push(d);
    }
  }
  return out;
}

/**
 * [guards] All source-ordered candidates for a bare `.m()` call up the scope chain
 * (nearest frame first), then the detached-ruleset `fallback` closure. The
 * interleaving replacement for the old `[...lookupMixinCandidates, ...lookupRuleMixins]`
 * concat, which dispatched every rule-mixin after every parametric def and so
 * mis-ordered overloaded output (`A B C border` instead of `A B border C`).
 */
function lookupCandidates(
  frame: Frame | null,
  name: string,
  e: EvalCtx,
  homes?: Map<MixinDef, Frame> // [closure] def → the frame it was DEFINED in
): MixinDef[] {
  let out: MixinDef[] | null = null;
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const hit = frameCandidatesInOrder(f, name, e);
    if (hit.length) {
      // [closure/publish] a def UNLOCKED into `f` keeps its authored closure home
      // (`f.mixinHomes`); an ordinarily-declared def is homed at `f`.
      if (homes) {
        for (const d of hit) {
          if (!homes.has(d)) {
            homes.set(d, f.mixinHomes?.get(d) ?? f);
          }
        }
      }
      if (!out) {
        out = hit.slice();
      } else {
        out.push(...hit);
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    // The [closure] fallback chain (caller scope) can rejoin the parent (definition)
    // chain at a shared ancestor, so a def already collected must NOT be dispatched
    // twice: merge the fallback candidates by identity, first occurrence wins.
    const more = lookupCandidates(fb, name, e, homes);
    for (const d of more) {
      if (!out?.includes(d)) {
        (out ??= []).push(d);
      }
    }
  }
  return out ?? [];
}

/**
 * [mixin-match] Split a selector-token string into mixin-match ATOMS (`.foo` /
 * `#bar`), dropping combinators and the parent-ref `&` — Less resolves a mixin
 * call/definition on element VALUES only (`Selector.mixinElements`), so
 * combinator (` ` vs `>` vs compound-`.`) is irrelevant to the match and `&`
 * contributes nothing. `&.support` → [`.support`]; `.a.b` and `.a .b` both →
 * [`.a`, `.b`]. */
function selectorAtoms(text: string): string[] {
  const m = text.match(/[#.][\w-]+|&[\w-]*|[\w-]+/gu);
  if (!m) {
    return [];
  }
  const out: string[] = [];
  for (const a of m) {
    if (a === '&') {
      continue;
    }
    out.push(a.charAt(0) === '&' ? a.slice(1) : a);
  }
  return out;
}

/** [mixin-match] The element-value atom list of a `ComplexSelector` selector (head +
 * each tail compound), used to match a namespaced/compound mixin call. */
function complexAtoms(c: ComplexSelector): string[] {
  const out: string[] = [];
  for (const a of selectorAtoms(compoundCanonical(c.head))) {
    out.push(a);
  }
  for (const seg of c.tail) {
    for (const a of selectorAtoms(compoundCanonical(seg.compound))) {
      out.push(a);
    }
  }
  return out;
}

/** [mixin-match] The flat element-value atom list of a namespaced/compound mixin
 * CALL (`.a.b.c()` / `#ns > .m()` / `.do.re.mi()`), path segments then name. */
function callAtoms(call: MixinCall): string[] {
  const out: string[] = [];
  for (const p of call.path) {
    for (const a of selectorAtoms(p.sel)) {
      out.push(a);
    }
  }
  for (const a of selectorAtoms(call.name)) {
    out.push(a);
  }
  return out;
}

/** True iff `pref` is a prefix of `full` (element-value equality). */
function atomsArePrefix(pref: string[], full: string[]): boolean {
  if (pref.length > full.length) {
    return false;
  }
  for (let i = 0; i < pref.length; i++) {
    if (pref[i] !== full[i]) {
      return false;
    }
  }
  return true;
}

/**
 * [mixin-match] Recursively collect the mixin candidates a namespaced/compound
 * call resolves to WITHIN one scope's own rulesets (Less `Ruleset.find`): a
 * ruleset whose element atoms are a prefix of `remaining` either terminates the
 * match (its whole element run is consumed → its body is a zero-arg mixin) or
 * descends (a proper prefix → recurse into its body with the tail). A parametric
 * `MixinDef` terminates when its name atoms equal `remaining` exactly. Each
 * pushed candidate records its DEFINITION scope in `homes` (closure/guard scope).
 */
function findPathInScope(
  scope: Frame,
  remaining: string[],
  homes: Map<MixinDef, Frame>,
  out: MixinDef[],
  e: EvalCtx
): void {
  const st = scope.statements;
  const visit = (s: Statement, placement?: Frame): void => {
    if (s.type === 'MixinDef') {
      const nEl = selectorAtoms(s.name);
      if (nEl.length === 0 || !atomsArePrefix(nEl, remaining)) {
        return;
      }
      if (nEl.length === remaining.length) {
        out.push(s);
        if (!homes.has(s)) {
          homes.set(s, scope);
        }
      } else {
        // [namespace-descent] An intermediate mixin namespace receives the implicit
        // zero-argument call.  Reuse normal dispatch so required parameters and guards
        // participate before entering its body; only the terminal segment receives the
        // authored arguments.
        if (dispatch([s], mixinCall(s.name), scope, e).length === 0) {
          return;
        }
        const child: Frame = {
          parent: scope,
          mixins: collectMixins(s.body),
          declIndex: collectDeclIndex(s.body), cells: null, reassign: null,
          statements: s.body
        };
        findPathInScope(child, remaining.slice(nEl.length), homes, out, e);
      }
    } else if (s.type === 'Rule') {
      for (const c of s.selector.selectors) {
        // [mixin-interp] an interpolated selector resolves in THIS scope before its
        // element atoms are taken, so a compound/namespaced call matches on the
        // concrete name (`#@{c1}-foo > .@{c2}()` answers `#foo-foo > .bar()`).
        // A published rule retains its evaluated child placement; selector
        // interpolation itself resolves one frame outside that child, in the
        // explicit mixin activation which supplied its parameters.
        const selectorFrame = placement?.parent ?? scope;
        const el = complexHasInterp(c) ? selectorAtoms(resolveComplexSync(c, selectorFrame, e)) : complexAtoms(c);
        if (el.length === 0 || !atomsArePrefix(el, remaining)) {
          continue;
        }
        if (el.length === remaining.length) {
          const rm: MixinDef = {
            type: 'MixinDef',
            name: complexHasInterp(c) ? resolveComplexSync(c, selectorFrame, e) : complexCanonical(c),
            params: [], body: s.body, ruleMixin: true,
            ...(s.guard !== undefined ? { guard: s.guard } : {})
          };
          out.push(rm);
          homes.set(rm, placement ?? scope);
        } else {
          // Rulesets are namespace containers too, so a false Less `when` guard
          // prevents descent just as it prevents ordinary rule emission.
          if (!ruleGuardPasses(s, scope, e)) {
            continue;
          }
          // This Rule may have executed imports in its render-local placement.
          // Preserve that imported prefix for recursive namespace descent rather
          // than rebuilding a scope from the authored body alone.
          const activePlacement = placement ?? scope.rulePlacements?.get(s);
          const body = activePlacement
            ? null
            : [...(scope.rulePlacements?.get(s)?.importedRules ?? []), ...s.body];
          const child: Frame = activePlacement ?? {
            parent: scope,
            mixins: collectMixins(body!),
            declIndex: collectDeclIndex(body!), cells: null, reassign: null,
            statements: body!
          };
          findPathInScope(child, remaining.slice(el.length), homes, out, e);
        }
        break; // one selector of a rule matches the prefix at most once
      }
    }
  };
  // Imported root rules are lexical splices in this scope. They must take part
  // in element-value namespace descent just like authored rules, and are kept
  // ahead of the importing document's source facts in import execution order.
  for (const s of scope.importedRules ?? []) {
    visit(s);
  }
  for (const s of st ?? []) {
    visit(s);
  }
  // Explicit mixin expansion can publish canonical rulesets at the call site.
  // Keep each activation frame beside its source Rule: a shared Rule node can
  // be placed more than once with different live values, so `Map<Rule, Frame>`
  // alone is not a truthful representation here.
  for (const published of scope.publishedRules ?? []) {
    visit(published.rule, published.frame);
  }
}

/**
 * [mixin-match] Source-ordered candidates for a namespaced/compound call, found
 * by element-value descent. Walk the scope chain from the call site; the FIRST
 * frame whose own rulesets yield a match wins (Less iterates `context.frames`
 * and uses the first that `find`s the selector). Supersedes the old
 * one-key-per-segment `descendNamespacePath` + `ownCandidates`, which could not
 * match a compound def (`.jo.ki()`), an `&`-nested step (`.amp.support()`), or a
 * call whose compound run spans a descendant-nested definition
 * (`.do.re.mi.fa.sol.la.si()`). */
function findPathCandidates(frame: Frame, call: MixinCall, e: EvalCtx, homes: Map<MixinDef, Frame>): MixinDef[] {
  const elements = callAtoms(call);
  if (elements.length === 0) {
    return [];
  }
  for (let f: Frame | null = frame; f; f = f.parent) {
    const out: MixinDef[] = [];
    findPathInScope(f, elements, homes, out, e);
    if (out.length) {
      return out;
    }
    if (f.fallback) {
      findPathInScope(f.fallback, elements, homes, out, e);
      if (out.length) {
        return out;
      }
    }
  }
  return [];
}

/**
 * [parent-exclusion] Is `body` (a ruleset-mixin's source Rule body array) held by
 * an ENCLOSING frame on the active expansion stack — i.e. is this candidate the
 * mixin/ruleset we are already inside?
 *
 * This is the mixin half of the ONE exclusion principle this file uses to break
 * self-reference: a self-reference that cannot make PROGRESS is EXCLUDED from
 * candidacy, so resolution falls through to a real (progressing) binding rather
 * than re-entering itself.
 *   - Variable half — `resolveVarStack` / `resolvePropRef` `continue` past any
 *     value node in `e.excluded` (the declaration whose value is currently being
 *     evaluated), so `@a: @a + 1` skips its own node and binds an earlier `@a`.
 *   - Mixin half (here) — a NON-PARAMETRIC ruleset self-call excludes its own
 *     enclosing frame from the candidate set, so `.recursion { .recursion(); }`
 *     re-binds to a same-name parametric def (or no-ops) instead of re-entering
 *     its own body. A non-parametric re-entry can carry no new args and so makes
 *     no progress; skipping it is exactly right. This is NOT "recursion
 *     detection" — it is the enclosing frame declining to be its own candidate.
 *     Parametric recursion (`.loop(@n - 1)`) DOES progress (new args) and is
 *     never excluded here; guards terminate it, and the depth backstop in
 *     `expandCall` catches a non-terminating (bad-guard) runaway.
 *
 * The frame chain (`parent`, then the detached-ruleset `fallback` closure)
 * reflects the dynamic nesting — a Rule placement (`flatten`) and a mixin
 * expansion (`expandCall`) both seed the child frame's `statements` with the body
 * being walked — so an identity hit means we are inside that very ruleset. Mirrors
 * less@4's `mixin === context.frames[f]` check, scoped to ruleset-mixins.
 */
function parentExcludes(frame: Frame | null, body: Statement[]): boolean {
  for (let f = frame; f; f = f.parent) {
    if (f.statements === body) {
      return true;
    }
    if (f.fallback && parentExcludes(f.fallback, body)) {
      return true;
    }
  }
  return false;
}

/**
 * The nearest last-wins binding for `name` (top of the nearest non-empty stack).
 * Used by the detached-ruleset / namespace paths that need the CURRENT value node
 * (e.g. to test `.type === 'DetachedRuleset'`); it does not honor exclusion
 * because those callers resolve a name to a concrete ruleset binding, not a lazy
 * self-referential value. The regular value read uses `resolveVarRef` instead.
 */
function lookupLiveCell(frame: Frame | null, name: string): { value: Binding; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const hit = f.cells?.get(name);
    if (hit) {
      return { value: hit.value, frame: f };
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    return lookupLiveCell(fb, name);
  }
  return undefined;
}

function lookupLeakedBinding(frame: Frame | null, name: string, e?: EvalCtx): { value: Binding; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = f.leaked?.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const value = stack[i]!;
        if (!e?.excluded.has(value)) {
          return { value, frame: f };
        }
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    return lookupLeakedBinding(fb, name, e);
  }
  return undefined;
}

function lookupScopedBinding(frame: Frame | null, name: string, e?: EvalCtx): { value: Binding; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const replacement = f.reassign?.get(name);
    if (replacement && (!e?.excluded.has(replacement.value))) {
      return { value: replacement.value, frame: f };
    }
    const stack = (f.selectedDeclIndex ?? f.declIndex)?.byName.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const declaration = stack[i]!;
        // Non-declare writes live only in the activation overlay. Their source
        // facts stay indexed for provenance, but must not become final bindings
        // before the source-order write executes.
        if (declaration.write.mode !== 'declare') {
          continue;
        }
        if (!e?.excluded.has(declaration.value)) {
          return { value: declaration.value, frame: f };
        }
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    return lookupScopedBinding(fb, name, e);
  }
  return undefined;
}

function lookupVar(frame: Frame | null, name: string): Binding | undefined {
  return lookupScopedBinding(frame, name)?.value
    ?? lookupLiveCell(frame, name)?.value
    ?? lookupLeakedBinding(frame, name)?.value;
}

/**
 * [resolver] Resolve a regular `@name`/`$name` read to its winning declaration
 * value node PLUS the frame that owns it, honoring the active EXCLUSION set. The
 * backward `for` walk over each frame's per-name stack `continue`s past any value
 * node currently being evaluated (in `e.excluded`); the first survivor wins, else
 * it ascends to `parent` (then the detached-ruleset `fallback` closure). This is
 * the cycle guard: `@a: @a + 1` excludes its own node → skips it → falls back to
 * an earlier `@a` (or misses); `@a: @b; @b: @a` accumulates both exclusions and
 * terminates at any depth. There is NO depth cap. The value is returned with its
 * OWNING frame so it evaluates in its declaration scope. */
function resolveVarRef(frame: Frame | null, name: string, lookup: 'live' | 'scoped', e: EvalCtx): { value: Binding; frame: Frame } | undefined {
  return lookup === 'live'
    ? lookupLiveCell(frame, name)
    : lookupScopedBinding(frame, name, e) ?? lookupLeakedBinding(frame, name, e);
}

function activateVariableDeclaration(node: VariableDeclaration, frame: Frame, e: EvalCtx): void {
  bindDetached(frame, node.value, frame, sourceOwnerForBody(
    'type' in node.value && node.value.type === 'DetachedRuleset' ? node.value.body : node,
    frame,
    e
  ));
  if (node.write.mode === 'if-absent') {
    const found = node.write.lookup === 'live'
      ? lookupLiveCell(frame, node.name)
      : lookupScopedBinding(frame, node.name, e);
    if (found) {
      return;
    }
    (frame.cells ??= new Map()).set(node.name, { declaration: node, value: node.value });
    (frame.reassign ??= new Map()).set(node.name, node);
    return;
  }
  if (node.write.mode === 'reassign') {
    if (node.write.lookup === 'live') {
      const found = lookupLiveCell(frame, node.name);
      if (!found) {
        throw new ReferenceError(`live variable $${node.name} is undefined`);
      }
      found.frame.cells!.set(node.name, { declaration: node, value: node.value });
      return;
    }
    const found = lookupScopedBinding(frame, node.name, e);
    if (!found) {
      throw new ReferenceError(`scoped variable $$${node.name} is undefined`);
    }
    (found.frame.reassign ??= new Map()).set(node.name, node);
    return;
  }
  (frame.cells ??= new Map()).set(node.name, { declaration: node, value: node.value });
}

/**
 * [property-accessor] Resolve a `$name` property accessor to the winning
 * declaration of CSS property `name` in scope. Less "property accessors" read the
 * LAST declaration of the property in the enclosing ruleset (last-wins, lazy) and
 * cascade up the ruleset chain (`$color` in a nested rule reads the parent
 * ruleset's final `color`). The lookup carries the source declaration's
 * `!important` flag to the caller's existing declaration/merge importance sink;
 * it never encodes importance into value bytes.
 * The lookup reads the frame's evaluated declaration timeline, rather than its
 * authored `statements`: a mixin call and a selected control arm make their
 * declarations visible only once their body is actually spliced, and those
 * declarations evaluate in their call frame. The backward walk skips any
 * declaration whose value is currently on the exclusion set, which breaks the
 * self-reference `color: $color` (its own value node is excluded during
 * evaluation, so the accessor falls back to an earlier / ancestor `color`). */
function recordPropertyDeclaration(scope: Frame, node: Declaration, frame: Frame): PropertyDeclarationFact {
  const timeline = scope.propertyTimeline ??= [];
  const fact = { node, frame };
  timeline.push(fact);
  return fact;
}

function resolvePropRef(
  frame: Frame | null,
  name: string,
  e: EvalCtx
): { value: ValueSlot; frame: Frame; important: boolean; merged?: readonly PropertyDeclarationFact[] } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const timeline = f.propertyTimeline;
    if (timeline) {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const { node: s, frame: valueFrame } = timeline[i]!;
        if (e.excluded.has(s.value)) {
          continue;
        }
        let nm: string;
        if (typeof s.name === 'string') {
          nm = s.name;
        } else {
          // A declaration with an INTERPOLATED name — guard against re-entering it
          // while resolving the very property its own name interpolates (`${prop-name}`).
          if (e.propNames.has(s)) {
            continue;
          }
          e.propNames.add(s);
          nm = declName(s, valueFrame, e);
          e.propNames.delete(s);
        }
        if (nm === name) {
          if (s.merge !== null) {
            const merged: PropertyDeclarationFact[] = [];
            // The ordered timeline is also the merge-input order. A merge run
            // ends at the nearest non-merge / differently named declaration;
            // never reconstruct source text or create a synthetic value node.
            for (let j = i; j >= 0; j--) {
              const member = timeline[j]!;
              if (member.node.merge === null || e.excluded.has(member.node.value)) {
                break;
              }
              let memberName: string;
              if (typeof member.node.name === 'string') {
                memberName = member.node.name;
              } else {
                if (e.propNames.has(member.node)) {
                  break;
                }
                e.propNames.add(member.node);
                memberName = declName(member.node, member.frame, e);
                e.propNames.delete(member.node);
              }
              if (memberName !== name) {
                break;
              }
              merged.push(member);
            }
            merged.reverse();
            if (merged.length > 0) {
              return {
                value: s.value,
                frame: valueFrame,
                important: merged.some(member => member.node.important === true),
                merged
              };
            }
          }
          return { value: s.value, frame: valueFrame, important: s.important === true };
        }
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    return resolvePropRef(fb, name, e);
  }
  return undefined;
}

/**
 * [resolver] Evaluate a resolved variable's value node while it is EXCLUDED for
 * the sync span of the eval — added before the (possibly recursive) evaluation
 * begins, removed the instant that call returns SYNCHRONOUSLY (the `finally` runs
 * on the sync return, NOT on a later promise settle — so accumulation is correct
 * down a sync descent, and two overlapping async reads of the same decl do not
 * falsely block each other). `run` returns whatever the caller's fold produces. */
function withExcluded<T>(e: EvalCtx, node: Binding, run: () => T): T {
  e.excluded.add(node);
  try {
    return run();
  } finally {
    e.excluded.delete(node);
  }
}

/**
 * [resolver] An unresolved value-position reference. STRICT (default): a miss is
 * a hard eval error (`ReferenceError`) — the single consolidated site for what
 * were five hardcoded ``@${name}`` passthroughs. OPTIONAL (`e.optional`, set by
 * `isdefined` / opt-in callers): a miss returns the literal sigil string as a
 * sentinel, no throw. */
/**
 * Evaluate a variable BINDING in a value position. A `@p: .mk-map()` mixin-call
 * binding is not byte-serializable there — it is only accessible/callable (`@p[k]`,
 * `@p()`), so like a detached ruleset reaching a value position it folds to empty
 * bytes; every other binding is an ordinary value node. */
function evalBinding(b: Binding, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  return 'type' in b && b.type === 'MixinCall' ? literal('') : evalValueSlot(b, frame, e);
}

function unresolvedSymbol(node: object, symbol: string, e: EvalCtx): never {
  const file = e.context?.sourceContext?.file;
  const source = file?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  const location = source === undefined || span === undefined
    ? undefined
    : lineColAt(source, span.start);
  throw ERR.nameNotFound({
    node,
    filePath: file?.fullPath,
    source,
    line: location?.line,
    column: location?.column,
    meta: { symbol }
  });
}

function unresolvedRef(node: VariableReference | VarIndirect, name: string, e: EvalCtx): Value {
  if (!e.optional) {
    unresolvedSymbol(node, `@${name}`, e);
  }
  return literal(`@${name}`);
}

/**
 * A statement-position {@link MixinCall} is an obligatory resolution operation.
 * It is not a CSS `FunctionCall` and therefore has no optional-reference
 * fallback.  Function failure policy belongs only to `ValueEvaluator.call`,
 * after a function was actually resolved and invoked.
 */
function unresolvedMixinCall(call: MixinCall, e: EvalCtx): never {
  const path = call.path.map(segment => segment.sel).join(' ');
  return unresolvedSymbol(call, `${path ? `${path} ` : ''}${call.name}()`, e);
}

/**
 * [guards] A SYNC byte resolver bound to a frame — resolves a value node to its
 * (variable-resolved) byte source. Used by mixin dispatch to eagerly resolve args
 * in the caller frame (pattern-match by bytes) and `@arguments`/rest joining.
 * Dispatch positions are sync (no async fns appear in guard/pattern positions);
 * a stray async value there raises rather than being silently mis-dispatched.
 */
function makeResolver(frame: Frame | null, e: EvalCtx): ValueResolver {
  return (v: ValueSlot) => {
    const b = evalBytes(v, frame, e);
    if (isThenable(b)) {
      throw new Error('async value in a synchronous dispatch position');
    }
    return b;
  };
}

/**
 * [R2/guards] A TYPED resolver: materializes a value node to a typed `ValueObj`
 * (guard leaves compare typed values / call type-fns). Sync for the same reason.
 */
function makeTypedResolver(frame: Frame | null, e: EvalCtx): TypedResolver {
  return (v: ValueSlot) => {
    const val = evalTypedSlot(v, frame, e);
    if (isThenable(val)) {
      throw new Error('async value in a synchronous guard position');
    }
    return val;
  };
}

/* ---------------------------------------------------- typed value eval */

/** The evaluator + modes carried through the value lane (a slim view of Emit). */
interface EvalCtx {
  ev: ValueEvaluator | null;
  modes: EvalModes;
  /** Context supplies document source only on cold diagnostic paths. */
  context?: Context;
  // [resolver] value nodes currently being evaluated (per-declaration cycle
  // guard). A backward stack walk `continue`s past any node in this set; it
  // accumulates down a sync descent and releases on sync-phase completion.
  excluded: Set<Binding>;
  // [resolver] when true, a variable/lookup miss returns a sentinel instead of
  // throwing (`isdefined` / opt-in callers). Default (unset) is STRICT: miss
  // throws `ReferenceError`.
  optional?: boolean;
  // [calc] `calc(…)` nesting depth. While > 0, dimension math is gated to the
  // safe-unit subset and cross-unit ops preserve as `calc(…)` sub-expressions.
  calcDepth?: number;
  /** Parenthesized AST value nesting enables Less arithmetic in paren modes. */
  parenDepth?: number;
  // [property-interp] declarations whose INTERPOLATED name (`${prop}: …` /
  // `@{v}: …`) is being resolved up-stack. `resolvePropRef` skips a candidate whose
  // name is already in flight, breaking the self-reference `${prop-name}: red` where
  // `prop-name`'s own accessor would otherwise re-enter this decl's name forever.
  propNames: Set<Declaration>;
  // [important] Less `importantScope`: while resolving one declaration's value, an
  // `Important`-wrapped variable reference (`@v: @c !important`) sets `hit`, so the
  // enclosing declaration hoists a SINGLE trailing `!important`. Installed per
  // declaration by `putValue`; absent elsewhere (importance is meaningless outside
  // a declaration value, e.g. an at-rule prelude / interpolated name).
  importantSink?: { hit: boolean };
  // [important] Scalar equivalent of `importantSink` for a merged declaration
  // member. The merge path already owns one combined output line, so it carries
  // the signal on the existing emit state instead of allocating a sink per member.
  mergeImportant?: boolean;
  // [default-fn] The `default()` value inside a guard OPERAND (`when (@x =
  // default())`): the mixin-dispatch decision (true iff no non-default def matched).
  // Set only on the ctx of a guard-operand typed resolver; absent everywhere else,
  // where `default()` emits verbatim (`case: default()` outside a guard).
  defaultFn?: () => boolean;
  // [plugin/P1] document-level flag: true iff SOME frame registered a scoped
  // function. When false — every real
  // document today, since nothing registers yet — `evalCall` passes `scope = null`
  // to `ev.call` and the frame walk is skipped entirely, keeping the fn-dispatch
  // hot path byte- and cost-identical to before P1. Set once at top-level
  // `serialize`; threaded through the shared `EvalCtx`.
  anyScopedFns?: boolean;
  // [io] per-render file-read capability for the IO built-ins (`data-uri`/
  // `image-*`), forwarded to `ev.call` and thence to `FnCtx.io`. Set once at
  // top-level `serialize` from `SerializeOptions.io`; absent on renders with no
  // IO host wired (every value fn but the IO Tier-C set ignores it).
  io?: FnIo;
  // [plugin/P2] driver-injected plugin runtime, threaded so nested frame
  // construction can register a scope-local `@plugin`'s functions. Absent on the
  // idle path (no plugins).
  pluginHost?: PluginHost;
  /** Runtime-only lexical homes for mixin calls carried through an argument. */
  mixinCallHomes?: WeakMap<MixinCall, Frame>;
}

/** Force a computed `Value` to a typed object. A computed STRING carries no parse
 * tag → the evaluator sniffs (untagged fallback); a materialized object passes through. */
function force(e: EvalCtx, v: Value): ValueObj {
  if (!isLiteral(v)) {
    return v;
  }
  if (!e.ev) {
    return { type: 'Keyword', text: v, bytes: v };
  }
  return e.ev.materialize(v);
}

/**
 * Materialize a value-literal LEAF node to a typed `ValueObj`, driven by the node
 * `type` (task #44 — no side-car tag). Each typed leaf builds from its own fields
 * (`Color`/`Dimension`/`Quoted`), never re-classifying `src`; the opaque `Any` leaf
 * (alone) sniffs its bytes. When no evaluator is injected every leaf degrades to a
 * bare keyword of its `src` (the former `forceLiteral` no-`ev` behavior).
 */
function materializeNode(node: Keyword | Color | Dimension | Quoted | Any | Comment, e: EvalCtx): ValueObj {
  const src = node.type === 'Comment' ? node.text : node.src;
  if (!e.ev) {
    return { type: 'Keyword', text: src, bytes: src };
  }
  switch (node.type) {
    case 'Keyword': return { type: 'Keyword', text: node.src, bytes: node.src };
    case 'Color': return colorFromSrc(node.src);
    case 'Dimension': return dimensionFromFields(node.number, node.unit, node.src);
    case 'Quoted': return quotedFromFields(node.value, node.quote, node.escaped, node.src);
    case 'Any': return materializeAny(node.src);
    case 'Comment': return { type: 'Keyword', text: node.text, bytes: node.text };
  }
}

/**
 * TYPED fold: materialize a value node to a typed `ValueObj` for an OPERATED
 * / compared / typed-param position — sourcing the literal's TYPE from the parse
 * (the node's own `type`), NOT by re-classifying bytes. A typed leaf
 * (`Keyword`/`Color`/`Dimension`/`Quoted`) builds directly from its fields; the
 * opaque `Any` leaf sniffs. Variable refs / parens are transparent.
 */
function evalValueSlot(slot: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  if (!isValueSlotArray(slot)) {
    return evalValue(slot, frame, e);
  }
  // Less `math: 0` treats an authored top-level slash as arithmetic even when
  // the parser retained it as an adjacent ValueSlot array.  Promote only the
  // narrow, grammar-owned arithmetic shape here; ordinary space/slash values
  // (font shorthands, lists, nested groups) continue through the layout join
  // below.  The authored AST is immutable and no source bytes are inspected.
  const promoted = promoteBareSlashValue(slot, e);
  if (promoted !== null) {
    return evalValue(promoted, frame, e);
  }
  // In Less's parens-division mode, a slash at this same authored boundary
  // keeps the whole scalar expression authored.  Evaluate parenthesized
  // children through their own `parenDepth`, but do not eagerly reduce a
  // neighboring `+`/`-` operation before the preserved slash is emitted.
  const preserveBareSlash = (e.calcDepth ?? 0) === 0
    && e.modes.mathMode === 'parens-division'
    && hasTopLevelBareSlash(slot);
  const valueContext = preserveBareSlash
    ? { ...e, modes: { ...e.modes, mathMode: 'strict' as const } }
    : e;
  const values = slot.map(value => evalValueSlot(value, frame, valueContext));
  return combineAll(values, (resolved) => {
    const separators = valueLayoutOf(slot);
    if (separators === undefined) {
      return literal(resolved.map(emitValue).join(' '));
    }
    let bytes = emitValue(resolved[0]!);
    for (let index = 1; index < resolved.length; index += 1) {
      bytes += separators[index - 1] ?? ' ';
      bytes += emitValue(resolved[index]!);
    }
    return literal(bytes);
  });
}

type BareSlashToken =
  | { readonly kind: 'operand'; readonly node: ValueNode }
  | { readonly kind: 'operator'; readonly operator: '+' | '-' | '*' | '/' | '%' };

type BareSlashOperator = '+' | '-' | '*' | '/' | '%';

const BARE_SLASH_OPERATORS = new Set(['+', '-', '*', '/', '%']);
const BARE_SLASH_MULTIPLICATIVE = new Set<BareSlashOperator>(['*', '/', '%']);
const BARE_SLASH_ADDITIVE = new Set<BareSlashOperator>(['+', '-']);

function isBareSlashOperator(operator: string): operator is BareSlashOperator {
  switch (operator) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return true;
    default:
      return false;
  }
}

function isBareSlash(node: ValueNode): boolean {
  return (node.type === 'Any' || node.type === 'Keyword') && node.src === '/';
}

function hasTopLevelBareSlash(slot: readonly ValueSlot[]): boolean {
  for (const part of slot) {
    if (!isValueSlotArray(part) && isBareSlash(part)) {
      return true;
    }
  }
  return false;
}

/**
 * Flatten one existing arithmetic spine into infix tokens.  This deliberately
 * accepts only numeric/color leaves: variable references, calls, blocks, lists,
 * and authored space groups must retain their existing value semantics instead
 * of being guessed at by a broad declaration-value walk.
 */
function appendBareSlashTokens(node: ValueNode, tokens: BareSlashToken[]): boolean {
  if (node.type === 'Dimension' || node.type === 'Color') {
    tokens.push({ kind: 'operand', node });
    return true;
  }
  if (node.type !== 'Operation' || !isBareSlashOperator(node.operator)) {
    return false;
  }
  if (!appendBareSlashTokens(node.left, tokens)) {
    return false;
  }
  tokens.push({ kind: 'operator', operator: node.operator });
  return appendBareSlashTokens(node.right, tokens);
}

/** Reduce one precedence tier over an already validated infix token stream. */
function reduceBareSlashTier(
  values: ValueNode[],
  operators: Array<'+' | '-' | '*' | '/' | '%'>,
  tier: ReadonlySet<string>
): { values: ValueNode[]; operators: Array<'+' | '-' | '*' | '/' | '%'> } {
  const nextValues: ValueNode[] = [values[0]!];
  const nextOperators: Array<'+' | '-' | '*' | '/' | '%'> = [];
  for (let i = 0; i < operators.length; i++) {
    const operator = operators[i]!;
    const right = values[i + 1]!;
    if (tier.has(operator)) {
      const left = nextValues.pop()!;
      nextValues.push(operation(operator, left, right));
    } else {
      nextOperators.push(operator);
      nextValues.push(right);
    }
  }
  return { values: nextValues, operators: nextOperators };
}

/**
 * Promote a direct Less value array containing an authored slash to one
 * arithmetic operation tree in eager math mode.  Returns `null` for any shape
 * that is not an unambiguous scalar arithmetic expression, preserving the
 * existing authored join path for lists and CSS shorthand values.
 */
function promoteBareSlashValue(slot: readonly ValueSlot[], e: EvalCtx): ValueNode | null {
  if (!e.ev || e.modes.mathMode !== 'always' || slot.length < 3) {
    return null;
  }
  // Stay off the common adjacent-value path unless the grammar has already
  // exposed a top-level slash leaf.  Nested groups are deliberately ignored:
  // they have their own typed/list semantics and are not bare-slash facts.
  if (!hasTopLevelBareSlash(slot)) {
    return null;
  }
  const tokens: BareSlashToken[] = [];
  for (const part of slot) {
    if (isValueSlotArray(part)) {
      return null;
    }
    if (isBareSlash(part)) {
      tokens.push({ kind: 'operator', operator: '/' });
      continue;
    }
    if (!appendBareSlashTokens(part, tokens)) {
      return null;
    }
  }
  if (!tokens.some(token => token.kind === 'operator' && token.operator === '/')) {
    return null;
  }
  if (tokens.length < 3 || tokens.length % 2 === 0) {
    return null;
  }
  const values: ValueNode[] = [];
  const operators: Array<'+' | '-' | '*' | '/' | '%'> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (i % 2 === 0) {
      if (token.kind !== 'operand') {
        return null;
      }
      values.push(token.node);
    } else {
      if (token.kind !== 'operator') {
        return null;
      }
      operators.push(token.operator);
    }
  }
  let reduced = reduceBareSlashTier(values, operators, BARE_SLASH_MULTIPLICATIVE);
  reduced = reduceBareSlashTier(reduced.values, reduced.operators, BARE_SLASH_ADDITIVE);
  return reduced.values.length === 1 && reduced.operators.length === 0
    ? reduced.values[0]!
    : null;
}

function evalTypedSlot(slot: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<ValueObj> {
  if (!isValueSlotArray(slot)) {
    return evalTyped(slot, frame, e);
  }
  if ((e.calcDepth ?? 0) > 0) {
    const slash = slashGroupOfSlot(slot);
    if (slash !== null) {
      return evalTyped(slash, frame, e);
    }
  }
  const values = slot.map(value => evalTypedSlot(value, frame, e));
  return combineAll(values, resolved => makeList(resolved, ' '));
}

function evalTyped(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<ValueObj> {
  switch (node.type) {
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Any':
    case 'Comment':
      return materializeNode(node, e);
    case 'Quoted':
      // `~'…'` / `~"…"` are Less escaped strings: typed arithmetic must see
      // their unquoted bytes just as ordinary value emission does.
      return node.escaped ? makeKeyword(node.value) : materializeNode(node, e);
    case 'Url':
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
    case 'VariableReference': {
      const hit = resolveVarRef(frame, node.name, node.lookup, e);
      if (!hit) {
        return force(e, unresolvedRef(node, node.name, e));
      }
      const bound = hit.value;
      return withExcluded(e, bound, () =>
        isMixinCallValue(bound)
          ? force(e, literal(''))
          : evalTypedSlot(bound, hit.frame, e)
      );
    }
    case 'Reference': {
      // A typed guard comparison must retain the matched member's AST tag.
      // Falling through `evalValue` turns a typed `Keyword('true')` into an
      // untagged computed string before the value evaluator compares it.
      const resolved = resolveReferenceResult(node, frame, e);
      if (resolved === null) {
        return force(e, literal(node.raw));
      }
      return isMixinCallValue(resolved.value)
        ? force(e, literal(node.raw))
        : evalTypedSlot(resolved.value, resolved.frame, e);
    }
    case 'Block':
      // A typed function argument still needs the surrounding-parenthesis math
      // context.  `round((@r / 3))` and `unit((4px * 4em / 2cm))` consume the
      // inner value through this path; dropping `parenDepth` made their
      // operations look like top-level parens-division math and left the whole
      // registered function call verbatim after its typed signature rejected it.
      if (node.delimiter === 'square') {
        return mapMaybe(evalTypedSlot(node.inner, frame, e), value => makeBlock(value, 'square', node.escaped));
      }
      return mapMaybe(
        evalTypedSlot(node.inner, frame, { ...e, parenDepth: (e.parenDepth ?? 0) + 1 }),
        value => value.type === 'Keyword' && calcInner(value.bytes) !== null
          ? makeKeyword(`(${calcInner(value.bytes)})`)
          : value
      );
    case 'List': {
      // A comma-list materializes to the value-domain `List`, its items materialized
      // LAZILY here (only now that the list is actually consumed typed — indexed by
      // `extract`, counted by `length`, or compared). The structure the parser owns
      // is handed to the value layer directly — no re-splitting a joined string.
      const typed = node.value.map(it => evalTypedSlot(it, frame, e));
      return combineAll(typed, vals => makeList(vals, node.sep));
    }
    case 'SpacedValue': {
      // A structured SPACE-list (`@v: a b c` / `1px solid @c`) materializes to the
      // value-domain `List` with a space separator, so `extract` / `length` index
      // its structure directly (each part resolved) instead of re-splitting a joined
      // string. Typed consumption only — the emit path (`evalValue`) still joins the
      // parts to bytes, so an un-consumed space value serializes exactly as before.
      // EXCEPT a preserved-division slash group (`10px / 2`, built as a `SpacedValue`
      // `[left, '/', right]` by value-expr) is NOT a list — it is one arithmetic
      // value that must fold to bytes so an outer operation keeps it verbatim (guard
      // 3). Fall through to the joined-bytes path for it.
      if (!isSlashGroup(node)) {
        const parts = node.parts.map(p => evalTyped(p, frame, e));
        return combineAll(parts, vals => makeList(vals, ' '));
      }
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
    }
    case 'FunctionCall':
      // Typed consumers deliberately bypass any direct-output preservation
      // policy. An operation or typed function argument needs the callable's
      // result, not its authored bytes.
      return mapMaybe(evalCall(node, frame, e, true), v => force(e, v));
    case 'Range':
      // Ranges are consumed structurally by `forItems`; a value-position use
      // retains authored range syntax rather than inventing a flattened list.
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
    default:
      // Computed / joined shapes (Operation, FunctionCall, Concat, SpacedValue,
      // Interpolation, VarIndirect, Reference, …): fold to a Value then force. A
      // computed string has no parse tag → the evaluator sniffs.
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
  }
}

/**
 * A preserved-division slash group — the `SpacedValue` `[left, '/', right]` that
 * value-expr builds for `a / b` when the division is kept verbatim (parens-division
 * math mode). It is ONE arithmetic value, not a space list, so it must NOT
 * materialize to a value-domain `List` (that would break an outer operation and
 * misreport `length`/`extract`). Detected by a top-level `/` literal part.
 */
function isSlashGroup(node: SpacedValue): boolean {
  // The direct Less grammar owns separator tokens as `Keyword` leaves; older
  // hand-built AST tests may still use opaque `Any`. Both are the same typed
  // slash fact here—never rediscover it from joined source bytes.
  return node.parts.some(p => (p.type === 'Any' || p.type === 'Keyword') && p.src.trim() === '/');
}

/**
 * A Less variable may retain a glued top-level slash as the ordinary raw
 * `ValueSlot[]` shape (`50vh/2`).  That remains the public parser fact, but a
 * calc consumer still needs the same preserved-division interpretation as the
 * explicit spaced group.  Materialize only this temporary evaluator view; do
 * not change the authored AST or wrap ordinary arrays outside calc.
 */
function slashGroupOfSlot(slot: ValueSlot): SpacedValue | null {
  if (!isValueSlotArray(slot)) {
    return null;
  }
  let hasSlash = false;
  for (const part of slot) {
    if (isValueSlotArray(part)) {
      return null;
    }
    hasSlash ||= (part.type === 'Any' || part.type === 'Keyword') && part.src.trim() === '/';
  }
  if (!hasSlash) {
    return null;
  }
  const parts: ValueNode[] = [];
  for (const part of slot) {
    if (!isValueSlotArray(part)) {
      parts.push(part);
    }
  }
  const separators = valueLayoutOf(slot);
  return separators === undefined
    ? { type: 'SpacedValue', parts }
    : { type: 'SpacedValue', parts, separators };
}

/**
 * [calc] Reinterpret a preserved-division slash group (`[left, '/', right]`, and
 * left-associative chains `a / b / c`) as a left-nested division `Operation` so it
 * COMPUTES in a `calc(…)` math context. Returns `null` for a shape that is not a
 * clean `operand ('/' operand)+` chain (e.g. an interleaved space list carrying a
 * `/`), leaving it to fold verbatim. Each operand is a single part, or the run of
 * parts between two slashes wrapped back into a `SpacedValue`.
 */
function slashGroupToOperation(node: SpacedValue): Operation | null {
  const operands: ValueNode[] = [];
  let run: ValueNode[] = [];
  let sawSlash = false;
  const flush = (): boolean => {
    if (run.length === 0) {
      return false;
    }
    operands.push(run.length === 1 ? run[0]! : spaced(run));
    run = [];
    return true;
  };
  for (const p of node.parts) {
    if ((p.type === 'Any' || p.type === 'Keyword') && p.src.trim() === '/') {
      if (!flush()) {
        return null;
      } // leading / empty operand
      sawSlash = true;
    } else {
      run.push(p);
    }
  }
  if (!flush() || !sawSlash || operands.length < 2) {
    return null;
  }
  let op = operation('/', operands[0]!, operands[1]!);
  for (let i = 2; i < operands.length; i++) {
    op = operation('/', op, operands[i]!);
  }
  return op;
}

/**
 * Fold a value AST node bottom-up to a typed `Value` (a bare-string literal
 * for the static ~98% case, or a materialized `ValueObj` for a computed
 * operation/function). Lifts to `MaybePromise` only when a function call returns
 * a genuine thenable.
 */
function evalValue(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  switch (node.type) {
    // Every value LITERAL is inert here: emit its verbatim `src` as a bare string,
    // except an escaped Less quote, whose value semantics intentionally unquote it.
    // CORRECTION 5 — return `literal(node.src)` (a BARE STRING), never the node
    // object: an AST literal node must not leak into the `Value = ValueObj | string`
    // lane (a downstream `v.type==='Color'` would misread it as a value object).
    case 'Keyword':
    case 'Color':
    case 'Any':
    case 'Comment':
    // A selector CAPTURE `*[…]` reaching a plain VALUE position (never its intended
    // use — it belongs in a selector interpolation) emits its verbatim `src`.
    case 'SelectorCapture':
      return literal(node.type === 'Comment' ? node.text : node.src);
    case 'Dimension':
      // Typed materialization owns Less's numeric spelling canonicalization
      // (`.3s` → `0.3s`) without a post-render CSS rewrite.
      return e.ev ? dimensionFromFields(node.number, node.unit, node.src) : literal(node.src);
    case 'Quoted':
      return literal(node.escaped ? node.value : node.src);
    case 'Url':
      return mapMaybe(evalValue(node.value, frame, e), (value) => {
        // Quoting is syntax, not a URL-path inference problem. Preserve it
        // structurally while giving the owning plugin only the target bytes.
        if (node.value.type === 'Quoted') {
          const target = e.context?.transformUrl(node.value.value, true) ?? node.value.value;
          // Less `~"…"` / `~'…'` is an escaped string value: inside a URL it
          // deliberately strips both the escape marker and its quote wrapper.
          // Keep that distinction on the existing typed Quoted node rather
          // than reconstructing or classifying its source bytes.
          if (node.value.escaped) {
            return literal(`url(${target})`);
          }
          return literal(`url(${node.value.quote}${target}${node.value.quote})`);
        }
        if (node.value.type === 'Any') {
          const target = e.context?.transformUrl(node.value.src, false) ?? node.value.src;
          return literal(`url(${target})`);
        }
        return literal(`url(${emitValue(value)})`);
      });
    case 'VariableReference': {
      const hit = resolveVarRef(frame, node.name, node.lookup, e);
      if (!hit) {
        return unresolvedRef(node, node.name, e);
      }
      return withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
    }
    case 'PropertyReference': {
      // A `$name` property accessor resolves the winning declaration and folds
      // its value. Its declaration-level `!important` is carried through the
      // caller's existing importance sink, so `$color` of `color: red !important`
      // yields `red !important` only at a declaration emission site.
      // A miss keeps its authored bytes. `functionMode` applies only after a
      // registered function has actually been invoked and failed.
      const hit = resolvePropRef(frame, node.name, e);
      if (!hit) {
        return literal(node.raw);
      }
      if (hit.important) {
        if (e.importantSink) {
          e.importantSink.hit = true;
        } else if (e.mergeImportant !== undefined) {
          e.mergeImportant = true;
        }
      }
      if (hit.merged) {
        const values = hit.merged.map(member =>
          withExcluded(e, member.node.value, () => evalValueSlot(member.node.value, member.frame, e))
        );
        return combineAll(values, (resolved) => {
          let bytes = emitValue(resolved[0]!);
          for (let i = 1; i < resolved.length; i++) {
            const separator = hit.merged![i]!.node.merge === ',' ? ', ' : ' ';
            bytes += separator + emitValue(resolved[i]!);
          }
          return literal(bytes);
        });
      }
      return withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
    }
    case 'Sequence':
      return joinBytes(node.parts, '', frame, e);
    case 'Important':
      // [important] Less `importantScope`: the importance rides on this wrapper, NOT
      // the emitted bytes — signal the enclosing declaration (via the sink) and emit
      // the inner value with no inline `!important` (`@v: @c !important` → `#888`, the
      // declaration adds one `!important`). Absent a sink (importance-irrelevant
      // position), the inner value emits unchanged.
      if (e.importantSink) {
        e.importantSink.hit = true;
      } else if (e.mergeImportant !== undefined) {
        e.mergeImportant = true;
      }
      return evalValueSlot(node.inner, frame, e);
    case 'SpacedValue': {
      // Inside `calc(…)`, `/` is DIVISION (math), not a preserved slash separator:
      // a variable holding a preserved-division slash group (`@var: 50vh/2`) spliced
      // into calc must COMPUTE (`50vh / 2` → `25vh`) so an outer calc op keeps its
      // parens around the simplified operand (`calc(50% + (25vh - 20px))`). An inline
      // `50vh/2` written directly in calc already parses as an `Operation`; this makes
      // the variable-reference form fold identically.
      const div = (e.calcDepth ?? 0) > 0 ? slashGroupToOperation(node) : null;
      if (div) {
        return evalValue(div, frame, e);
      }
      return joinSpacedBytes(node, frame, e);
    }
    case 'List': {
      // Emit each item's bytes joined by the canonical List separator fact. Source
      // spacing is canonical by default. When the parser retained an authored
      // newline/indent (or other output-bearing trivia) at an explicit List
      // boundary, replay that side-table run without adding a public `separators`
      // field to the semantic List shape. Inline comma spacing remains canonical
      // (`a,b` -> `a, b`); only a boundary containing a line break is replayed.
      const items = node.value.map(it => evalValueSlot(it, frame, e));
      return combineAll(items, (vals) => {
        const glue = node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ';
        const authored = valueLayoutOf(node);
        let out = emitValue(vals[0]!);
        for (let index = 1; index < vals.length; index += 1) {
          const separator = authored?.[index - 1];
          out += separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : glue;
          out += emitValue(vals[index]!);
        }
        return literal(out);
      });
    }
    case 'Block':
      // Less `~(...)` retains its typed inner value for list operations but
      // escapes the delimiters at emission time.
      if (node.escaped) {
        return evalValueSlot(node.inner, frame, e);
      }
      // Transparent to computed bytes: a materialized (operated) inner strips the
      // paren (matching the legacy oracle); an un-forced literal keeps its parens.
      return mapMaybe(evalValueSlot(node.inner, frame, node.delimiter === 'paren'
        ? { ...e, parenDepth: (e.parenDepth ?? 0) + 1 }
        : e), (v) => {
        if (isLiteral(v)) {
          const open = node.delimiter === 'square' ? '[' : '(';
          const close = node.delimiter === 'square' ? ']' : ')';
          return literal(`${open}${v}${close}`);
        }
        return node.delimiter === 'square' ? makeBlock(v, 'square', node.escaped) : v;
      });
    case 'Condition':
      // [condition-grammar] The logical fns (`if`/`boolean`/…) read a condition's
      // `guard` DIRECTLY (see `evalLogical`), so a `Condition` reaching this value
      // lane is an UN-consumed condition — an ordinary/unknown call's arg that merely
      // happened to carry a top-level operator (e.g. a mis-parsed `url(…charset=utf-8…)`).
      // Emit it VERBATIM, exactly as it was spelled, rather than collapsing it to a bool.
      return literal(node.src);
    case 'Operation': {
      if (!e.ev) {
        // Fallback: un-evaluated, variable-resolved source assembly (no math).
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], values =>
          literal(`${emitValue(values[0]!)} ${node.operator} ${emitValue(values[1]!)}`)
        );
      }
      const mathMode = e.modes.mathMode ?? 'parens-division';
      const shouldOperate = (e.calcDepth ?? 0) > 0
        || mathMode === 'always'
        || (e.parenDepth ?? 0) > 0
        || (mathMode === 'parens-division' && node.operator !== '/');
      if (!shouldOperate) {
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], values =>
          literal(`${emitValue(values[0]!)} ${node.operator} ${emitValue(values[1]!)}`)
        );
      }
      const ev = e.ev;
      // Operands are materialized TYPED (tag sourced from the parse), not re-sniffed.
      const l = evalTyped(node.left, frame, e);
      const r = evalTyped(node.right, frame, e);
      // Inside `calc(…)`, flag the modes so cross-unit math preserves (guard 3).
      const m: EvalModes = (e.calcDepth ?? 0) > 0 ? { ...e.modes, inCalc: true } : e.modes;
      return combineAll([l, r], values => ev.operate(node.operator, values[0]!, values[1]!, m));
    }
    case 'FunctionCall':
      return evalCall(node, frame, e, false);
    case 'Interpolation':
      return evalInterp(node, frame, e);
    case 'GeneralEnclosed':
      return mapMaybe(evalInterp(node.content, frame, e), value =>
        literal(generalEnclosedBytes(node, emitValue(value)))
      );
    case 'VarIndirect': {
      // Resolve the name expression to bytes (unquoted), then read that variable
      // through the normal exclusion-aware stack walk (`@@name` = two chained reads).
      return mapMaybe(evalBytes(node.nameRef, frame, e), (raw) => {
        const nm = stripOuterQuotes(raw);
        const hit = resolveVarRef(frame, nm, node.lookup, e);
        if (!hit) {
          return unresolvedRef(node, nm, e);
        }
        return withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
      });
    }
    case 'Reference':
      return evalReference(node, frame, e);
    case 'Range': {
      const values = [evalValue(node.start, frame, e), evalValue(node.end, frame, e)];
      if (node.step !== null) {
        values.push(evalValue(node.step, frame, e));
      }
      return combineAll(values, resolved => literal(
        `${emitValue(resolved[0]!)}${node.includeStart ? '' : '>'} to ${node.includeEnd ? '' : '<'}${emitValue(resolved[1]!)}${node.step === null ? '' : ` step ${emitValue(resolved[2]!)}`}`
      ));
    }
    case 'DetachedRuleset':
      // A detached ruleset reaching a value/arg position is not byte-serializable:
      // it can only be *called* (`@dr()`). less.js drops such an argument to an
      // ordinary function (`fn({…})` → `fn()`), so it folds to empty bytes here
      // rather than throwing. (Full `if()`/`isruleset()`/`isdefined()` DR handling —
      // which evaluates and can RETURN a detached ruleset — is the deferred
      // condition-grammar / FnCtx capability wave, not this path.)
      return literal('');
    case 'Collection':
      // A Collection is an SCSS nested-property carrier value. It is flattened to
      // hyphenated declarations structurally in `walkBody` (case 'Declaration')
      // and never reaches a value/arg evaluation position; fold to empty bytes.
      return literal('');
  }
}

/** Resolve an interpolation template to bytes (literals + spliced refs). */
function evalInterp(node: Interpolation, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const pieces: Array<MaybePromise<string>> = [];
  for (const part of node.parts) {
    if ('lit' in part) {
      pieces.push(part.lit);
    } else {
      const bytes = evalBytesInterp(part.ref, frame, e);
      pieces.push(part.unquote ? mapMaybe(bytes, stripOuterQuotes) : bytes);
    }
  }
  return combineAll(pieces, strs => literal(resolveEmergentInterp(strs.join(''), frame, e)));
}

/** A Less identifier byte (`@{name}` name class: `-_A-Za-z0-9` + non-ASCII). */
function isInterpNameByte(c: number): boolean {
  return c === 0x2d /* - */ || c === 0x5f /* _ */
    || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c >= 0x80;
}

/**
 * Re-resolve any `@{ident}` token that EMERGED after a first-pass splice, matching
 * less.js's iterative `Quoted.eval` (`@{box-@{suffix}}` → `@{box-large}` → `100px`;
 * `@{box}-@{suffix}}` where `@box` is `@{box` → `@{box-large}` → `100px`). Each
 * clean `@{name}` whose variable resolves is replaced with its unquoted bytes; the
 * scan repeats until the string stops changing. A token whose variable is NOT in
 * scope (or resolves asynchronously) is left literal — a non-resolving emergent
 * token never turns a value into an error. Short-circuits when no `@{` remains.
 */
function resolveEmergentInterp(input: string, frame: Frame | null, e: EvalCtx): string {
  let cur = input;
  while (cur.indexOf('@{') !== -1) {
    let out = '';
    let i = 0;
    let changed = false;
    const n = cur.length;
    while (i < n) {
      if (cur.charCodeAt(i) === 0x40 /* @ */ && i + 1 < n && cur.charCodeAt(i + 1) === 0x7b /* { */) {
        let j = i + 2;
        if (j < n && cur.charCodeAt(j) === 0x2d /* - */) {
          j++;
        }
        const nameStart = j;
        while (j < n && isInterpNameByte(cur.charCodeAt(j))) {
          j++;
        }
        if (j > nameStart && j < n && cur.charCodeAt(j) === 0x7d /* } */) {
          const name = cur.slice(i + 2, j).trim();
          const hit = resolveVarRef(frame, name, 'scoped', e);
          if (hit) {
            const val = withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
            if (!isThenable(val)) {
              out += stripOuterQuotes(emitValueInterp(val));
              i = j + 1;
              changed = true;
              continue;
            }
          }
        }
      }
      out += cur[i]!;
      i++;
    }
    if (!changed) {
      break;
    }
    cur = out;
  }
  return cur;
}

/** Strip ONE matching layer of surrounding `'…'` / `"…"` quotes, including
 * Less's escaped `~"…"` / `~'…'` spelling. */
function stripOuterQuotes(s: string): string {
  const offset = s[0] === '~' ? 1 : 0;
  if (s.length >= offset + 2) {
    const a = s[offset];
    if ((a === '"' || a === '\'') && s[s.length - 1] === a) {
      return s.slice(offset + 1, -1);
    }
  }
  return s;
}

/* --------------------------------------------------- map / namespace */

/** One resolved declaration in a map/namespace body (name → value in a frame). */
interface DeclEntry {
  name: string;
  value: Binding;
  frame: Frame | null;
  important: boolean;
}

/**
 * A resolved map/namespace body: its members split into Less's two DISJOINT
 * lookup namespaces — `byProp` (CSS declarations, read by a bare / `$name` key)
 * and `byVar` (`@var:` declarations, read by an `@name` key) — plus the ordered
 * member list for numeric-index access. The two maps never fall back to each other
 * (Less 4.x: `#ns[a]` errors when only `@a` exists).
 */
interface DeclMap {
  byVar: Map<string, DeclEntry>;
  byProp: Map<string, DeclEntry>;
  list: DeclEntry[];
  /**
   * [namespace-accessor] For a mixin-DISPATCH base (`#ns.m[@x]`), the callee's
   * evaluated scope frame(s) — a `@var` member is read lazily via `lookupVar` here,
   * because a mixin's local variables (and nested-call leaked vars) are NOT part of
   * its emitted-declaration output (`byVar` stays empty for this base kind). Frames
   * are in candidate/source order; last match wins (Less per-name last-declaration).
   */
  varFrames?: Frame[];
}

/** Pick the member map an accessor key targets (`var` vs `prop`), per its kind. */
function mapForKind(map: DeclMap, kind: 'var' | 'prop'): Map<string, DeclEntry> {
  return kind === 'var' ? map.byVar : map.byProp;
}

/** [namespace-accessor] Read a `@name` member from a mixin-dispatch base's callee
 *  scope frame(s) — the mixin's local / nested-leaked variables, which are not part
 *  of its emitted-declaration output. Last matching frame wins (source order). */
function lookupVarMember(map: DeclMap, name: string, e: EvalCtx): DeclEntry | undefined {
  const frames = map.varFrames;
  if (!frames) {
    return undefined;
  }
  let hit: DeclEntry | undefined;
  for (const f of frames) {
    const resolved = resolveVarRef(f, name, 'scoped', e);
    const bound = resolved?.value;
    // Retain callable bindings as typed members so a later Reference Call step
    // can dispatch them; serialization still decides whether the final result
    // is renderable.
    if (bound) {
      hit = { name, value: bound, frame: resolved.frame, important: false };
    }
  }
  return hit;
}

/** The final local variable member emitted by a mixin-call result.  Less `[]`
 * selects that final result member when the call has no CSS declaration output
 * (the conventional `@return` shape).  The callee frames already carry ordered
 * declaration facts, so this reads them directly without source recovery. */
function lastVarMember(map: DeclMap, e: EvalCtx): DeclEntry | undefined {
  const frames = map.varFrames;
  if (!frames) {
    return undefined;
  }
  let hit: DeclEntry | undefined;
  for (const frame of frames) {
    for (const name of frame.declIndex?.byName.keys() ?? []) {
      const resolved = resolveVarRef(frame, name, 'scoped', e);
      if (resolved) {
        hit = { name, value: resolved.value, frame: resolved.frame, important: false };
      }
    }
  }
  return hit;
}

/** Collect a body's declarations into name→value maps (+ ordered list). */
function evalToDeclMap(statements: Statement[], frame: Frame | null, e: EvalCtx): DeclMap {
  const byVar = new Map<string, DeclEntry>();
  const byProp = new Map<string, DeclEntry>();
  const list: DeclEntry[] = [];
  for (const s of statements) {
    // A map/namespace body member is either a CSS declaration (`text: white`,
    // read by property name / `$prop`, keyed in `byProp`) or a variable declaration
    // (`@color: blue`, read by `@var`, keyed in `byVar`). Each namespace is
    // source-order last-wins, mirroring Less's per-name last-declaration-wins.
    if (s.type === 'Declaration') {
      const name = typeof s.name === 'string' ? s.name : evalBytesSync(s.name, frame, e);
      const entry: DeclEntry = { name, value: s.value, frame, important: s.important };
      byProp.set(name, entry); // last-wins
      list.push(entry);
    } else if (s.type === 'VariableDeclaration') {
      const entry: DeclEntry = { name: s.name, value: s.value, frame, important: false };
      byVar.set(s.name, entry); // last-wins
      list.push(entry);
    }
  }
  return { byVar, byProp, list };
}

/** Resolve a map/namespace accessor's base to a declaration map + its frame. */
function resolveBaseDeclMap(
  base: Binding,
  frame: Frame | null,
  e: EvalCtx
): DeclMap | null {
  if (isValueSlotArray(base)) {
    return null;
  }
  if (base.type === 'Reference') {
    const resolved = resolveReferenceResult(base, frame, e);
    return resolved === null ? null : resolveBaseDeclMap(resolved.value, resolved.frame, e);
  }
  // A namespace / mixin-path base (`#ns.options`, `.alias`, `#library.add-one(1px)`)
  // is a `MixinCall`: dispatch it and treat its EMITTED members as the map. A plain
  // ruleset (`#ns1 {}`) dispatches as a zero-arg rule-mixin, so this one path serves
  // both namespace descents and single-segment ruleset/mixin bases.
  if (base.type === 'MixinCall') {
    return frame ? declMapFromMixinCall(base, frame, e) : null;
  }
  // A `#namespace` / `.map` selector base → the union of matching rulesets' decls.
  // The base is an opaque selector fragment (`Any`) or a bare ident (`Keyword`).
  if (base.type === 'Any' || base.type === 'Keyword') {
    const sel = base.src;
    for (let f = frame; f; f = f.parent) {
      const rules = f.rulesets !== undefined || f.statements ? frameRulesets(f)?.get(sel) : undefined;
      if (rules?.length) {
        const bodyFrame: Frame = {
          parent: f,
          mixins: null,
          declIndex: collectDeclIndex(rules.flatMap(r => r.body)), cells: null, reassign: null
        };
        return evalToDeclMap(rules.flatMap(r => r.body), bodyFrame, e);
      }
    }
    return null;
  }
  // Any other base resolves to a ruleset body through the shared resolver: a
  // direct `DetachedRuleset`, a `@var` bound to one (or, transitively, to another
  // `@map[k]` accessor — the chained-accessor case `@scheme: @m[@k]; @scheme[@c]`),
  // or a `@map[k]` accessor whose matched member is a detached ruleset. Its body
  // decls (both `prop:` and `@var:` members, via `evalToDeclMap`) are the map.
  const rs = resolveForRuleset(base, frame, e);
  if (rs) {
    const bodyFrame: Frame = {
      parent: rs.frame,
      mixins: collectMixins(rs.body),
      declIndex: collectDeclIndex(rs.body), cells: null, reassign: null
    };
    return evalToDeclMap(rs.body, bodyFrame, e);
  }
  // A base `@var` bound to a mixin CALL (`@p: .mk-map(); @p[text]`): dispatch the
  // call and treat its EMITTED declarations as the map (the same reconstruction the
  // `each(.mixin(), …)` iterable uses — `forItemsFromMixinCall`).
  if (base.type === 'VariableReference' && frame) {
    const bound = lookupVar(frame, base.name);
    if (bound && isMixinCallValue(bound)) {
      return declMapFromMixinCall(bound, frame, e);
    }
  }
  return null;
}

/** Dispatch a mixin CALL and collect its emitted declarations as a member map
 *  (`prop:` and `@var:` members split into `byProp` / `byVar`), for a namespace /
 *  mixin-path accessor base (`#ns.options[k]`) or a `@p: .mk-map()`-bound base.
 *  Mirrors {@link forItemsFromMixinCall}; nested rules are captured and discarded
 *  (a map is its declarations). Needs a scratch {@link Emit} — capture is thrown away. */
function declMapFromMixinCall(
  call: MixinCall,
  frame: Frame,
  e: EvalCtx
): DeclMap {
  const em = scratchEmit(e);
  const collected: Leaf[] = [];
  const noop = (): void => {};
  // Collect EVERY declaration (`forceLeading` → all decls to `collected`), discard
  // nested rules (they defer to `trailing`, which is never drained here).
  const discard: Partition = {
    encounteredContainer: false,
    afterBubbledAtRule: false,
    trailing: [],
    pending: [],
    emitBlock: noop
  };
  const varFrames: Frame[] = [];
  expandCall(call, null, null, frame, collected, noop, discard, em, false, true, varFrames);
  const byVar = new Map<string, DeclEntry>();
  const byProp = new Map<string, DeclEntry>();
  const list: DeclEntry[] = [];
  for (const leaf of collected) {
    const n = leaf.node;
    let name: string;
    let into: Map<string, DeclEntry>;
    if (n.type === 'Declaration') {
      name = typeof n.name === 'string' ? n.name : evalBytesSync(n.name, leaf.frame, em);
      into = byProp;
    } else if (n.type === 'VariableDeclaration') {
      name = n.name;
      into = byVar;
    } else {
      continue;
    }
    const value = n.value;
    const entry: DeclEntry = {
      name,
      value,
      frame: leaf.frame,
      important: leaf.important === true || (n.type === 'Declaration' && n.important)
    };
    into.set(name, entry);
    list.push(entry);
  }
  return { byVar, byProp, list, varFrames };
}

function resolveReferenceResult(
  node: Reference,
  frame: Frame | null,
  e: EvalCtx
): { value: ValueSlot | MixinCall; frame: Frame | null; sourceOwner: object | null } | null {
  let value: ValueSlot | MixinCall = node.base;
  let valueFrame = frame;
  let sourceOwner = frame?.sourceOwner ?? null;
  if (value.type === 'VariableReference') {
    const resolved = resolveVarRef(valueFrame, value.name, value.lookup, e);
    if (!resolved) {
      return null;
    }
    value = resolved.value;
    valueFrame = resolved.frame;
    sourceOwner = detachedBinding(valueFrame, value)?.sourceOwner
      ?? sourceOwnerForBody(!isValueSlotArray(value) && value.type === 'DetachedRuleset' ? value.body : value, valueFrame, e);
  }
  for (const step of node.steps) {
    if (step.type === 'Call') {
      if (isMixinCallValue(value)) {
        value = step.args.length === 0 ? value : { ...value, args: step.args };
      }
      continue;
    }
    if (step.type === 'BracketLookup' && step.keyKind === 'index' && typeof step.key === 'number'
      && (isValueSlotArray(value) || (!isValueSlotArray(value) && (value.type === 'List' || value.type === 'SpacedValue')))) {
      const items = isValueSlotArray(value)
        ? value
        : value.type === 'List' ? value.value : value.parts;
      const index = step.key < 0
        ? items.length + step.key
        : step.indexBase === 0 ? step.key : step.key - 1;
      const item = items[index];
      if (item === undefined) {
        return null;
      }
      value = item;
      continue;
    }
    if (isValueSlotArray(value)) {
      return null;
    }
    const map = resolveBaseDeclMap(value, valueFrame, e);
    if (!map) {
      return null;
    }
    let matched: DeclEntry | undefined;
    if (step.type === 'DotLookup') {
      const prop = map.byProp.get(step.name);
      const variable = map.byVar.get(step.name) ?? lookupVarMember(map, step.name, e);
      if (prop && variable) {
        throw new Error(`Ambiguous reference member: ${step.name}`);
      }
      matched = prop ?? variable;
    } else if (step.keyKind !== 'index' && typeof step.key !== 'number') {
      // `[@name]` names a variable member of the evaluated map/call result.
      // In particular, a mixin-call base must resolve `[@return]` from every
      // selected callee frame, rather than evaluating `@return` in the caller.
      // Other bracket keys remain dynamic value expressions in the current frame.
      if (step.keyKind === 'var' && step.key.type === 'VariableReference' && (
        value.type === 'MixinCall' || !resolveVarRef(valueFrame, step.key.name, step.key.lookup, e)
      )) {
        // A namespace/mixin-call accessor is a callee result: `#ns.m[@key]`
        // names that result's `@key` member even if the caller has an `@key`.
        // A detached map with no caller binding has the same member spelling;
        // only a bound caller key is a dynamic detached-map lookup.
        matched = map.byVar.get(step.key.name) ?? lookupVarMember(map, step.key.name, e);
      } else if (step.keyKind === 'var' && step.key.type === 'VarIndirect') {
        // `[@@name]` is a map-variable indirection: evaluate only its first
        // lookup to obtain the member NAME, then read that named member from
        // this map/call result. Evaluating the VarIndirect value wholesale
        // would perform the second lookup in the caller and lose the map base.
        // `@@name` first resolves `@name` in the lexical accessor scope; only
        // its resulting bytes name a member of this map. The map owner can be a
        // root/detached closure while `@name` is an each/mixin-local binding.
        const name = stripOuterQuotes(evalBytesSync(step.key.nameRef, frame ?? valueFrame, e));
        matched = map.byVar.get(name) ?? lookupVarMember(map, name, e);
      } else if (step.keyKind === 'prop' && step.key.type === 'PropertyReference') {
        // In a map bracket, `$name` selects the property member named `name`.
        // It is not a `$name` read from the caller's declaration timeline.
        matched = map.byProp.get(step.key.name);
      } else {
        const key = evalBytesSync(step.key as ValueNode, valueFrame, e);
        if (step.keyKind === 'member') {
          const prop = map.byProp.get(key);
          const variable = map.byVar.get(key) ?? lookupVarMember(map, key, e);
          if (prop && variable) {
            throw new Error(`Ambiguous reference member: ${key}`);
          }
          matched = prop ?? variable;
        } else {
          matched = mapForKind(map, step.keyKind).get(key);
          if (!matched && step.keyKind === 'var') {
            matched = lookupVarMember(map, key, e);
          }
        }
        if (!matched && isIntegerString(key)) {
          const i = parseInt(key, 10);
          matched = map.list[i < 0 ? map.list.length + i : i - 1];
        }
      }
    } else {
      if (typeof step.key !== 'number') {
        return null;
      }
      const idx = step.key;
      const i = idx < 0 ? map.list.length + idx : idx - 1;
      matched = map.list[i] ?? (idx === -1 && map.list.length === 0 ? lastVarMember(map, e) : undefined);
    }
    if (!matched) {
      return null;
    }
    if (matched.important) {
      if (e.importantSink) {
        e.importantSink.hit = true;
      } else if (e.mergeImportant !== undefined) {
        e.mergeImportant = true;
      }
    }
    value = matched.value;
    valueFrame = matched.frame;
  }
  return { value, frame: valueFrame, sourceOwner };
}

function evalReference(node: Reference, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const resolved = resolveReferenceResult(node, frame, e);
  if (resolved === null) {
    return literal(node.raw);
  }
  return isMixinCallValue(resolved.value)
    ? literal(node.raw)
    : evalValueSlot(resolved.value, resolved.frame, e);
}

/**
 * Follow a `@var` → … → `@var` binding chain to the concrete value node it names
 * (non-throwing; stops at the first non-`VariableReference`). Returns `undefined` if any link
 * is unbound. Used by the detached-ruleset introspection functions, which must
 * inspect the BINDING (a `DetachedRuleset` node) rather than materialize it.
 */
function resolveBindingNode(node: Binding, frame: Frame | null): Binding | undefined {
  let cur: Binding | undefined = node;
  const seen = new Set<Binding>();
  while (cur !== undefined && !isValueSlotArray(cur) && cur.type === 'VariableReference') {
    if (seen.has(cur)) {
      return undefined;
    } // cyclic
    seen.add(cur);
    cur = lookupVar(frame, cur.name);
  }
  return cur;
}

/**
 * `isdefined(@x)` / `isruleset(@x)`: detached-ruleset introspection that inspects
 * the BINDING without byte-materializing it (a `DetachedRuleset` arg is not
 * value-serializable, and `isdefined` must swallow an unbound reference rather
 * than throw `@x is undefined`). Returns the `true`/`false` literal, or `undefined`
 * when `node` is not one of these calls (fall through to normal dispatch).
 */
function evalIntrospection(node: FunctionCall, frame: Frame | null): Value | undefined {
  if (node.args.length !== 1) {
    return undefined;
  }
  const arg = node.args[0]!;
  if (node.name === 'isdefined') {
    // Defined iff the single argument resolves to a bound value. A non-`VariableReference`
    // argument (a literal / call) is inherently defined.
    const bound = !isValueSlotArray(arg) && arg.type === 'VariableReference'
      ? resolveBindingNode(arg, frame)
      : arg;
    return literal(bound !== undefined ? 'true' : 'false');
  }
  if (node.name === 'isruleset') {
    const bound = resolveBindingNode(arg, frame);
    return literal(bound !== undefined && !isValueSlotArray(bound) && bound.type === 'DetachedRuleset'
      ? 'true'
      : 'false');
  }
  return undefined;
}

/** True when every char of `s` is an ASCII digit (optionally a leading `-`). */
function isIntegerString(s: string): boolean {
  let i = s.charCodeAt(0) === 0x2d /* - */ ? 1 : 0;
  if (i >= s.length) {
    return false;
  }
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) {
      return false;
    }
  }
  return true;
}

/**
 * `calc(…)` fold: evaluate the single argument in calc mode, then decide the
 * wrapper. A cross-unit sub-expression arrives already `calc(…)`-wrapped (kept
 * as-is); a preserved non-calc keyword op (`100% - 3`) is wrapped; a fully
 * computed value (`10px * 2` → `20px`) drops the wrapper (less.js `calc()`
 * collapse to a bare Dimension).
 */
function evalCalc(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const ce: EvalCtx = { ...e, calcDepth: (e.calcDepth ?? 0) + 1 };
  return mapMaybe(evalTypedSlot(node.args[0]!, frame, ce), (v) => {
    if (v.type === 'Keyword') {
      return calcInner(v.bytes) !== null ? v : makeKeyword(`calc(${v.bytes})`);
    }
    return v;
  });
}

/** CSS color constructors whose authored call is inert until a value consumer demands it. */
const DEFERRED_COLOR_CALLS = new Set(['rgb', 'rgba', 'hsl', 'hsla']);

/**
 * Recognize the CSS-shaped arities that are safe to leave as authored bytes.
 *
 * Less overloads the rgb-family names: one- and two-slot calls are color/
 * alpha conveniences (`rgba(#fff)`, `rgba(#fff, .5)`), while malformed
 * one-/two-slot numeric calls must still reach the selected Less callable so
 * its normal functionMode policy can reject or preserve them. Modern CSS
 * syntax arrives as one nested slot, so inspect that typed structure as well;
 * a three-or-more item nested slot is the equivalent CSS channel shape.
 */
function hasCssColorCallShape(node: FunctionCall): boolean {
  if (node.args.length >= 3) {
    return true;
  }
  if (node.args.length !== 1) {
    return false;
  }
  const slot = node.args[0]!;
  return isValueSlotArray(slot) && slot.length >= 3;
}

/** Re-emit a call after resolving variable/interpolation bytes, without invoking its callable. */
function preserveCall(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  if (node.args.length === 0) {
    return literal(`${node.name}()`);
  }
  // A deferred call must retain literal spellings (`.5`, comma padding, hue
  // units) exactly. Disable typed literal canonicalization for this byte lane;
  // variable references still resolve through the same live frame walk.
  const preserve = e.ev === null ? e : { ...e, ev: null };
  const items = node.args.map(a => evalValueSlot(a, frame, preserve));
  return combineAll(items, (vals) => {
    const authored = valueLayoutOf(node.args);
    const glue = node.modern ? ' ' : ', ';
    let inner = emitValue(vals[0]!);
    for (let index = 1; index < vals.length; index += 1) {
      const separator = authored?.[index - 1];
      // A deferred value-function is explicitly byte-faithful: replay every
      // parser-retained boundary, including ordinary spaces (`,` vs `, `).
      inner += separator ?? glue;
      inner += emitValue(vals[index]!);
    }
    return literal(`${node.name}(${inner})`);
  });
}

/** Evaluate a function call: materialize the modeled arg list, then `ev.call`. */
/** Guard-eval deps sourced from an evaluation context (a value-position condition,
 *  like a CSS ruleset guard, never depends on a mixin `default()` decision). */
function guardDeps(frame: Frame | null, e: EvalCtx): {
  resolveTyped: TypedResolver; ev: ValueEvaluator | null; modes: EvalModes; isDefault: () => boolean;
} {
  return { resolveTyped: makeTypedResolver(frame, e), ev: e.ev, modes: e.modes, isDefault: () => false };
}

/** The `GuardNode` an argument of a logical fn contributes: a structured
 *  `Condition` carries its own guard tree; any other value is a bare TRUTH test
 *  (`if((iscolor(@x)), …)`, `if(true, …)`) — the same rule a bare guard value uses. */
function condGuard(node: ValueSlot): GuardNode {
  return !isValueSlotArray(node) && node.type === 'Condition'
    ? node.guard
    : { g: 'truth', value: node };
}

/** The Less logical / conditional fns whose argument is a boolean CONDITION (a
 *  guard tree), not an ordinary value — dispatched here (not via `ev.call`) so the
 *  condition evaluates through the guard evaluator and `if` stays branch-lazy. */
const LOGICAL_FNS = new Set(['if', 'boolean', 'not', 'and', 'or']);

/** Evaluate a logical / conditional fn (`if`/`boolean`/`not`/`and`/`or`). `if` is
 *  LAZY — only the taken branch folds; an absent else is empty bytes. */
function evalLogical(name: string, node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const deps = guardDeps(frame, e);
  const truthOf = (a: ValueSlot | undefined): boolean => a !== undefined && evalGuard(condGuard(a), deps);
  switch (name) {
    case 'if': {
      const branch = truthOf(node.args[0]) ? node.args[1] : node.args[2];
      return branch === undefined ? literal('') : evalValueSlot(branch, frame, e);
    }
    case 'not': return makeBool(!truthOf(node.args[0]));
    case 'and': return makeBool(node.args.every(a => evalGuard(condGuard(a), deps)));
    case 'or': return makeBool(node.args.some(a => evalGuard(condGuard(a), deps)));
    default: return makeBool(truthOf(node.args[0])); // boolean
  }
}

function evalCall(
  node: FunctionCall,
  frame: Frame | null,
  e: EvalCtx,
  demanded = false
): MaybePromise<Value> {
  // [default-fn] `default()` inside a guard operand (`when (@x = default())`) folds to
  // the dispatch decision. Only when a `defaultFn` is in scope (a guard-operand typed
  // resolver); elsewhere `default()` is meaningless and falls through to emit verbatim.
  if (e.defaultFn && node.args.length === 0 && node.name.toLowerCase() === 'default') {
    // This is a Less keyword value in a comparison, not the evaluator's internal
    // Bool result shape. Keeping it a Keyword lets `@x: false` compare structurally
    // with `default()` when a non-default candidate already matched.
    return makeKeyword(e.defaultFn() ? 'true' : 'false');
  }
  const intro = evalIntrospection(node, frame);
  if (intro !== undefined) {
    return intro;
  }
  if (e.ev && node.args.length === 1 && node.name.toLowerCase() === 'calc') {
    return evalCalc(node, frame, e);
  }
  const sep = node.modern ? ' ' : ',';
  if (!e.ev) {
    if (node.args.length === 0) {
      return literal(`${node.name}()`);
    }
    const items = node.args.map(a => evalValueSlot(a, frame, e));
    return combineAll(items, (vals) => {
      const authored = valueLayoutOf(node.args);
      const glue = sep === ' ' ? ' ' : ', ';
      let inner = emitValue(vals[0]!);
      for (let index = 1; index < vals.length; index += 1) {
        const separator = authored?.[index - 1];
        inner += separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : glue;
        inner += emitValue(vals[index]!);
      }
      return literal(`${node.name}(${inner})`);
    });
  }
  const lname = node.name.toLowerCase();
  if (LOGICAL_FNS.has(lname)) {
    return evalLogical(lname, node, frame, e);
  }
  // CSS-shaped color constructors are optional CSS value calls in a bare value
  // slot. Preserve their authored bytes until a typed consumer (operation/
  // function argument) explicitly demands a value; this prevents an installed
  // native Less function from eagerly round-tripping and mangling the call
  // spelling. One-/two-slot calls are deliberately *not* deferred: Less owns
  // those overloads, and malformed forms must reach the call-level
  // functionMode policy instead of leaking authored invalid output.
  const lessDocument = e.context?.sourceContext?.plugin?.supportedExtensions?.includes('.less') === true;
  if (!demanded && lessDocument && DEFERRED_COLOR_CALLS.has(lname) && hasCssColorCallShape(node)) {
    return preserveCall(node, frame, e);
  }
  const ev = e.ev;
  // [plugin/P1] Build a scope-frame fn view ONLY when the document registered a
  // scoped fn somewhere; otherwise pass null so `ev.call` takes its pre-P1 global
  // path unchanged. `anyScopedFns` is false for every real document today.
  const scope = e.anyScopedFns ? makeFnScope(frame) : null;
  // Args are materialized TYPED (each arg's tag sourced from its parse node).
  const typed = node.args.map(a => evalTypedSlot(a, frame, e));
  return combineAll(typed, (vals) => {
    const list: ValueList = { type: 'List', value: vals, sep, bytes: '' };
    try {
      const result = ev.call(node.name, list, e.modes, scope, e.io, (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        const file = e.context?.sourceContext?.file;
        const source = file?.source;
        const span = source === undefined ? undefined : sourceSpanOf(node);
        const location = source === undefined || span === undefined
          ? undefined
          : lineColAt(source, span.start);
        e.context?.warn(WARN.unresolvedFunction({
          node,
          filePath: file?.fullPath,
          source,
          line: location?.line,
          column: location?.column,
          meta: { name: node.name, reason }
        }));
      });
      return isThenable(result)
        ? result.catch(error => invalidFunctionCall(node, error, e))
        : result;
    } catch (error) {
      return invalidFunctionCall(node, error, e);
    }
  });
}

function invalidFunctionCall(node: FunctionCall, error: unknown, e: EvalCtx): never {
  if (error instanceof JessError) {
    throw error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  const file = e.context?.sourceContext?.file;
  const source = file?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  const location = source === undefined || span === undefined
    ? undefined
    : lineColAt(source, span.start);
  throw ERR.invalidFunction({
    node,
    filePath: file?.fullPath,
    source,
    line: location?.line,
    column: location?.column,
    meta: { name: node.name, reason }
  });
}

/** Join value parts to bytes (Concat = '', SpacedValue = ' '); stays a literal. */
function joinBytes(
  parts: ValueNode[],
  sep: string,
  frame: Frame | null,
  e: EvalCtx
): MaybePromise<Value> {
  const items = parts.map(p => evalValue(p, frame, e));
  return combineAll(items, vals => literal(vals.map(emitValue).join(sep)));
}

/** Emit a parser-owned spaced value without rediscovering its authored layout. */
function joinSpacedBytes(node: SpacedValue, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const items = node.parts.map(part => evalValue(part, frame, e));
  return combineAll(items, (values) => {
    let out = emitValue(values[0]!);
    for (let index = 1; index < values.length; index++) {
      out += node.separators?.[index - 1] ?? ' ';
      out += emitValue(values[index]!);
    }
    return literal(out);
  });
}

/** Fold a value node and return its emitted bytes. */
function evalBytes(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  return mapMaybe(evalValueSlot(node, frame, e), (value) => {
    if (!isLiteral(value)) {
      validateFinalUnits(value, e.modes);
    }
    return emitValue(value);
  });
}

/**
 * Fold a value node to bytes for an INTERPOLATION splice — same as {@link evalBytes}
 * but emits a COMPUTED dimension at full precision ({@link emitValueInterp}), matching
 * less.js eval-time interpolation (`@{x}` where `@x: pi()` → `3.141592653589793`).
 */
function evalBytesInterp(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  return mapMaybe(evalValue(node, frame, e), emitValueInterp);
}

function generalEnclosedBytes(node: GeneralEnclosed, content: string): string {
  return node.form === 'function'
    ? `${node.name ?? ''}(${content})`
    : `(${content})`;
}

/** Bytes for a synchronous position (at-rule prelude); async there is out of scope. */
function evalBytesSync(node: ValueSlot, frame: Frame | null, e: EvalCtx): string {
  const b = evalBytes(node, frame, e);
  if (isThenable(b)) {
    throw new Error('async value in an at-rule prelude is unsupported');
  }
  return b;
}

/* ---------------------------------------------------- selector composition */

/**
 * [nesting] Cartesian-expand every `&` in `canon` independently over the FULL
 * `parents` array — plain parent×child nesting expands, it does NOT compact to
 * `:is(a, b, …)`. Each `&` is its own odometer digit with the LEFTMOST `&`
 * most-significant, so `& > &` over parents `[p0,p1]` emits
 * `p0>p0, p0>p1, p1>p0, p1>p1` (see the 16-row `& > &` golden in selectors.less).
 */
function joinAmpersand(canon: string, parents: string[]): string[] {
  const segs = canon.split('&');
  const holes = segs.length - 1; // number of `&` occurrences (>= 1 here)
  const n = parents.length;
  if (n === 1) {
    return [segs.join(parents[0]!)];
  }
  const total = n ** holes;
  const out: string[] = new Array(total);
  for (let i = 0; i < total; i++) {
    let s = segs[0]!;
    for (let h = 0; h < holes; h++) {
      const digit = Math.floor(i / n ** (holes - 1 - h)) % n;
      s += parents[digit]! + segs[h + 1]!;
    }
    out[i] = s;
  }
  return out;
}

/**
 * [selector-capture] A GROUP interpolation: a lone bare `@{name}` in a selector
 * whose variable resolves to a `*[…]` selector-list CAPTURE, or to an escaped
 * `~'…'` selector string carrying a top-level comma. Both interpolate a multi-
 * branch selector group, routed through the SAME expansion — a comma-separated
 * branch list at whole-selector position, a `:is(…)` compaction in compound
 * position. `capture` marks a `*[…]` (its branches are parser-owned and expand at
 * whole-selector position); a quoted string's commas are opaque bytes that stay a
 * single verbatim branch there. Returns null for any non-group interpolation
 * (`.a-@{n}`, `@{n}` bound to a plain value) — the byte-splice path is unchanged.
 */
interface GroupInterp { branches: string[]; multi: boolean; capture: boolean }

/** [selector-capture] The group a single interpolation REF resolves to: a `*[…]`
 *  selector CAPTURE, or an escaped `~'…'` selector string with a top-level comma.
 *  Any other ref (a plain value, a comma-less string) is null. */
function refGroupInterp(ref: ValueNode, frame: Frame | null, e: EvalCtx): GroupInterp | null {
  if (ref.type !== 'VariableReference') {
    return null;
  }
  const hit = resolveVarRef(frame, ref.name, ref.lookup, e);
  if (hit === undefined) {
    return null;
  }
  const bound = hit.value;
  if (isValueSlotArray(bound)) {
    return null;
  }
  if (bound.type === 'SelectorCapture') {
    const branches = bound.branches.slice();
    return { branches, multi: branches.length > 1, capture: true };
  }
  if (bound.type === 'Quoted' && bound.escaped && hasTopLevelComma(bound.value)) {
    return { branches: [bound.value], multi: true, capture: false };
  }
  return null;
}

/** [selector-capture] The group a lone bare `@{name}` simple resolves to (a
 *  single-part interp whose sole part is a group ref) — else null. */
function simpleGroupInterp(sim: SimpleSelector, frame: Frame | null, e: EvalCtx): GroupInterp | null {
  const interp = sim.interp;
  if (interp?.parts.length !== 1) {
    return null;
  }
  const part = interp.parts[0]!;
  return 'ref' in part ? refGroupInterp(part.ref, frame, e) : null;
}

/** [selector-capture] `simpleGroupInterp` for the sole simple of a LONE complex —
 *  a `@{name}` that is the ENTIRE selector (no leading combinator, no tail, a
 *  single-simple head). This is the whole-selector position, where a capture
 *  expands to header branches rather than compacting to `:is(…)`. */
function loneGroupInterp(c: ComplexSelector, frame: Frame | null, e: EvalCtx): GroupInterp | null {
  if (c.leadingComb !== undefined && c.leadingComb !== ' ') {
    return null;
  }
  if (c.tail.length > 0) {
    return null;
  }
  if (c.head.simples.length !== 1) {
    return null;
  }
  return simpleGroupInterp(c.head.simples[0]!, frame, e);
}

/** Bytes for one non-group interpolation ref part (matches `evalInterp`: fold the
 * ref, honour its `unquote`). The selector reducer preserves this MaybePromise so
 * a public async plugin can resolve one slot before the next slot is evaluated in
 * the SAME lexical frame. */
function resolveRefBytes(part: { ref: ValueNode; unquote: boolean }, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  const bytes = evalBytesInterp(part.ref, frame, e);
  return mapMaybe(bytes, value => part.unquote ? stripOuterQuotes(value) : value);
}

/** [selector-capture] The header/parent branch strings one complex contributes.
 *  A lone whole-selector `*[…]` capture EXPANDS to one branch per captured
 *  selector; a lone quoted group stays a single verbatim branch. Every other
 *  complex resolves to exactly one string (a compound-embedded group compacts to
 *  `:is(…)` inside `resolveComplex`). */
function expandComplex(c: ComplexSelector, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const g = loneGroupInterp(c, frame, e);
  if (g !== null) {
    return g.capture ? g.branches : [g.branches.join(', ')];
  }
  return mapMaybe(resolveComplex(c, frame, e), value => [value]);
}

/** Resolve one interpolated simple token's text in `frame`. Each interpolation ref
 *  part folds to its bytes, EXCEPT a group ref (a `*[…]` capture or `~'…'` comma
 *  string) embedded in a compoundSelector (`.d@{cap}&:hover`, `@{c}@{d}`) compacts to a
 *  single `:is(…)` group; a single-branch capture splices its lone branch bare. */
function resolveSimpleText(sim: SimpleSelector, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  const interp = sim.interp;
  if (interp === null) {
    return sim.text ?? '';
  }
  // Capture the entering frame once. A pending earlier slot must never cause a
  // later slot to observe a different loop/mixin placement.
  const entryFrame = frame;
  const step = (index: number, out: string): MaybePromise<string> => {
    for (let i = index; i < interp.parts.length; i++) {
      const part = interp.parts[i]!;
      if ('lit' in part) {
        out += part.lit;
        continue;
      }
      const g = refGroupInterp(part.ref, entryFrame, e);
      if (g !== null) {
        const joined = g.branches.join(', ');
        out += g.multi ? `:is(${joined})` : joined;
        continue;
      }
      const bytes = resolveRefBytes(part, entryFrame, e);
      if (isThenable(bytes)) {
        return bytes.then(value => step(i + 1, out + value));
      }
      out += bytes;
    }
    return resolveEmergentInterp(out, entryFrame, e);
  };
  return step(0, '');
}

/** Synchronous selector-interpolation consumers cannot suspend and resume a
 * partially mutated selector. Public emitted selectors retain the async path. */
function resolveSimpleTextSync(sim: SimpleSelector, frame: Frame | null, e: EvalCtx): string {
  const value = resolveSimpleText(sim, frame, e);
  if (isThenable(value)) {
    throw new Error('async value in synchronous selector interpolation is unsupported');
  }
  return value;
}

function resolveCompound(c: CompoundSelector, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (!compoundHasInterp(c)) {
    return compoundCanonical(c);
  }
  const parts = c.simples.map(sim => resolveSimpleText(sim, frame, e));
  return combineAll(parts, values => values.join(''));
}

/** The concrete canonical string of a (possibly interpolated) complex, in
 * the entering frame. Static selectors keep the cached `canonical()` fast path. */
function resolveComplex(c: ComplexSelector, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (!complexHasInterp(c)) {
    return complexCanonical(c);
  }
  const compounds = [resolveCompound(c.head, frame, e), ...c.tail.map(seg => resolveCompound(seg.compound, frame, e))];
  return combineAll(compounds, (values) => {
    let out = c.leadingComb !== undefined && c.leadingComb !== ' '
      ? renderCombinator(c.leadingComb).trimStart() + values[0]!
      : values[0]!;
    for (let i = 0; i < c.tail.length; i++) {
      out += renderCombinator(c.tail[i]!.comb) + values[i + 1]!;
    }
    return out;
  });
}

/** Synchronous-only selector consumers (mixin-key indexing and nested-mode
 * header probes) retain their existing contract. Public emitted selectors use
 * the MaybePromise path above. */
function resolveComplexSync(c: ComplexSelector, frame: Frame | null, e: EvalCtx): string {
  const value = resolveComplex(c, frame, e);
  if (isThenable(value)) {
    throw new Error('async value in a synchronous selector lookup is unsupported');
  }
  return value;
}

/** Compose ONE child complex over ALL `parents`, cartesian-expanded (child-major,
 * parent-minor). `&`-bearing children expand each `&` over every parent; `&`-less
 * children take an implicit descendant prefix, one branch per parent. */
function composeOne(parents: string[], child: ComplexSelector, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const canon = resolveComplex(child, frame, e);
  return mapMaybe(canon, (text) => {
    if (complexHasAmpersand(child)) {
    // A quoted selector interpolation can preserve a comma list as one parent
    // branch. It cannot be substituted into a non-leading `&` merge template
    // such as `.fruit-&`: Less rejects that ambiguous template rather than
    // treating its commas as a source-text selector list.
      if (parents.some(hasTopLevelComma) && !text.startsWith('&')) {
        throw ERR.commaListInterpolation({ node: child, meta: { selector: text } });
      }
      return joinAmpersand(text, parents);
    }
    return parents.map(p => p + ' ' + text);
  });
}

function compose(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const parts = child.selectors.map(c => composeOne(parents, c, frame, e));
  return combineAll(parts, values => values.flat());
}

function composeSync(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const value = compose(parents, child, frame, e);
  if (isThenable(value)) {
    throw new Error('async value in a synchronous nested selector composition is unsupported');
  }
  return value;
}

/**
 * [nesting] The EMITTED-header branches for `child` under `parents`. Identical to
 * `compose` EXCEPT an `&`-less child under MULTIPLE parents compacts to a single
 * `:is(p0, p1, …) child` prefix (alpha v5 header form), instead of one cartesian
 * branch per parent. `compose` (the parent-list carried into further `&` nesting)
 * stays fully cartesian — the two forms diverge only for `&`-less multi-parent.
 * Only called with `parents.length >= 2` (callers use `compose` for the rest).
 */
function composeHeader(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const isPrefix = `:is(${parents.join(', ')}) `;
  const parts = child.selectors.map(c => mapMaybe(resolveComplex(c, frame, e), (canon) => {
    if (complexHasAmpersand(c)) {
      if (parents.some(hasTopLevelComma) && !canon.startsWith('&')) {
        throw ERR.commaListInterpolation({ node: c, meta: { selector: canon } });
      }
      return joinAmpersand(canon, parents);
    }
    return [isPrefix + canon];
  }));
  return combineAll(parts, values => values.flat());
}

/** True if ANY branch of the list references `&` (routes the rule to the cartesian
 * `&`-substitution header instead of the compact `&`-less join). */
function selectorListHasAmpersand(list: SelectorList): boolean {
  for (const c of list.selectors) {
    if (complexHasAmpersand(c)) {
      return true;
    }
  }
  return false;
}

/** [nesting] Compact a branch list into ONE opaque selector unit: a single branch
 * stays bare, a multi-branch comma list wraps in `:is(a, b, …)`. This is the
 * accumulated-ancestor form carried into deeper `&`-less nesting. */
function wrapIsList(branches: string[]): string {
  return branches.length === 1 ? branches[0]! : `:is(${branches.join(', ')})`;
}

/** [nesting] Join opaque ancestor `A` with an all-`&`-less child list, prefix
 * factored: `A` is emitted ONCE and the multi-branch child list wraps in a single
 * `:is(...)` (never cartesian-distributed, never repeated inside the `:is()`).
 * `#…#deux` + `#fourth,#five,#six` → `#…#deux :is(#fourth, #five, #six)`; a single
 * child joins plainly (`A child`, honouring its leading combinator). */
function opaqueJoin(a: string, child: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  const canons = child.selectors.map(c => resolveComplex(c, frame, e));
  return combineAll(canons, values => values.length === 1 ? a + ' ' + values[0]! : a + ' :is(' + values.join(', ') + ')');
}

function ownStrings(list: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  return combineAll(list.selectors.map(c => expandComplex(c, frame, e)), values => values.flat());
}

function ownStringsSync(list: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const value = ownStrings(list, frame, e);
  if (isThenable(value)) {
    throw new Error('async value in a synchronous nested selector header is unsupported');
  }
  return value;
}

/** [atrule-bubbling] Flat-mode own selectors at a ROOT context (no parent): like
 * `ownStrings`, but a `&` with no enclosing parent resolves to EMPTY (Less drops
 * a parentless ampersand), so `.outOfMedia &` at the top of a bubbled at-rule
 * becomes `.outOfMedia`. Non-ampersand selectors keep the fast canonical path. */
function rootStrings(list: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const parts: Array<MaybePromise<string[]>> = [];
  for (const c of list.selectors) {
    const g = loneGroupInterp(c, frame, e);
    if (g !== null) {
      parts.push(g.capture ? g.branches : [g.branches.join(', ')]);
      continue;
    }
    parts.push(mapMaybe(resolveComplex(c, frame, e), value => [complexHasAmpersand(c) ? value.split('&').join('').trim() : value]));
  }
  return combineAll(parts, values => values.flat());
}

/* ------------------------------------------------------------- emit engine */

interface Emit extends EvalCtx {
  chunks: string[];
  off: number;
  positions: Position[] | null;
  // typed value evaluator + configured modes (from EvalCtx: `ev`, `modes`).
  // async patches: a leaf whose value forced an async built-in reserves a
  // placeholder chunk index; the promise resolves the bytes after the sync walk.
  pending: Array<{ i: number; p: Promise<string> }>;
  // [atrule] current block-nesting depth (0 = top level). At-rule bodies raise it
  // so declarations/selectors inside a block indent one level deeper.
  depth: number;
  // [nested/R0] false => preserve authored nesting (Less v5 default); true =>
  // flatten to composed selector strings (4.x / collapseNesting:true).
  collapse: boolean;
  // [extend] per-rule extend overrides, or null when the document has no
  // `:extend()` (zero-cost gate: emit is byte-identical to the no-extend path).
  extends: ExtendResults | null;
  // [extend] set while emitting a hoisted (flattened) nested subtree via the flat
  // path, so headers use the compacted nested-hoist form. Never set in flat mode.
  hoistMode: boolean;
  // [adjacent-merge] the most recently CLOSED rule block, or null. v5 merges
  // consecutive same-selector SIBLING rulesets nested under a common parent into
  // one block (e.g. `P { &-2 {a} &-2 {b} }` → `P-2 { a; b }`). The next block
  // merges into this one when ALL hold: (1) same `parentKey` — the identical parent-
  // expansion the two rulesets are children of (a fresh composed-selector array per
  // parent expansion; `null` for top-level source rules, which NEVER merge even when
  // adjacent+identical — cf. repeated top-level `.whitespace`); (2) byte-identical
  // `header` at the same `depth`; (3) nothing emitted since it closed (`endChunks`
  // still the chunk-stream tail — a strict-adjacency guard). On a match the prior
  // block's `}` is rewound and this body appended inside it (source order, no cross-
  // block dedup). ONE preallocated record, mutated per block flush (no per-block
  // allocation); its seed `parentKey: null` matches nothing (merge needs pk !== null).
  lastBlock: { parentKey: object | null; header: string; depth: number; endChunks: number };
  // [recursion-backstop] current NESTED mixin-expansion depth (0 at the top of a
  // document walk). `expandCall` bumps it around each expansion and raises a clean
  // `RangeError` once it reaches `MAX_MIXIN_DEPTH` — catching a bad-guard runaway
  // before a native stack overflow. Threaded through `scratchEmit`.
  mixinDepth: number;
  loadedImports: Set<string> | null;
  /** A `(multiple)` import makes its transitive imports multiple too. */
  multipleImportDepth: number;
  /** A `(reference)` import contributes facts but suppresses its direct output. */
  referenceImportDepth: number;
  /** The render-owned Context import capability, retained for nested placement. */
  importDocument?: SerializeOptions['importDocument'];
  /** Canonical documents already loaded by the extend planner, consumed once by emission. */
  plannedImportDocuments: WeakMap<ImportAtRule, PlannedImportDocument> | null;
  /**
   * Planner-issued identity tokens for each concrete `$for`/`each()` iteration.
   * The token is selected by the execution index and placed on that iteration's
   * lexical frame; it is intentionally not stored on the immutable AST.
   */
  plannedForExtendPlacements: WeakMap<For, readonly object[]> | null;
  /** Root CSS-terminal imports already written in the required document prelude. */
  hoistedCssImports: Set<ImportAtRule> | null;
}

/**
 * A throwaway {@link Emit} over an {@link EvalCtx}, for a capture-only expansion (a
 * `@p: .mk-map()` binding read as an accessor base — {@link declMapFromMixinCall}).
 * Its chunk/patch state is discarded; it shares the eval seam (`ev`/`modes`) and
 * the `excluded` cycle-guard set with the live context. */
function scratchEmit(e: EvalCtx): Emit {
  return {
    ev: e.ev,
    modes: e.modes,
    excluded: e.excluded,
    propNames: e.propNames,
    optional: e.optional,
    calcDepth: e.calcDepth,
    anyScopedFns: e.anyScopedFns, // [plugin/P1] preserve the scoped-fn gate
    pluginHost: e.pluginHost, // [plugin/P2] preserve the injected plugin runtime
    io: e.io, // [io] preserve the file-read capability
    chunks: [],
    off: 0,
    positions: null,
    pending: [],
    depth: 0,
    collapse: true,
    extends: null,
    hoistMode: false,
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1 }, // [adjacent-merge]
    mixinDepth: 0, // [recursion-backstop] fresh scratch walk; own runaway backstop
    loadedImports: null,
    multipleImportDepth: 0,
    referenceImportDepth: 0,
    plannedImportDocuments: null,
    plannedForExtendPlacements: null,
    hoistedCssImports: null
  };
}

/**
 * [whitespace] Re-indent a multi-line value's continuation lines. A value whose
 * source spans several lines keeps its interior newlines, but Less never lets a
 * continuation line sit LEFT of the property's continuation column: each line
 * after the first whose leading whitespace is shallower than `contIndent` is
 * clamped up to it, while a deeper source indent is preserved verbatim. No-op
 * (single scan, no split) for the single-line values that dominate.
 */
function reindentContinuations(bytes: string, contIndent: string): string {
  if (bytes.indexOf('\n') === -1) {
    return bytes;
  }
  const lines = bytes.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    let ws = 0;
    while (ws < line.length && (line[ws] === ' ' || line[ws] === '\t')) {
      ws++;
    }
    if (ws < contIndent.length) {
      lines[i] = contIndent + line.slice(ws);
    }
  }
  return lines.join('\n');
}

/** Normalize a declaration's `!important` on resolved value bytes: a trailing
 * `!important` (any case, `!` and `important` optionally spaced) is respaced to a
 * single leading space (`100%!important` → `100% !important`) and kept verbatim
 * (never doubled — `20px ! important` stays as-is); an absent one is appended.
 * Only applied when the declaration carries `!important`. */
function normalizeImportant(bytes: string): string {
  const m = /(\s*)(!\s*important)\s*$/iu.exec(bytes);
  return m ? bytes.slice(0, m.index) + ' ' + m[2] : bytes + ' !important';
}

/** Emit a value at a leaf/prelude site: sync `put`, or reserve an async slot.
 * `contIndent`, when given, re-indents multi-line value continuation lines.
 * `emitImportant` normalizes/appends the declaration's `!important` onto the
 * resolved bytes (see {@link normalizeImportant}). Returns the emitted sync bytes,
 * or `null` when the value deferred to an async slot. */
function putValue(e: Emit, node: ValueSlot, frame: Frame | null, positionNode?: Node, contIndent?: string, emitImportant?: boolean, firstOnNewLine?: boolean): string | null {
  // [important] Install a per-declaration importance sink (Less `importantScope`):
  // an `Important`-wrapped variable reference resolved while folding this value sets
  // `hit`, so the declaration hoists a single `!important` even without its own.
  const sink = { hit: false };
  const prevSink = e.importantSink;
  e.importantSink = sink;
  const b = evalBytes(node, frame, e);
  e.importantSink = prevSink;
  const finish = (s: string): string => {
    // [whitespace] `firstOnNewLine` folds the value's first line into a leading
    // (indented) continuation, so a value authored on its own line after `:`
    // re-emits with that layout (multi-line `grid-template-areas`).
    const lead = firstOnNewLine ? `\n${s}` : s;
    const r = contIndent !== undefined ? reindentContinuations(lead, contIndent) : lead;
    return emitImportant || sink.hit ? normalizeImportant(r) : r;
  };
  if (isThenable(b)) {
    const i = e.chunks.length;
    e.chunks.push('');
    e.pending.push({ i, p: Promise.resolve(mapMaybe(b, finish)) });
    return null;
  }
  const bytes = finish(b);
  const valStart = e.off;
  put(e, bytes);
  if (e.positions && positionNode) {
    e.positions.push({ node: positionNode, type: positionNode.type, start: valStart, end: e.off });
  }
  return bytes;
}

/* ------------------------------------------------------------- [extend] */

function put(e: Emit, s: string): void {
  e.chunks.push(s);
  if (e.positions) {
    e.off += s.length;
  }
}

/** A grouped leaf (declaration/comment) plus the frame its values resolve in.
 * `important` is a call-level `!important` override propagated from a
 * `.m() !important` placement onto every declaration the body emits. */
interface Leaf {
  node: Statement;
  frame: Frame;
  important?: boolean;
  /** Produced by the core `$apply` expansion; its repeated output stays visible. */
  fromApply?: true;
}

/** The resolved property name of a declaration (interp names resolve sync). */
function declName(node: Declaration, frame: Frame | null, e: EvalCtx): string {
  return typeof node.name === 'string' ? node.name : evalBytesSync(node.name, frame, e);
}

/**
 * [extend/selector-interp] Resolve a compound's interpolated simples in place, in
 * `frame`, replacing each `@{…}` token with the static resolved text — the SAME
 * per-simple resolution {@link resolveCompound} performs at emit, so the mutated
 * compound serializes byte-identically. Static (`&`, `.a`) simples are untouched.
 * The lazy `_hasInterp` / `_canon` memos are cleared so the fast static path recomputes.
 */
function resolveCompoundInterpInPlace(comp: CompoundSelector, frame: Frame | null, e: EvalCtx): void {
  if (!compoundHasInterp(comp)) {
    return;
  }
  for (let i = 0; i < comp.simples.length; i++) {
    const sim = comp.simples[i]!;
    if (sim.interp !== null) {
      comp.simples[i] = simpleSelector(resolveSimpleTextSync(sim, frame, e));
    }
  }
  comp._hasInterp = false;
  comp._canon = undefined;
}

function resolveComplexInterpInPlace(c: ComplexSelector, frame: Frame | null, e: EvalCtx): void {
  if (!complexHasInterp(c)) {
    return;
  }
  const hasLiteralAmpersand = complexHasAmpersand(c);
  resolveCompoundInterpInPlace(c.head, frame, e);
  for (const seg of c.tail) {
    resolveCompoundInterpInPlace(seg.compound, frame, e);
  }
  c._hasInterp = false;
  c._hasAmp = hasLiteralAmpersand;
  c._canon = undefined;
}

/**
 * [extend/selector-interp] The extend engine ({@link computeExtends}) reads each rule
 * selector's IR BEFORE the frame walk, so a `@{…}` token (`[data=@{attr-data}]`,
 * `.@{n}`) is unresolved (`text: null` → `''`) at match/emit time — the interp rule
 * neither matches an `:extend()` target nor emits its concrete header. This pre-pass
 * resolves each interp selector to its static text in the SAME lexical frame emit
 * would use (a rule's own selector resolves in its PARENT frame), so both the matcher
 * and the nested-plan header see the concrete selector. It mirrors the extend planner's
 * walk EXACTLY (Rule + AtRuleBlock only; never a MixinDef body — those resolve per call
 * frame, not lexically, and the planner skips them too), so no rule is resolved that the
 * planner would not also see. A resolution throw (an unresolvable interp on a guarded /
 * never-emitted rule) leaves the selector untouched — identical to the pre-pass being
 * absent, never worse than baseline.
 */
function resolveSelectorInterpForExtend(statements: Statement[], frame: Frame, e: EvalCtx): void {
  for (const st of statements) {
    // The extend planner reads selectors before the normal frame walk.  Replay
    // declaration activation in this cold prepass so live references observe
    // exactly the declarations that have appeared so far; do not substitute a
    // scoped lookup when the live cell has not been activated.
    if (st.type === 'VariableDeclaration') {
      activateVariableDeclaration(st, frame, e);
    } else if (st.type === 'Declaration') {
      // Selector interpolation is planned before ordinary body emission. Keep a
      // prepass-local property timeline so `$["name"]` observes declarations
      // already encountered in its containing rule, just as normal rendering
      // will, without a text reparse or CST dependency.
      recordPropertyDeclaration(frame, st, frame);
    } else if (st.type === 'Rule') {
      const list = st.selector;
      for (const c of list.selectors) {
        if (!complexHasInterp(c)) {
          continue;
        }
        try {
          resolveComplexInterpInPlace(c, frame, e);
        } catch {
          // Unresolvable interp (e.g. a guarded rule never emitted): leave verbatim —
          // the extend engine falls back to the baseline (no match), never regresses.
        }
      }
      // The same planner reads extend targets before matching. Resolve their
      // typed selector interpolation in this existing cold pass and lexical
      // frame, alongside rule selectors; no selector text recovery or second
      // traversal is introduced.
      for (const inst of st.extendInstructions ?? []) {
        for (const c of inst.target.selectors) {
          if (!complexHasInterp(c)) {
            continue;
          }
          try {
            resolveComplexInterpInPlace(c, frame, e);
          } catch {
            // Preserve the unresolved target when its branch cannot resolve;
            // the planner then keeps the existing no-match behavior.
          }
        }
      }
      const childFrame: Frame = {
        parent: frame,
        mixins: collectMixins(st.body),
        declIndex: collectDeclIndex(st.body), cells: null, reassign: null,
        statements: st.body
      };
      resolveSelectorInterpForExtend(st.body, childFrame, e);
    } else if (st.type === 'AtRuleBlock') {
      // Mirror the planner: an at-rule block does not open a new subject scope for
      // the selector run — recurse with the same frame.
      resolveSelectorInterpForExtend(st.body, frame, e);
    }
  }
}

/** Build extend IR from selector structure in the current render frame. Unlike the
 * old static prepass this never rewrites selector nodes: loop bodies are shared
 * canonical AST and can resolve differently on every iteration. */
function resolvedExtendBranch(node: ComplexSelector, frame: Frame, e: EvalCtx): MaybePromise<Branch> {
  const compound = (part: CompoundSelector): MaybePromise<{ simples: Branch['segs'][number]['compound']['simples'] }> =>
    combineAll(part.simples.map(simple => resolveSimpleText(simple, frame, e)), texts => ({
      simples: texts.map(text => ({ t: 'text' as const, text }))
    }));
  const parts = [compound(node.head), ...node.tail.map(part => compound(part.compound))];
  return combineAll(parts, compounds => ({
    segs: [
      { comb: node.leadingComb ?? ' ', compound: compounds[0]! },
      ...node.tail.map((part, index) => ({ comb: part.comb, compound: compounds[index + 1]! }))
    ]
  }));
}

function resolvedExtendLevel(node: SelectorList, frame: Frame, e: EvalCtx): MaybePromise<Level> {
  return combineAll(node.selectors.map(selector => resolvedExtendBranch(selector, frame, e)), branches => branches);
}

function bodyMayPlanExtend(statements: readonly Statement[]): boolean {
  // Imported component bodies can be deeply nested. This admission scan must be
  // stack-safe and allocation-light: one explicit typed-statement cursor, no
  // selector IR and no recursive descent.
  recordAstExtendProfile?.('astExtend.preflight.bodyAdmissions');
  const pending: Statement[] = [...statements];
  while (pending.length) {
    const statement = pending.pop()!;
    if (statement.type === 'Rule') {
      if (statement.extendInstructions?.length) {
        recordAstExtendProfile?.('astExtend.preflight.bodyFeatureBearing');
        return true;
      }
      for (const child of statement.body) {
        pending.push(child);
      }
    } else if (statement.type === 'AtRuleBlock') {
      for (const child of statement.body) {
        pending.push(child);
      }
    } else if (statement.type === 'For') {
      // `$for`/`each()` bodies are the one dynamic placement form that must
      // admit imported extend planning even before their iterable is evaluated.
      for (const child of statement.rules) {
        pending.push(child);
      }
    }
  }
  recordAstExtendProfile?.('astExtend.preflight.bodyNoFeatureMisses');
  return false;
}

/**
 * Preflight concrete loop placements in source order. It evaluates only the
 * same typed iterable/bindings as `expandFor`, emits no CSS, and records typed
 * selector facts keyed by a fresh iteration token. The canonical body stays
 * shared; no selector or statement is copied into a synthetic stylesheet.
 */
function collectPlacedExtendFacts(
  statements: readonly Statement[],
  frame: Frame,
  e: Emit,
  overlay: { subjects: PlanSubject[]; instructions: PlanInstruction[] },
  path: Level[] = [],
  scope: number[] = [],
  parent: PlanSubject | null = null,
  hidden = false,
  referenceBoundary: object | null = null
): MaybePromise<void> {
  recordAstExtendProfile?.('astExtend.preflight.collectCalls');
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const statement = statements[index]!;
      if (statement.type === 'VariableDeclaration') {
        activateVariableDeclaration(statement, frame, e);
        continue;
      }
      if (statement.type === 'Rule') {
        const own = resolvedExtendLevel(statement.selector, frame, e);
        const addRule = (ownLocal: Level): MaybePromise<void> => {
          const rulePath = [...path, ownLocal];
          const subject: PlanSubject = {
            rule: statement, path: rulePath, scope, ownLocal, parent,
            hidden: hidden || statement.reference === true, referenceBoundary,
            mayMatch: false, placement: frame.extendPlacement
          };
          overlay.subjects.push(subject);
          recordAstExtendProfile?.('astExtend.preflight.overlaySubjects');
          const addInstructions = (instructionIndex: number): MaybePromise<void> => {
            const instruction = statement.extendInstructions?.[instructionIndex];
            if (!instruction) {
              const childFrame: Frame = {
                parent: frame, mixins: collectMixins(statement.body),
                declIndex: collectDeclIndex(statement.body), cells: null, reassign: null,
                statements: statement.body,
                ...(frame.extendPlacement ? { extendPlacement: frame.extendPlacement } : {})
              };
              const nested = collectPlacedExtendFacts(statement.body, childFrame, e, overlay, rulePath, scope, subject, hidden, referenceBoundary);
              return isThenable(nested) ? nested.then(() => run(index + 1)) : run(index + 1);
            }
            // `resolvedExtendLevel` is one selector-list level. An inline
            // `:extend()` still lives at this rule's full ancestor path, just
            // like the static planner's `[...path, levelFromSelectorList(...)]`.
            // Keep the planner's `Level[]` contract here: passing a bare Level
            // makes composePath treat its first Branch as a Level.
            const resolvedExtender = instruction.subject
              ? mapMaybe(resolvedExtendLevel(instruction.subject, frame, e), level => [...path, level])
              : rulePath;
            return mapMaybe(resolvedExtender, extenderPath => mapMaybe(
              resolvedExtendLevel(instruction.target, frame, e), (targets) => {
                for (const target of targets) {
                  overlay.instructions.push({
                    target, partial: instruction.partial, extenderPath,
                    scope, order: overlay.instructions.length, extenderHidden: hidden || statement.reference === true,
                    referenceBoundary
                  });
                  recordAstExtendProfile?.('astExtend.preflight.overlayInstructions');
                }
                return addInstructions(instructionIndex + 1);
              }
            ));
          };
          return addInstructions(0);
        };
        const placed = mapMaybe(own, addRule);
        return placed;
      }
      if (statement.type === 'AtRuleBlock') {
        const nested = collectPlacedExtendFacts(statement.body, frame, e, overlay, path, scope, parent, hidden, referenceBoundary);
        if (isThenable(nested)) {
          return nested.then(() => run(index + 1));
        }
        continue;
      }
      if (statement.type === 'For' && bodyMayPlanExtend(statement.rules)) {
        const items = forItems(statement.iterable, frame, e);
        const tokens = items.map(() => ({}));
        (e.plannedForExtendPlacements ??= new WeakMap()).set(statement, tokens);
        recordAstExtendProfile?.('astExtend.preflight.loopBodies');
        recordAstExtendProfile?.('astExtend.preflight.loopPlacements', items.length);
        const iterations = (itemIndex: number): MaybePromise<void> => {
          for (let i = itemIndex; i < items.length; i++) {
            const item = items[i]!;
            const bindings = bindForEntry(statement, item.value, item.key, dimension(i + 1));
            const loopFrame: Frame = {
              parent: frame, mixins: collectMixins(statement.rules),
              declIndex: collectDeclIndex(statement.rules, bindings), cells: cellsForParams(bindings), reassign: null,
              statements: statement.rules, extendPlacement: tokens[i]!
            };
            const nested = collectPlacedExtendFacts(statement.rules, loopFrame, e, overlay, path, scope, parent, hidden, referenceBoundary);
            if (isThenable(nested)) {
              return nested.then(() => iterations(i + 1));
            }
          }
          return run(index + 1);
        };
        return iterations(0);
      }
    }
  };
  return run(0);
}

/** Build an extend-only document view for `(reference)` imports.  This is
 * deliberately separate from emission: it loads through the existing Context
 * capability, keeps import-once identity locally, activates only variables in
 * source order, and contributes the same parsed Rule identities solely to
 * extend planning. The render walk still owns source-order emission; this is
 * the one intentional pre-render planner view, never a reparse or tree bridge. */
type ExtendPlannerInput = {
  root: Stylesheet;
  hiddenRules: ReadonlySet<Rule>;
  referenceBoundaries: ReadonlyMap<Rule, object>;
  overlay: PlanOverlay;
};

function planImportedExtends(
  root: Stylesheet,
  frame: Frame,
  e: Emit,
  importDocument: SerializeOptions['importDocument'] | undefined
): MaybePromise<ExtendPlannerInput> {
  recordAstExtendProfile?.('astExtend.preflight.calls');
  // A Context-owned import route is already MaybePromise at the document boundary,
  // so it may discover an imported-only extend. Direct AST consumers preserve the
  // historical synchronous no-extend import path.
  // A Context alone must not promote a document with neither imports nor
  // extends into the async planner path. The Context remains available to
  // synchronous callable-body ownership, while actual import/extend facts opt
  // into planning.
  if (!importDocument || (!documentHasExtend(root) && !root.children.some(child => child.type === 'ImportAtRule'))) {
    recordAstExtendProfile?.('astExtend.preflight.noFeatureBypasses');
    return { root, hiddenRules: new Set(), referenceBoundaries: new Map(), overlay: { subjects: [], instructions: [] } };
  }
  const seen = new Set<string>();
  const overlay: { subjects: PlanSubject[]; instructions: PlanInstruction[] } = { subjects: [], instructions: [] };
  const visit = async (statements: readonly Statement[], scope: Frame): Promise<void> => {
    const deferred: ImportAtRule[] = [];
    const visitImport = async (st: ImportAtRule): Promise<void> => {
      recordAstExtendProfile?.('astExtend.preflight.importsVisited');
      const options = st.options === null ? null : evalBytesSync(st.options, scope, e);
      const specifier = importSpecifier(st, scope, e);
      if (!canLoadImport(st, specifier, options)) {
        return;
      }
      recordAstExtendProfile?.('astExtend.preflight.importsLoadable');
      const request: ImportDocumentRequest = {
        node: st, specifier, options,
        tail: st.tail === null ? null : evalQueryPreludeSync(st.tail, scope, e)
      };
      const loaded = await importDocument(request);
      e.plannedImportDocuments?.set(st, { request, loaded });
      if (loaded === undefined || 'inline' in loaded || loaded.document === null) {
        return;
      }
      recordAstExtendProfile?.('astExtend.preflight.importsLoaded');
      if (!importHasOption(options, 'multiple') && loaded.key !== undefined) {
        if (seen.has(loaded.key)) {
          return;
        }
        seen.add(loaded.key);
      }
      rememberImportedCallableBodies(loaded.document, loaded.document.children, e.context);
      // Match the importer: a loaded document is a lexical splice and publishes
      // its direct facts into the importing frame before its body is walked.
      for (const child of loaded.document.children) {
        if (child.type === 'MixinDef') {
          publishImportedMixinDefinition(scope, child);
        }
        if (child.type === 'VariableDeclaration') {
          publishImportedVariableDeclaration(scope, child);
        }
        if (child.type === 'Rule') {
          publishImportedRuleset(scope, child);
          // A plain imported ruleset is also a zero-argument Less mixin. Its
          // canonical Rule remains the namespace fact; publish only its
          // synthesized callable fact for bare `.name()` lookup.
          publishOrderedMixins(scope, orderedMixinsForStatements([child], scope, e), scope);
        }
      }
      const childFrame: Frame = { parent: scope, mixins: collectMixins(loaded.document.children), declIndex: collectDeclIndex(loaded.document.children), cells: null, reassign: null, statements: loaded.document.children };
      // Ordinary imports must not pay selector-IR/planning cost. The typed body
      // itself is the admission fact: it includes static Rule extends and the
      // possible `$for`/`each()` loop bodies whose concrete placements the
      // planner must still preflight.
      // A reference import contributes hidden Rule subjects even when the imported
      // document contains no own `:extend()`: a visible extender in the importing
      // document may still target one of those rules. Ordinary imports retain the
      // feature-bearing admission gate and avoid planner work when no extend facts
      // can participate.
      if (bodyMayPlanExtend(loaded.document.children) || importHasOption(options, 'reference')) {
        recordAstExtendProfile?.('astExtend.preflight.importsFeatureBearing');
        const referenceBoundary = importHasOption(options, 'reference') ? {} : null;
        const placed = collectPlacedExtendFacts(loaded.document.children, childFrame, e, overlay, [], [], null, referenceBoundary !== null, referenceBoundary);
        if (isThenable(placed)) {
          await placed;
        }
      }
      const collect = async (): Promise<void> => {
        await visit(loaded.document!.children, childFrame);
      };
      if (loaded.withinDocument) {
        await loaded.withinDocument(collect);
      } else {
        await collect();
      }
    };
    for (const st of statements) {
      if (st.type === 'VariableDeclaration') {
        activateVariableDeclaration(st, scope, e);
      } else if (st.type === 'ImportAtRule') {
        try {
          await visitImport(st);
        } catch (error) {
          if (!(error instanceof ImportPathNotReady)) {
            throw error;
          }
          deferred.push(st);
        }
      } else if (st.type === 'AtRuleBlock') {
        await visit(st.body, scope);
      }
    }
    for (const pending of deferred) {
      try {
        await visitImport(pending);
      } catch (error) {
        if (error instanceof ImportPathNotReady) {
          throw error.cause;
        }
        throw error;
      }
    }
  };
  return visit(root.children, frame).then(() => ({
    root, hiddenRules: new Set(), referenceBoundaries: new Map(), overlay
  }));
}

export function serialize(root: Stylesheet, options?: SerializeOptions): SerializeReturn {
  const pluginHost = options?.pluginHost;
  const importDocument = options?.importDocument ?? (options?.context ? importThroughContext(options.context) : undefined);
  const rootFns = globalScopedFns(pluginHost);
  const anyScopedFns = rootFns !== null;
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: options?.trackPositions ? [] : null,
    ev: options?.evaluator ?? options?.context?.valueEvaluator ?? null, // typed value evaluator
    modes: options?.modes ?? options?.context?.options ?? DEFAULT_MODES,
    context: options?.context,
    excluded: new Set(), // [resolver] per-declaration cycle guard
    propNames: new Set(), // [property-interp] interpolated-name re-entrancy guard
    optional: options?.optional ?? false, // [resolver] strict (default) vs optional miss
    pending: [], // async patches
    depth: 0, // [atrule]
    collapse: options?.collapseNesting !== false, // [nested/R0] default = flatten
    extends: null, // [extend] computed below (after selector-interp pre-pass)
    hoistMode: false, // [extend]
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1 }, // [adjacent-merge]
    mixinDepth: 0, // [recursion-backstop] runaway mixin-expansion depth guard
    loadedImports: null,
    multipleImportDepth: 0,
    referenceImportDepth: 0,
    importDocument,
    plannedImportDocuments: importDocument ? new WeakMap() : null,
    plannedForExtendPlacements: null,
    hoistedCssImports: null,
    anyScopedFns, // [plugin/P1] gate: false idle ⇒ fn-dispatch walk skipped
    pluginHost, // [plugin/P2] injected plugin runtime for scope-local `@plugin`
    io: options?.io // [io] per-render file-read capability for the IO built-ins
  };
  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    declIndex: collectDeclIndex(root.children), cells: null, reassign: null,
    statements: root.children,
    fns: rootFns, // [plugin/P1] root-global scoped fns (null today)
    sourceOwner: e.context?.currentSourceOwner?.() ?? null
  };
  const continueRender = (planned: ExtendPlannerInput): SerializeReturn => {
    const plannedRoot = planned.root;
    // [extend/selector-interp] Resolve interpolated selectors to static text BEFORE the
    // extend planner reads their IR — only when the document actually has an `:extend()`
    // (the planner's own gate), so a non-extend document is byte- and cost-identical.
    if (documentHasExtend(plannedRoot)) {
      resolveSelectorInterpForExtend(plannedRoot.children, rootFrame, e);
    }
    e.extends = computeExtends(plannedRoot, planned.hiddenRules, planned.referenceBoundaries, planned.overlay); // [extend] null when no `:extend()` anywhere
    const start = e.off;
    // [charset] Hoist the first document-level `@charset` ahead of all body
    // content; inline occurrences are dropped during the walk (dedupe).
    emitHoistedCharset(root.children, rootFrame, e);
    // A caller-provided import handler owns terminal-import decisions itself. The
    // public Context route has no such driver callback, so it uses this direct
    // root-output rule while retaining Context loading for non-terminal imports.
    if (!options?.importDocument) {
      emitHoistedCssImports(root.children, rootFrame, e);
    }
    const emitted = emitDocumentStatements(root.children, rootFrame, e, importDocument);
    const finalize = (): SerializeResult =>
      e.positions ? { css: e.chunks.join(''), positions: e.positions } : { css: e.chunks.join('') };
    const finish = (): SerializeReturn => {
      if (e.positions) {
        e.positions.push({ node: root, type: root.type, start, end: e.off });
      }
      // lift to async ONLY if a genuinely-async built-in reserved a placeholder.
      if (e.pending.length > 0) {
        return Promise.all(
          e.pending.map(x => x.p.then((b) => {
            e.chunks[x.i] = b;
          }))
        ).then(finalize);
      }
      return finalize();
    };
    return mapMaybe(emitted, finish);
  };
  // The reference-import planner owns an isolated lexical frame: planning must
  // never publish variables/mixins/rules into the later render frame.
  const plannerRootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    declIndex: collectDeclIndex(root.children), cells: null, reassign: null,
    statements: root.children,
    fns: rootFns
  };
  const prepare = prepareBodyPlugins(root.children, rootFrame, e);
  const plan = (): SerializeReturn => {
    const planned = planImportedExtends(root, plannerRootFrame, e, importDocument);
    return isThenable(planned) ? planned.then(continueRender) : continueRender(planned);
  };
  return mapMaybe(prepare, plan);
}

/** Emit a source document at the current source-order position without creating a wrapper node. */
function emitDocumentStatements(
  children: readonly Statement[],
  frame: Frame,
  e: Emit,
  importDocument?: SerializeOptions['importDocument'],
  imported = false
): MaybePromise<void> {
  // A referenced document is a fact-only placement: route it through the
  // statement dispatcher so rules/at-rules can be suppressed while declarations,
  // mixin definitions, and nested imports still establish lookup facts.
  const hasDynamicImportTarget = children.some(child => child.type === 'ImportAtRule'
    && child.target.type !== 'Quoted'
    && !(child.target.type === 'Url' && child.target.value.type === 'Quoted'));
  if (!e.collapse && e.referenceImportDepth === 0 && !hasDynamicImportTarget) {
    // Keep the nested emitter's merge behavior for contiguous authored runs,
    // but make a root import an ordered barrier between those runs. Nested
    // import placement remains a separate parity slice; this is the public
    // Less root-import seam.
    let pending: Promise<void> | undefined;
    let batch: Statement[] = [];
    const flushBatch = (): void => {
      if (!batch.length) {
        return;
      }
      const current = batch;
      batch = [];
      if (pending) {
        pending = pending.then(() => Promise.resolve(emitNestedBody(current, frame, e)));
      } else {
        const emitted = emitNestedBody(current, frame, e);
        if (isThenable(emitted)) {
          pending = Promise.resolve(emitted);
        }
      }
    };
    for (const child of children) {
      if (child.type === 'ImportAtRule' && e.hoistedCssImports?.has(child)) {
        continue;
      }
      if (child.type !== 'ImportAtRule') {
        batch.push(child);
        continue;
      }
      flushBatch();
      const emit = () => emitImportAtRule(child, frame, e, importDocument);
      if (pending) {
        pending = pending.then(() => Promise.resolve(emit()));
      } else {
        const current = emit();
        if (isThenable(current)) {
          pending = Promise.resolve(current);
        }
      }
    }
    flushBatch();
    return pending;
  }
  // Less permits an import path to depend on declarations introduced by a later
  // sibling import. Keep the original typed import node pending, continue this
  // lexical body, then make exactly one final attempt after those imports have
  // published their facts. No path text is recovered or parsed again.
  const deferredImports: ImportAtRule[] = [];
  const delayedStatements: Statement[] = [];
  const run = (child: Statement, allowDefer: boolean): MaybePromise<void> => {
    try {
      return emit(child);
    } catch (error) {
      if (allowDefer && child.type === 'ImportAtRule' && error instanceof ImportPathNotReady) {
        deferredImports.push(child);
        return undefined;
      }
      if (error instanceof ImportPathNotReady) {
        throw error.cause;
      }
      throw error;
    }
  };
  let pending: Promise<void> | undefined;
  const emit = (child: Statement): MaybePromise<void> => {
    switch (child.type) {
      case 'Rule':
        // A reference-imported rule is normally output-hidden, but an extend
        // plan may contribute a visible branch from the importing document.
        // Let the existing visibility projection decide that case; do not
        // publish or otherwise render reference rules unconditionally.
        if (e.referenceImportDepth === 0 || e.extends?.hiddenByRule.get(child)?.some(hidden => !hidden) === true) {
          return flatten(child, null, null, frame, e);
        }
        break;
      case 'MixinDef':
        if (imported) {
          publishImportedMixinDefinition(frame, child);
        } else {
          publishSelectedMixinDefinition(frame, child);
        }
        break;
      case 'VariableDeclaration':
        activateVariableDeclaration(child, frame, e);
        break;
      case 'MixinCall': {
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) {
            flushBlock([], group, e);
          }
          group.length = 0;
        };
        return mapMaybe(expandCall(child, null, null, frame, group, flush, null, e), () => {
          flush();
        });
      }
      case 'Apply': {
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) {
            flushBlock([], group, e);
          }
          group.length = 0;
        };
        return mapMaybe(expandApply(child, null, null, frame, group, flush, null, e), () => {
          flush();
        });
      }
      case 'Reference': {
        // A final call step can splice a detached ruleset at document level.
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) {
            flushBlock([], group, e);
          }
          group.length = 0;
        };
        return mapMaybe(expandReferenceCall(child, null, null, frame, group, flush, null, e), () => {
          flush();
        });
      }
      case 'For': {
        // a top-level `each(...)` loop — its body emits at the document level.
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) {
            flushBlock([], group, e);
          }
          group.length = 0;
        };
        return mapMaybe(expandFor(child, null, null, frame, group, flush, null, e), () => {
          flush();
        });
      }
      case 'If': {
        const body = selectIfBodyForRender(child, frame, e);
        if (!body) {
          break;
        }
        const group: Leaf[] = [];
        const flush = (): void => {
          if (group.length) {
            flushBlock([], group, e);
          }
          group.length = 0;
        };
        walkBody(body, null, null, frame, group, flush, null, e);
        flush();
        break;
      }
      case 'Declaration':
      case 'Comment':
        if (e.referenceImportDepth === 0) {
          emitLeaf({ node: child, frame }, e, true);
        }
        break;
      // [atrule] top-level at-rules
      case 'AtRuleBlock':
        if (e.referenceImportDepth === 0) {
          return emitAtRuleBlock(child, frame, e);
        }
        break;
      case 'AtRuleStatement':
        if (e.referenceImportDepth === 0) {
          emitAtRuleStatement(child, frame, e);
        }
        break;
      case 'Plugin':
        // Plugin is a lexical, non-emitting statement. Frame preparation has
        // already registered its functions before this dispatch.
        break;
      case 'ImportAtRule':
        if (e.hoistedCssImports?.has(child)) {
          break;
        }
        return emitImportAtRule(child, frame, e, importDocument);
      case 'StyleImport':
        emitStyleImport(child, frame, e);
        break;
      case 'ModuleImport':
        emitModuleImport(child, frame, e);
        break;
      case 'OpaqueAtRuleBlock':
        emitOpaqueAtRuleBlock(child, e);
        break;
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        emitRawInline(child, e);
        break;
      // a bare value-position call statement (`e('/* … */');`): evaluate + emit.
      case 'FunctionCall':
        emitCallStatement(child, frame, e);
        break;
    }
  };
  for (const child of children) {
    // Once an import target is waiting on a later provider, keep ordinary output
    // behind the retry. Later imports (and live declaration activation) still
    // run now, so they can satisfy that target in the same lexical frame.
    if (deferredImports.length > 0 && child.type !== 'ImportAtRule' && child.type !== 'VariableDeclaration') {
      delayedStatements.push(child);
      continue;
    }
    if (pending) {
      pending = pending.then(() => Promise.resolve(run(child, true)));
      continue;
    }
    const current = run(child, true);
    if (isThenable(current)) {
      pending = Promise.resolve(current);
    }
  }
  const retry = (): MaybePromise<void> => {
    let retried: Promise<void> | undefined;
    for (const child of deferredImports) {
      if (retried) {
        retried = retried.then(() => Promise.resolve(run(child, false)));
      } else {
        const current = run(child, false);
        if (isThenable(current)) {
          retried = Promise.resolve(current);
        }
      }
    }
    return retried;
  };
  const emitDelayed = (): MaybePromise<void> => {
    let delayed: Promise<void> | undefined;
    for (const child of delayedStatements) {
      if (delayed) {
        delayed = delayed.then(() => Promise.resolve(run(child, false)));
      } else {
        const current = run(child, false);
        if (isThenable(current)) {
          delayed = Promise.resolve(current);
        }
      }
    }
    return delayed;
  };
  const finish = (): MaybePromise<void> => {
    const retried = retry();
    return isThenable(retried) ? retried.then(emitDelayed) : emitDelayed();
  };
  return pending ? pending.then(finish) : finish();
}

/**
 * [guards] Whether a rule's `when (...)` guard passes in the scope where the rule
 * is defined (`frame`). An unguarded rule always emits; a CSS ruleset guard never
 * uses `default()` (that is a mixin-dispatch decision), so `isDefault` is `false`.
 */
function ruleGuardPasses(rule: Rule, frame: Frame, e: EvalCtx): boolean {
  if (!rule.guard) {
    return true;
  }
  if (guardUsesDefault(rule.guard)) {
    throw ERR.invalidFunction({
      node: rule,
      meta: {
        name: 'default',
        reason: 'default() is only allowed in parametric mixin guards'
      }
    });
  }
  return evalGuard(rule.guard, {
    resolveTyped: makeTypedResolver(frame, e),
    ev: e.ev,
    modes: e.modes,
    isDefault: () => false
  });
}

/**
 * Select a Jess `$if` arm in authored order without activating it. Jess control
 * flow shares its containing frame, but extend analysis may inspect a selected
 * arm without publishing declaration state.
 */
function selectedIfBody(node: If, frame: Frame, e: Emit): Statement[] | null {
  for (const branch of node.branches) {
    if (branch.guard !== null && !evalGuard(branch.guard, guardDeps(frame, e))) {
      continue;
    }
    return branch.body;
  }
  return null;
}

/** Select one `$if` branch and publish only that branch into this activation's scoped index. */
function selectIfBodyForRender(node: If, frame: Frame, e: Emit): Statement[] | null {
  const body = selectedIfBody(node, frame, e);
  if (!body) {
    return null;
  }
  const selected = frame.selectedIfBodies ??= new Map();
  if (selected.get(node) !== body) {
    selected.set(node, body);
    frame.selectedDeclIndex = collectSelectedDeclIndex(frame.statements ?? [], selected, frame.declIndex);
  }
  return body;
}

/**
 * [guards/&-merge] Whether `rule`'s selector composes to EXACTLY the enclosing
 * block's composed selector (`parent`) — a bare `&` that reproduces the parent
 * (`& { … }` / `& when (…) { … }`). Such a rule is a same-block continuation, not
 * a new rule. A rule carrying `:extend()` is never treated this way (it needs its
 * own header for the extend override). Position tracking is off (a projection).
 */
function isSelfComposed(rule: Rule, parent: string[], frame: Frame, e: Emit): boolean {
  if (rule.extendInstructions !== undefined) {
    return false;
  }
  const composed = compose(parent, rule.selector, frame, e);
  if (isThenable(composed)) {
    return false;
  }
  if (composed.length !== parent.length) {
    return false;
  }
  for (let i = 0; i < composed.length; i++) {
    if (composed[i] !== parent[i]) {
      return false;
    }
  }
  return true;
}

/**
 * [import:reference] Filter a rule's composed header down to its VISIBLE branches.
 * Returns `null` when the rule emits nothing (every branch hidden) — the caller then
 * skips the block entirely. A rule with no hidden branch (the overwhelming common
 * case: any document with no `(reference)` import) returns `header` unchanged, so the
 * serializer stays byte-identical.
 *
 *  - extend folded a per-branch mask (`hiddenByRule`, aligned 1:1 with the FLAT
 *    header): keep the branches whose mask bit is false. This also handles a VISIBLE
 *    rule that received a hidden extender branch (drop just that branch).
 *  - no mask, but the rule itself is `reference` and extend never changed it: all its
 *    (seed-only) branches are hidden → drop the whole rule.
 */
function extendProjection(frame: Frame | null, e: Emit): ExtendResults | ExtendPlacementResults | null {
  const ext = e.extends;
  const placed = ext?.byPlacement;
  if (!placed) {
    return ext;
  }
  // Dynamic plan facts exist only for looped placements. The lexical walk is
  // therefore off the ordinary static path and is bounded by the current nested
  // render-frame chain—not a tree walk or a rediscovery of source nodes.
  for (let cursor = frame; cursor; cursor = cursor.parent) {
    const token = cursor.extendPlacement;
    if (!token) {
      continue;
    }
    const projection = placed.get(token);
    if (projection) {
      return projection;
    }
  }
  return ext;
}

function visibleHeader(rule: Rule, header: string[], frame: Frame, e: Emit): string[] | null {
  const ext = extendProjection(frame, e);
  const mask = ext?.hiddenByRule.get(rule);
  if (mask?.length === header.length) {
    const vis = header.filter((_, i) => mask[i] !== true);
    return vis.length > 0 ? vis : null;
  }
  if (rule.reference === true && ext?.flatByRule.has(rule) !== true) {
    return null;
  }
  return header;
}

function flatten(rule: Rule, parent: string[] | null, ancestor: string | null, frame: Frame, e: Emit, imp = false): MaybePromise<void> {
  // [guards] a guarded ruleset emits its block only when the guard is true.
  if (!ruleGuardPasses(rule, frame, e)) {
    return;
  }
  const rawComposed =
    parent === null ? rootStrings(rule.selector, frame, e) : compose(parent, rule.selector, frame, e);
  return mapMaybe(rawComposed, rawComposed => flattenResolved(rule, parent, ancestor, frame, e, imp, rawComposed));
}

/** Continue a flatten after its selector interpolation has resolved. Keeping this
 * separate preserves the static selector fast path: `mapMaybe` invokes it inline
 * when the selector has no async slot. */
function flattenResolved(
  rule: Rule,
  parent: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  imp: boolean,
  rawComposed: string[]
): MaybePromise<void> {
  // [nesting] `rawComposed` is the fully-cartesian parent-list carried into nested
  // `&` composition (each `&` substitutes over every parent branch). The EMITTED
  // header + the OPAQUE ancestor carried into `&`-less children diverge from it:
  //   - top level (no parent): header is the own selector list.
  //   - a rule with ANY `&` branch keeps the cartesian `&`-substitution header
  //     (the `selectors`-fixture cartesian form) — unchanged.
  //   - an all-`&`-less nested rule COMPACT-joins: the accumulated ancestor `A` is
  //     emitted ONCE and its multi-branch child list wraps in a single `:is(...)`
  //     (`#…#deux :is(#fourth, #five, #six)`), never cartesian-distributed.
  // `childAncestor` is the single opaque unit deeper `&`-less levels concatenate
  // onto (a multi-branch header collapses to `:is(...)`).
  let headerComposed: MaybePromise<string[]>;
  let childAncestor: string;
  if (parent === null) {
    headerComposed = rawComposed;
    childAncestor = wrapIsList(rawComposed);
  } else if (selectorListHasAmpersand(rule.selector)) {
    headerComposed = parent.length < 2 ? rawComposed : composeHeader(parent, rule.selector, frame, e);
    // `headerComposed` can be pending only for an interpolated selector. The
    // raw composed list is already the correct parent context for children.
    childAncestor = wrapIsList(rawComposed);
  } else {
    const joined = opaqueJoin(ancestor ?? wrapIsList(parent), rule.selector, frame, e);
    headerComposed = mapMaybe(joined, value => [value]);
    childAncestor = rawComposed[0] ?? '';
  }
  return mapMaybe(headerComposed, headerComposed => flattenWithHeader(
    rule, parent, frame, e, imp, rawComposed, headerComposed, childAncestor
  ));
}

function flattenWithHeader(
  rule: Rule,
  parent: string[] | null,
  frame: Frame,
  e: Emit,
  imp: boolean,
  rawComposed: string[],
  headerComposed: string[],
  childAncestor: string
): MaybePromise<void> {
  // [extend] the rule's HEADER uses its fully-extended composed branches;
  // children still compose against the RAW composed selector and extend
  // independently (the composed model needs no parent-child override). Absent an
  // extend override the header is byte-identical to the no-extend serializer.
  const projection = extendProjection(frame, e);
  const header0 = e.hoistMode
    ? projection?.hoistHeader.get(rule) ?? projection?.flatByRule.get(rule) ?? headerComposed
    : projection?.flatByRule.get(rule) ?? headerComposed;
  // [import:reference] drop the header branches that originate ONLY from hidden
  // `(reference)` rules; a rule left with no visible branch emits nothing (its body
  // still emits when the rule is pulled in as a mixin — a separate expansion path).
  const header = visibleHeader(rule, header0, frame, e);
  if (header === null) {
    return;
  }
  const priorPlacement = frame.rulePlacements?.get(rule);
  const childFrame: Frame = priorPlacement?.parent === frame
    ? priorPlacement
    : {
        parent: frame,
        mixins: collectMixins(rule.body),
        declIndex: collectDeclIndex(rule.body), cells: null, reassign: null,
        statements: rule.body,
        sourceOwner: sourceOwnerForBody(rule.body, frame, e)
      };
  // Keep the exact render placement: imports within this Rule publish into its
  // child frame and become visible to a later namespace descent through Rule.
  (frame.rulePlacements ??= new Map()).set(rule, childFrame);
  const group: Leaf[] = [];
  const flush = (): void => {
    if (group.length) {
      // [adjacent-merge] `parent` (the parent expansion this rule was composed
      // against) keys sibling merges: two nested rulesets with the same parent ref
      // and header merge; top-level rules (`parent === null`) never do.
      flushBlock(header, group, e, rule.selector, parent);
      group.length = 0;
    }
  };
  // [partition] `group` owns ordinary direct parent declarations, including ones
  // separated by a nested Rule. Deferred containers retain their output order in
  // `trailing`; only a deferred bubbling at-rule makes later direct declarations a
  // trailing same-selector run. `emitBlock` reuses the header + adjacent-merge key
  // for that existing trailing buffer.
  const emitBlock = (leaves: Leaf[]): void => {
    if (leaves.length) {
      flushBlock(header, leaves, e, rule.selector, parent);
    }
  };
  const partition: Partition = {
    encounteredContainer: false,
    afterBubbledAtRule: false,
    trailing: [],
    pending: [],
    emitBlock
  };
  const finish = (): MaybePromise<void> => {
    flush();
    flushPending(partition);
    const runTrailing = (index: number): MaybePromise<void> => {
      for (let i = index; i < partition.trailing.length; i++) {
        const emitted = partition.trailing[i]!();
        if (isThenable(emitted)) {
          return emitted.then(() => runTrailing(i + 1));
        }
      }
    };
    return runTrailing(0);
  };
  const executeBody = () => mapMaybe(
    prepareBodyPlugins(rule.body, childFrame, e),
    () => walkBody(rule.body, rawComposed, childAncestor, childFrame, group, flush, partition, e, imp, false)
  );
  // A Rule can be rendered from an imported document before it is later called
  // as a ruleset-mixin. Its canonical body owns the imported document's source
  // identity in both placements, so nested `(inline)` imports resolve from that
  // document rather than the caller/root document.
  return mapMaybe(withSourceOwner(e, childFrame.sourceOwner, executeBody), finish);
}

/** [partition] Move any buffered trailing-leaf run into `trailing` as one block. */
function flushPending(p: Partition): void {
  if (p.pending.length) {
    const batch = p.pending;
    p.pending = [];
    p.trailing.push(() => p.emitBlock(batch));
  }
}

/** [partition] Buffer generic ordered leaves after an existing deferred container.
 * Direct declarations use the narrower bubbling-at-rule boundary in `walkBody`. */
function addLeaf(group: Leaf[], partition: Partition | null, leaf: Leaf, forceLeading: boolean): void {
  if (partition && partition.encounteredContainer && !forceLeading) {
    partition.pending.push(leaf);
  } else {
    group.push(leaf);
  }
}

/**
 * [partition] Deferred-container ordering for a flattened Rule. Ordinary direct
 * declarations remain in the header `group` across nested Rules. A deferred
 * bubbling at-rule sets `afterBubbledAtRule`, so only later direct declarations
 * enter `pending` and emit after that at-rule. Generic ordered leaves continue to
 * use `encounteredContainer`; `forceLeading` retains its existing parametric-mixin
 * placement behavior. Passing `null` (top level, at-rule bodies) keeps every rule
 * inline in source order.
 */
interface Partition {
  encounteredContainer: boolean;
  /** A deferred bubbling at-rule makes later direct leaves a trailing parent run. */
  afterBubbledAtRule: boolean;
  /** Ordered deferred containers plus existing trailing-leaf blocks. */
  trailing: Array<() => MaybePromise<void>>;
  /** Buffered trailing declarations awaiting the next boundary (a run → one block). */
  pending: Leaf[];
  /** Emit a run of leaves as ONE block reusing this ruleset's header + merge key. */
  emitBlock: (leaves: Leaf[]) => void;
}

/**
 * Walk a body, expanding mixin calls inline against the shared canonical body.
 * `forceLeading` HOISTS this body's declarations into the leading block even past a
 * nested rule — set when expanding a PARAMETRIC mixin (its body is a bare-`&`
 * transparent wrapper in less@4, whose leaves force-lead; a plain ruleset-mixin
 * does NOT hoist, so its declarations split at container boundaries like authored
 * ones).
 */
function walkBody(
  statements: Statement[],
  composed: string[] | null,
  ancestor: string | null, // [nesting] opaque accumulated ancestor for `&`-less child joins
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null,
  e: Emit,
  imp = false, // call-level !important override
  forceLeading = false, // [partition] hoist this body's decls into the leading block
  propertyScope: Frame = frame, // Less `$property` visibility owner
  applyExpansion = false
): MaybePromise<void> {
  for (let index = 0; index < statements.length; index++) {
    const node = statements[index]!;
    switch (node.type) {
      case 'Declaration': {
        // Property accessors see declarations in the order evaluation splices
        // them into the enclosing ruleset. A mixin body retains its call frame for
        // value evaluation but publishes this declaration into `propertyScope`.
        //
        // An ordinary nested Rule does not split this parent declaration block.
        // A deferred bubbling at-rule does: authored direct leaves after it must
        // emit after that at-rule, in a trailing parent block. The partition
        // carries that one placement fact; no AST rewrite or second body walk is
        // needed.
        const pushDeclLeaf = (declaration: Declaration): void => {
          recordPropertyDeclaration(propertyScope, declaration, frame);
          const leaf: Leaf = {
            node: declaration,
            frame,
            ...(imp ? { important: true } : {}),
            ...(applyExpansion ? { fromApply: true } : {})
          };
          if (partition?.afterBubbledAtRule === true && !forceLeading) {
            partition.pending.push(leaf);
          } else {
            group.push(leaf);
          }
        };
        if (isCollectionValue(node.value)) {
          // An SCSS nested-property Collection flattens to hyphenated declarations
          // here: the carrier's own `base` value (when present) first, then each
          // leaf entry with its outer name joined by `-`, in source order.
          const coll = node.value;
          if (coll.base !== undefined) {
            pushDeclLeaf(decl(node.name, coll.base, node.merge, node.important));
          }
          for (const entry of coll.entries) {
            pushDeclLeaf(decl(joinNestedPropertyName(node.name, entry.name), entry.value, entry.merge, entry.important));
          }
          break;
        }
        pushDeclLeaf(node);
        break;
      }
      case 'Comment':
        // [partition] A comment keeps its authored position relative to nested
        // rules: before the first → leading block; after → its own trailing run.
        addLeaf(group, partition, {
          node,
          frame,
          ...(imp ? { important: true } : {})
        }, forceLeading);
        break;
      case 'Rule': {
        // a null `composed` (top-level mixin/detached call) keeps nested
        // rules at the top level (own-strings), not composed against `[]`.
        const rule = node;
        const rFrame = frame;
        const rComposed = composed;
        const rAncestor = ancestor;
        // [guards/&-merge] A nested rule whose selector composes to EXACTLY the
        // enclosing block's selector (a bare `&`, e.g. `& when (@c) { … }`) is not
        // a separate rule: its (guard-passing) body flows into THIS block, in place,
        // rather than opening a duplicate same-selector block. This yields the v5
        // single-block output (`.x { width; color; height }`) for `.x { width; &
        // when(c){color} & when(c){height} }`.
        if (composed !== null && isSelfComposed(rule, composed, frame, e)) {
          if (ruleGuardPasses(rule, frame, e)) {
            const selfFrame: Frame = {
              parent: frame,
              mixins: collectMixins(rule.body),
              declIndex: collectDeclIndex(rule.body), cells: null, reassign: null,
              statements: rule.body
            };
            walkBody(rule.body, composed, ancestor, selfFrame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
          }
          break;
        }
        // [partition] A nested Rule defers to `trailing`, but does not split the
        // parent's direct declaration group. Without a partition (top level /
        // at-rule body) it flushes and emits inline in source order.
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => flatten(rule, rComposed, rAncestor, rFrame, e, imp));
        } else {
          flush();
          const emitted = flatten(rule, rComposed, rAncestor, rFrame, e, imp);
          if (isThenable(emitted)) {
            return emitted.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope, applyExpansion
            ));
          }
        }
        break;
      }
      case 'MixinCall':
        {
          const expanded = expandCall(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, undefined, propertyScope, applyExpansion);
          if (isThenable(expanded)) {
            return expanded.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope, applyExpansion
            ));
          }
        }
        break;
      case 'Apply': {
        const expanded = expandApply(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope);
        if (isThenable(expanded)) {
          return expanded.then(() => walkBody(
            statements.slice(index + 1), composed, ancestor, frame, group, flush,
            partition, e, imp, forceLeading, propertyScope, applyExpansion
          ));
        }
        break;
      }
      case 'Reference':
        {
          const expanded = expandReferenceCall(node, composed, ancestor, frame, group, flush, partition, e, forceLeading, propertyScope, applyExpansion);
          if (isThenable(expanded)) {
            return expanded.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope, applyExpansion
            ));
          }
        }
        break;
      case 'For': {
        const expanded = expandFor(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
        if (isThenable(expanded)) {
          return expanded.then(() => walkBody(
            statements.slice(index + 1), composed, ancestor, frame, group, flush,
            partition, e, imp, forceLeading, propertyScope, applyExpansion
          ));
        }
        break;
      }
      case 'If': {
        const body = selectIfBodyForRender(node, frame, e);
        if (body) {
          walkBody(body, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
        }
        break;
      }
      // [atrule-bubbling] an at-rule nested inside a ruleset body PROJECTS to this
      // block level (flat mode already emits everything at `e.depth`), carrying the
      // enclosing composed selector as its body context so a bubbleable at-rule
      // wraps the ruleset's selector inside. The decl group flushes first so the
      // at-rule sits after the ruleset's own block, matching Less's bubbling order.
      case 'AtRuleBlock': {
        // [atrule-nested] `@starting-style` / unknown at-rules stay INSIDE this
        // block (no bubble): buffer with the decl group so they emit in source
        // order within the parent ruleset. Everything else bubbles out — a bubbling
        // at-rule is a container, so (partitioned) it defers to `trailing` after the
        // leading block, matching the legacy flatten order.
        if (staysNested(node.name)) {
          addLeaf(group, partition, { node, frame }, forceLeading);
          break;
        }
        const atNode = node;
        const atFrame = frame;
        const atComposed = composed;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.afterBubbledAtRule = true;
          partition.trailing.push(() => emitAtRuleBlock(atNode, atFrame, e, atComposed));
        } else {
          flush();
          const emitted = emitAtRuleBlock(node, frame, e, composed);
          if (isThenable(emitted)) {
            return emitted.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope
            ));
          }
        }
        break;
      }
      case 'AtRuleStatement': {
        if (staysNested(node.name)) {
          addLeaf(group, partition, { node, frame }, forceLeading);
          break;
        }
        const atNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.afterBubbledAtRule = true;
          partition.trailing.push(() => emitAtRuleStatement(atNode, frame, e));
        } else {
          flush();
          emitAtRuleStatement(node, frame, e);
        }
        break;
      }
      case 'Plugin':
        break;
      case 'ImportAtRule': {
        // A CSS import recorded inside a canonical Rule is a rule-body
        // statement, not a bubbling container. Keep it in the authored leaf
        // group so it emits inside that rule (and inside any mixin/control-flow
        // body expanded there). Root and at-rule-body imports retain their
        // existing direct emission paths below.
        const options = node.options === null ? null : evalBytesSync(node.options, frame, e);
        const loadsDocument = e.importDocument !== undefined
          && canLoadImport(node, importSpecifier(node, frame, e), options);
        // An `(inline)` import is raw-byte IO, not a parsed document, but it is
        // still an asynchronous Context operation. It cannot be buffered as a
        // Leaf: leaf emission has no continuation slot, so the read would be
        // abandoned and an otherwise empty Rule would render without its splice.
        // Run both Context-backed import forms at this existing body cursor.
        const loadsInline = e.importDocument !== undefined && importHasOption(options, 'inline');
        if (loadsDocument || loadsInline) {
          // A Context-loaded import publishes lookup facts into this exact rule
          // placement. Its continuation must complete before a later sibling
          // statement dispatches (notably `#Namespace > .mixin()`); keeping it
          // as a buffered leaf discarded that MaybePromise.
          flush();
          const imported = emitImportAtRule(node, frame, e, e.importDocument);
          if (isThenable(imported)) {
            return imported.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group,
              flush, partition, e, imp, forceLeading, propertyScope
            ));
          }
        } else if (partition !== null && composed !== null) {
          addLeaf(group, partition, { node, frame }, forceLeading);
        } else {
          flush();
          // `(inline)` is intentionally not a document parse, but it is still
          // asynchronous Context IO. Keep this body cursor alive so a deferred
          // callable's document scope survives the raw-byte read.
          const imported = emitImportAtRule(node, frame, e, e.importDocument);
          if (isThenable(imported)) {
            return imported.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group,
              flush, partition, e, imp, forceLeading, propertyScope
            ));
          }
        }
        break;
      }
      case 'StyleImport': {
        const importNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitStyleImport(importNode, frame, e));
        } else {
          flush();
          emitStyleImport(node, frame, e);
        }
        break;
      }
      case 'ModuleImport': {
        const importNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitModuleImport(importNode, frame, e));
        } else {
          flush();
          emitModuleImport(node, frame, e);
        }
        break;
      }
      case 'OpaqueAtRuleBlock': {
        const opaqueNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.afterBubbledAtRule = true;
          partition.trailing.push(() => emitOpaqueAtRuleBlock(opaqueNode, e));
        } else {
          flush();
          emitOpaqueAtRuleBlock(node, e);
        }
        break;
      }
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline': {
        const riNode = node;
        if (partition) {
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitRawInline(riNode, e));
        } else {
          flush();
          emitRawInline(node, e);
        }
        break;
      }
      // a bare value-position call statement (`e('/* … */');`): flush the pending
      // decl group first so it emits at its authored position, then the line.
      case 'FunctionCall': {
        addLeaf(group, partition, { node, frame }, forceLeading);
        break;
      }
      case 'MixinDef':
        publishSelectedMixinDefinition(frame, node);
        break;
      case 'VariableDeclaration':
        activateVariableDeclaration(node, frame, e);
        break;
    }
  }
}

/**
 * [recursion-backstop] Maximum depth of NESTED mixin expansions. Parametric
 * self-recursion is meant to be terminated by its guard; a bad guard produces a
 * runaway that would blow the JS call stack. This high backstop turns that into a
 * clean, catchable `RangeError` far above any legitimate guarded recursion depth
 * (real Less recurses a handful to low-hundreds of levels) yet with comfortable
 * headroom below the native stack ceiling. Each expansion level costs many JS
 * frames (`expandCall` → `walkBody` → nested `expandCall`), so the measured native
 * ceiling is ~1000 levels and varies with the caller's starting stack depth; 500
 * leaves ~2× margin so the clean error ALWAYS fires before a native overflow,
 * regardless of context. It is a runaway BACKSTOP, not a recursion cap — see
 * `expandCall`.
 */
const MAX_MIXIN_DEPTH = 500;

/**
 * Expand a mixin call: [guards] resolve the overloaded definitions that match
 * (arity + literal pattern + named/default params + guards), then WALK each
 * matching shared def body in place under the current composed selector. No
 * clone, no per-placement node build.
 */
function expandCall(
  call: MixinCall,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  imp = false,
  forceLeading = false, // [partition] inherited leading-hoist context
  captureFrames?: Frame[], // [namespace-accessor] collect each callee's callFrame
  propertyScope: Frame = frame, // caller scope receiving spliced declarations
  applyExpansion = false
): MaybePromise<void> {
  // A namespaced/compound call (`#ns .a .b()`, `.jo.ki()`, `.amp.support()`)
  // resolves by ELEMENT-VALUE descent through the scope's own rulesets (Less
  // `Ruleset.find` / `Selector.mixinElements`): combinators and `&` are ignored,
  // a compound run can span a descendant-nested definition, and the name resolves
  // ONLY inside the matched namespace body — it does NOT fall through to same-name
  // defs in the enclosing/root scope. A bare `.m()` still walks the scope chain
  // accumulating same-name overloads.
  // Explicit `MixinDef`s AND paren-less/plain rulesets callable as zero-arg mixins
  // (Less: `.foo {}` is a mixin) are both candidates, in definition order.
  // [closure] track each candidate's DEFINITION frame: a mixin body resolves its
  // free variables in the scope where the mixin was WRITTEN, not the call site
  // (less@4 `MixinDefinition.frames`). The path finder records the descended
  // definition scope; a bare `.m()` may resolve a def in an ANCESTOR frame.
  const namespaced = call.path.length > 0;
  const homes = new Map<MixinDef, Frame>();
  const rawCandidates = namespaced
    ? findPathCandidates(frame, call, e, homes)
    : lookupCandidates(frame, call.name, e, homes);
  // [parent-exclusion] A paren-less ruleset callable as a zero-arg mixin
  // (`ruleMixin`) is EXCLUDED from its own candidate set while its body is on the
  // active expansion stack — the enclosing frame declines to be its own candidate.
  // `.recursion { .recursion(); }` re-binds to a same-name parametric def (or
  // no-ops) instead of re-entering its own body forever: a non-parametric re-entry
  // carries no new args and makes no progress. This is the mixin half of the file's
  // one exclusion principle (the variable half lives in `resolveVarStack` /
  // `e.excluded`); see `parentExcludes`. It mirrors less@4 mixin-call.js
  // `isRecursive` (a candidate that is NOT a parametric MixinDefinition and equals a
  // ruleset currently in `context.frames` is skipped). A ruleMixin's synthesized
  // `body` IS the source Rule's own body array, and the frame built to expand that
  // Rule carries the SAME array as `statements`, so identity on the array is the
  // rule identity. Parametric recursion DOES progress (new args) and is never
  // excluded here — guards terminate it, and the depth backstop below is the sole
  // error path for a non-terminating (bad-guard) runaway.
  const candidates = rawCandidates.some(d => d.ruleMixin === true)
    ? rawCandidates.filter(d => d.ruleMixin !== true || !parentExcludes(frame, d.body))
    : rawCandidates;
  // A callable becomes visible only when its defining statement has executed.
  // A statement MixinCall remains obligatory: a miss is an error, never a CSS
  // function fallback and never controlled by functionMode.
  if (rawCandidates.length === 0) {
    unresolvedMixinCall(call, e);
  }
  // A ruleset currently expanding may deliberately exclude itself; that is the
  // recursion terminator, not a resolution miss.
  if (candidates.length === 0) {
    return;
  }
  const selected = dispatch(candidates, call, frame, e, homes);
  if (selected.length === 0) {
    return;
  }
  const bodyImp = imp || call.important; // propagate call-level !important
  // [recursion-backstop] Parametric self-recursion (`.loop(@n - 1)`) is terminated
  // by its guard; a MALFORMED guard (`.loop(@n) { .loop(@n + 1) }`) never stops and
  // would otherwise blow the JS stack. Each nested expansion adds one level here; a
  // high backstop (`MAX_MIXIN_DEPTH`) raises a clean, catchable error well before a
  // native stack overflow. This is NOT the parent-exclusion skip above and NOT a low
  // cap — legit deep guarded recursion runs unaffected far below the limit.
  if (e.mixinDepth >= MAX_MIXIN_DEPTH) {
    throw new RangeError('maximum mixin recursion depth exceeded');
  }
  e.mixinDepth++;
  const finish = (): void => {
    e.mixinDepth--;
  };
  const expandSelected = (index: number): MaybePromise<void> => {
    if (index >= selected.length) {
      return;
    }
    const { def, bindings } = selected[index]!;
    // [closure] free variables resolve in the mixin's DEFINITION scope FIRST, with
    // the call-site scope as a fallback — less@4 evaluates a mixin body under
    // `definitionFrames.concat(callerFrames)`. `parent` = the definition frame (so
    // a `@var` written in the mixin's home scope wins over a same-name caller var,
    // e.g. `mixins-closure`); `fallback` = the caller chain, which also keeps the
    // DYNAMIC expansion stack reachable for the ruleset-mixin parent-exclusion
    // check (`parentExcludes`) and lets the body see caller-published mixins. A
    // namespaced call already descends to the definition scope (home is confined
    // to the namespace), so it takes no caller fallback.
    const homeFrame = homes.get(def) ?? frame;
    const callFrame: Frame = {
      parent: homeFrame,
      mixins: collectMixins(def.body),
      declIndex: collectDeclIndex(def.body, bindings), cells: cellsForParams(bindings), reassign: null,
      statements: def.body,
      sourceOwner: sourceOwnerForBody(def.body, frame, e),
      ...(namespaced || homeFrame === frame ? {} : { fallback: frame })
    };
    captureArgDefFrames(bindings, frame, callFrame, e);
    // [namespace-accessor] expose the callee's evaluated scope so a `#ns.m[@var]`
    // accessor can read its VARIABLE members (local `@x:` decls + nested-call
    // leaked vars), which never appear in the emitted-declaration output.
    captureFrames?.push(callFrame);
    // Only an argument-bearing mixin is a transparent parametric wrapper for
    // this output rule. A zero-parameter `MixinDef` splices at its call site;
    // treating every AST MixinDef as force-leading moved `.mixin2()` output
    // ahead of an intervening nested rule in the Less property-accessor corpus.
    const bodyForceLeading = forceLeading || def.params.length !== 0;
    // [adjacent-merge] each mixin expansion is a DISTINCT parent expansion: give
    // its body a FRESH composed-array identity (same values → byte-identical
    // composition) so nested rulesets from two separate calls of the same body do
    // NOT reopen-merge (`.class .inner {} .class .inner {}` stay two blocks —
    // `mixins-important`), while two nested siblings within ONE expansion still
    // share it and merge.
    const bodyComposed = composed === null ? null : composed.slice();
    const executeBody = () => mapMaybe(
      prepareBodyPlugins(def.body, callFrame, e),
      () => walkBody(def.body, bodyComposed, ancestor, callFrame, group, flush, partition, e, bodyImp, bodyForceLeading, propertyScope, applyExpansion)
    );
    const emitted = withSourceOwner(e, callFrame.sourceOwner, executeBody);
    return mapMaybe(emitted, () => {
      // [scope-leak] after expansion the mixin's own `@x:` declarations unlock into
      // the caller scope (visible to later siblings), matching less@4.
      // Keep this continuation outside Context's source scope: only the shared
      // source body owns that scope; the lexical caller owns its published facts.
      leakBodyVars(frame, def.body, callFrame, e);
      // [ruleset-unlock] a ruleset (or nested mixin def) declared inside the called
      // body ALSO unlocks into the caller scope, so a later sibling can call it as a
      // mixin (less@4 splices the body's evaluated rules as siblings of the call, and
      // `Ruleset.find` then resolves against them). `.importRuleset()` defining
      // `.imported` makes `.imported()` callable afterward (`scope` fixture). Reuse
      // the callee frame's already-synthesized def+ruleMixin map (explicit MixinDefs
      // and paren-less rulesets, interleaved) rather than re-scanning the body.
      publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
      if (def.ruleMixin !== true) {
        publishExplicitRulesets(frame, def.body, callFrame);
      }
      return expandSelected(index + 1);
    });
  };
  try {
    const expanded = expandSelected(0);
    if (isThenable(expanded)) {
      return expanded.then(
        () => {
          finish();
        },
        (error) => {
          finish();
          throw error;
        }
      );
    }
    finish();
    return;
  } catch (error) {
    finish();
    throw error;
  }
}

/**
 * `$apply` is a core statement operation, not a spelling of `MixinCall`.
 * It selects every plain ruleset with an exact local selector, never enters
 * parametric mixin dispatch, and walks each matching canonical body in place.
 */
function expandApply(
  node: Apply,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null,
  e: Emit,
  imp = false,
  forceLeading = false,
  propertyScope: Frame = frame
): MaybePromise<void> {
  const selected: Array<{ rule: Rule; home: Frame }> = [];
  for (const selector of node.selectors) {
    const key = compoundCanonical(selector);
    for (let scope: Frame | null = frame; scope; scope = scope.parent) {
      const matches = frameRulesets(scope)?.get(key);
      if (!matches) {
        continue;
      }
      for (const rule of matches) {
        if (!parentExcludes(frame, rule.body) && ruleGuardPasses(rule, scope, e)) {
          selected.push({ rule, home: scope });
        }
      }
    }
  }
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < selected.length; index++) {
      const { rule, home } = selected[index]!;
      const applyFrame: Frame = {
        parent: home,
        mixins: collectMixins(rule.body),
        declIndex: collectDeclIndex(rule.body), cells: null, reassign: null,
        statements: rule.body,
        sourceOwner: sourceOwnerForBody(rule.body, frame, e),
        ...(home === frame ? {} : { fallback: frame })
      };
      const emitted = withSourceOwner(e, applyFrame.sourceOwner, () => mapMaybe(
        prepareBodyPlugins(rule.body, applyFrame, e),
        () => walkBody(
          rule.body, composed, ancestor, applyFrame, group, flush, partition, e,
          imp, forceLeading, propertyScope, true
        )
      ));
      if (isThenable(emitted)) {
        return emitted.then(() => run(index + 1));
      }
    }
  };
  return run(0);
}

/**
 * Descend a namespace path (`#ns > .a`) to the scope frame in which the
 * final mixin dispatches. Each segment resolves a ruleset by own-local selector
 * and layers its body as a new scope. Returns `null` if any segment is unknown.
 */
function descendNamespacePath(path: MixinCall['path'], frame: Frame): Frame | null {
  let scope: Frame | null = frame;
  for (const seg of path) {
    let rules: Rule[] | undefined;
    let owner: Frame | null = null;
    for (let f: Frame | null = scope; f; f = f.parent) {
      const hit = f.rulesets !== undefined || f.statements ? frameRulesets(f)?.get(seg.sel) : undefined;
      if (hit?.length) {
        rules = hit;
        owner = f;
        break;
      }
    }
    if (!rules) {
      return null;
    }
    // Imported facts execute in a particular render placement. A Rule found by
    // namespace lookup contributes both that placement's already-published
    // import prefix and its authored body, matching lexical import splice order.
    const bodies: Statement[] = rules.flatMap(r => [
      ...(owner?.rulePlacements?.get(r)?.importedRules ?? []),
      ...r.body
    ]);
    scope = {
      parent: scope,
      mixins: collectMixins(bodies),
      declIndex: collectDeclIndex(bodies), cells: null, reassign: null,
      statements: bodies
    };
  }
  return scope;
}

/** Closure-bearing args capture their literal home frame in render-local state. */
function captureArgDefFrames(bindings: Map<string, Binding> | null, callerFrame: Frame, callFrame: Frame, e: EvalCtx): void {
  if (!bindings) {
    return;
  }
  for (const v of bindings.values()) {
    if (isValueSlotArray(v)) {
      continue;
    }
    if (v.type === 'DetachedRuleset') {
      bindDetached(callFrame, v, callerFrame, callerFrame.sourceOwner ?? null);
    } else if (v.type === 'MixinCall') {
      (e.mixinCallHomes ??= new WeakMap()).set(v, callerFrame);
    }
  }
}

/**
 * [scope-leak] Less mixin-call variable unlocking: a `@x:` declared in a called
 * mixin body becomes visible in the CALLER scope (less@4 evaluates the body and
 * splices its evaluated declarations as siblings of the call, so
 * `.heightIsSet { height: @height }` after `.setHeight(...)` sees the `@height`
 * the mixin defined). The value is snapshotted in the CALLEE frame (params bound)
 * and pushed onto the caller frame's LEAKED per-name stack — a scope of LOWER
 * priority than the ordinary lexical `vars` chain. v5 "outer-binding-wins": the
 * unlocked value only wins where no enclosing scope already binds the name; a name
 * an outer scope already declares keeps that lexical binding (v5 drops the 4.x
 * hoist that let `@mix: #989` shadow the root `@mix: blue` — see `resolveVarRef`).
 * A detached ruleset / typed literal binds by reference (closure / value type must
 * survive); everything else byte-flattens exactly as a crossed mixin arg does. An
 * async leak (a color/IO fn in the value) is exotic in a leaked position and is
 * left un-snapshotted rather than forcing the walk async.
 */
function leakBodyVars(callerFrame: Frame, body: Statement[], callFrame: Frame, e: EvalCtx): void {
  for (const s of body) {
    if (s.type !== 'VariableDeclaration') {
      continue;
    }
    const v = s.value;
    // A mixin-CALL-bound var (`@p: .m()`) is not byte-snapshottable; leave it to
    // resolve lazily at its call site rather than snapshotting a leaked copy.
    if (isMixinCallValue(v)) {
      continue;
    }
    let snap: ValueNode;
    if (!isValueSlotArray(v) && (v.type === 'DetachedRuleset' || isTypedLiteral(v))) {
      snap = v;
    } else {
      const b = evalBytes(v, callFrame, e);
      if (isThenable(b)) {
        continue;
      }
      snap = any(b);
    }
    const map = (callerFrame.leaked ??= new Map());
    const stack = map.get(s.name);
    if (stack) {
      stack.push(snap);
    } else {
      map.set(s.name, [snap]);
    }
  }
}

/** Merge extra mixin defs into a frame's map in place (scope unlocking). */
function publishMixins(frame: Frame, extra: Map<string, MixinDef[]> | null, home?: Frame): void {
  if (!extra) {
    return;
  }
  // [closure/publish] record each unlocked def's closure home so a later call
  // resolves its free vars/guard there (see `Frame.mixinHomes`). Only when a home
  // frame is supplied AND it differs from the destination (a def published into
  // its own frame keeps the ordinary lexical home).
  if (home && home !== frame) {
    const map = (frame.mixinHomes ??= new Map());
    for (const defs of extra.values()) {
      for (const d of defs) {
        if (!map.has(d)) {
          map.set(d, home);
        }
      }
    }
  }
  if (!frame.mixins) {
    frame.mixins = new Map(extra);
    return;
  }
  for (const [name, defs] of extra) {
    const list = frame.mixins.get(name);
    if (list) {
      list.push(...defs);
    } else {
      frame.mixins.set(name, defs.slice());
    }
  }
}

function publishOrderedMixins(frame: Frame, index: OrderedMixinIndex | null, home?: Frame): void {
  if (!index) {
    return;
  }
  const definitions = new Map<string, MixinDef[]>();
  for (const [name, candidates] of index.byName) {
    definitions.set(name, candidates.map(candidate => candidate.definition));
  }
  publishMixins(frame, definitions, home);
}

/** Publish direct canonical ruleset placements produced by one explicit mixin
 * expansion. A later sibling namespace lookup enters the exact evaluated child
 * frame, retaining its call bindings and any ordered imports. Ruleset-mixins do
 * not use this path: they already participate in ordinary ruleset dispatch.
 */
function publishExplicitRulesets(frame: Frame, body: Statement[], callFrame: Frame): void {
  for (const statement of body) {
    if (statement.type !== 'Rule') {
      continue;
    }
    // A following namespace call can run before this nested rule's deferred
    // render closure. Establish its call-specific lexical placement now, using
    // the existing source facts; `flatten` reuses this exact frame when it later
    // emits the rule. This is not a copied Rule or a second walk.
    let placement = callFrame.rulePlacements?.get(statement);
    if (placement?.parent !== callFrame) {
      placement = {
        parent: callFrame,
        mixins: collectMixins(statement.body),
        declIndex: collectDeclIndex(statement.body), cells: null, reassign: null,
        statements: statement.body
      };
      (callFrame.rulePlacements ??= new Map()).set(statement, placement);
    }
    (frame.publishedRules ??= []).push({ rule: statement, frame: placement });
  }
}

/** The taken branch value of an `if(cond, then, else)` call — its condition
 *  evaluated through the guard evaluator (same rule `evalLogical` applies). The
 *  `else` branch may be absent, so the result can be `undefined`. */
function pickIfBranch(node: FunctionCall, frame: Frame | null, e: EvalCtx): ValueSlot | undefined {
  const cond = node.args[0];
  const taken = cond !== undefined && evalGuard(condGuard(cond), guardDeps(frame, e));
  return taken ? node.args[1] : node.args[2];
}

/**
 * Resolve a binding node to the {@link DetachedRuleset} it names or produces:
 * follow `@var` → `@var` chains AND evaluate a conditional `if(cond, A, B)` whose
 * taken branch is (transitively) a detached ruleset — so `@x: if(cond, {…}, {…});
 * @x();` splices the chosen branch's declarations. Returns `undefined` when the
 * chain terminates in anything that is not a detached ruleset.
 */
/** Follow a `@var` alias chain to a MIXIN-CALL binding (`@alias: .something(foo)`),
 *  so `@alias()` / a `@another-mixin()` parameter dispatches that call. Returns
 *  undefined when the chain does not end at a `MixinCall` (e.g. a detached ruleset). */
function resolveToMixinCall(node: Binding | undefined, frame: Frame | null): MixinCall | undefined {
  const seen = new Set<Binding>();
  let cur: Binding | undefined = node;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (isValueSlotArray(cur)) {
      return undefined;
    }
    if (cur.type === 'MixinCall') {
      return cur;
    }
    if (cur.type === 'VariableReference') {
      cur = lookupVar(frame, cur.name);
      continue;
    }
    return undefined;
  }
  return undefined;
}

function resolveDetachedRuleset(node: Binding, frame: Frame | null, e: EvalCtx): DetachedRuleset | undefined {
  const seen = new Set<Binding>();
  let cur: Binding | undefined = node;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (isValueSlotArray(cur)) {
      return undefined;
    }
    if (cur.type === 'DetachedRuleset') {
      return cur;
    }
    if (cur.type === 'VariableReference') {
      cur = lookupVar(frame, cur.name);
      continue;
    }
    if (cur.type === 'Reference') {
      const resolved = resolveReferenceResult(cur, frame, e);
      cur = resolved?.value;
      continue;
    }
    if (cur.type === 'FunctionCall' && cur.name.toLowerCase() === 'if') {
      cur = pickIfBranch(cur, frame, e);
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** A detached ruleset is callable/map-like, never a CSS declaration value. */
function assertDeclarationValueIsNotRuleset(node: Declaration, frame: Frame | null, e: EvalCtx): void {
  if (!resolveDetachedRuleset(node.value, frame, e)) {
    return;
  }
  throw ERR.rulesetOnProperty({ node, meta: { what: declName(node, frame, e) } });
}

/** Build the overlay frame for a detached-ruleset call (definition scope has
 * priority; caller scope is the fallback). Publishes the ruleset's mixin defs
 * into the CALLER frame (Less scope unlocking). Returns null if the variable is
 * not bound to (or does not conditionally produce) a detached ruleset. */
function referenceCallFrame(
  dr: DetachedRuleset,
  frame: Frame,
  definitionFrame: Frame | null = frame,
  sourceOwner: object | null = null
): { dr: DetachedRuleset; callFrame: Frame } {
  // A detached-ruleset node is canonical and can be passed through several loop
  // activations. Its lexical home is therefore the FRAME that resolved THIS call,
  // never a mutable node-level first-use cache.
  const def = definitionFrame ?? frame;
  const own = collectMixins(dr.body);
  const callFrame: Frame = {
    parent: def, // definition scope has priority
    mixins: own,
    declIndex: collectDeclIndex(dr.body), cells: null, reassign: null,
    fallback: frame, // caller scope is the fallback
    statements: dr.body,
    sourceOwner
  };
  publishMixins(frame, own); // unlocking: caller sees the ruleset's mixins
  return { dr, callFrame };
}

/** Expand a detached-ruleset call (`@ruleset();`) — splice its body through
 * the overlay frame, in the flattened walk. */
function expandReferenceCall(
  call: Reference,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  forceLeading = false, // [partition] inherited leading-hoist context
  propertyScope: Frame = frame,
  applyExpansion = false
): MaybePromise<void> {
  // `@alias: .something(foo); @alias();` — a variable bound to a MIXIN CALL is
  // dispatched as that call (Less: a mixin-call-valued var is callable), not spliced
  // as a detached ruleset. Also covers a mixin PARAMETER carrying a passed call value
  // (`.wrapper(@another-mixin) { @another-mixin(); }`).
  const step = call.steps.at(-1);
  if (step?.type !== 'Call') {
    return;
  }
  const resolved = resolveReferenceResult(call, frame, e);
  if (!resolved) {
    return;
  }
  if (isMixinCallValue(resolved.value)) {
    const home = e.mixinCallHomes?.get(resolved.value) ?? resolved.frame ?? frame;
    return expandCall(resolved.value, composed, ancestor, home, group, flush, partition, e, false, forceLeading, undefined, propertyScope, applyExpansion);
  }
  if (step.args.length !== 0) {
    throw new Error('Reference call arguments require a callable mixin target.');
  }
  const dr = resolveDetachedRuleset(resolved.value, resolved.frame, e);
  if (!dr) {
    return;
  }
  // A detached ruleset passed as a mixin argument closes over the caller frame
  // captured at argument binding time. `resolved.frame` owns the parameter cell,
  // not the detached body; using it here lets a same-named mixin local shadow the
  // argument's free variables. A direct declaration has the same lexical frame
  // either way, so consult the render-local closure fact when it exists.
  const binding = detachedBinding(resolved.frame ?? frame, dr);
  const r = referenceCallFrame(
    dr,
    frame,
    binding?.lexicalFrame ?? resolved.frame,
    binding?.sourceOwner ?? resolved.sourceOwner
  );
  const executeBody = () => mapMaybe(
    prepareBodyPlugins(r.dr.body, r.callFrame, e),
    () => walkBody(r.dr.body, composed, ancestor, r.callFrame, group, flush, partition, e, false, forceLeading, propertyScope, applyExpansion)
  );
  return withSourceOwner(e, r.callFrame.sourceOwner, executeBody);
}

/* --------------------------------------------------------------- [each/For] */

/** One iterable item: its value node plus the map KEY (`null` for a plain list,
 *  where the key defaults to the 1-based index). */
interface ForItem {
  value: ValueSlot;
  key: ValueNode | null;
  detached?: DetachedBinding;
}

/**
 * Split `text` at the TOP level on `,` (comma list) else a whitespace run (space
 * list), skipping anything nested in `()[]{}` or inside a quoted string. Mirrors
 * Less's value model: a comma binds looser than a space, so a top-level comma
 * makes a comma list, otherwise the whitespace runs make a space list. Returns the
 * trimmed non-empty pieces (a single-element array when there is no separator).
 */
function splitListBytes(text: string): string[] {
  const comma = hasTopLevelComma(text);
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number): void => {
    const piece = text.slice(start, end).trim();
    if (piece !== '') {
      parts.push(piece);
    }
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === quote) {
        quote = '';
      }
      continue;
    }
    if (c === '"' || c === '\'') {
      quote = c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
    } else if (depth === 0 && (comma ? c === ',' : c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return parts;
}

/** Whether `text` has a top-level `,` (outside any `()[]{}` group / quoted string). */
function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === quote) {
        quote = '';
      }
      continue;
    }
    if (c === '"' || c === '\'') {
      quote = c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
    } else if (depth === 0 && c === ',') {
      return true;
    }
  }
  return false;
}

/**
 * If the iterable resolves to a MAP (a detached ruleset — inline, a var bound to
 * one, or a `@map[key]` accessor selecting one), return its declaration body + the
 * frame those declarations belong to; else `null` (a list iterable). A map iterates
 * its Declaration / VariableDeclaration entries: key = the entry name, value = its value
 * node. Comments are skipped.
 */
function resolveForRuleset(
  node: ValueSlot,
  frame: Frame | null,
  e: EvalCtx
): { body: Statement[]; frame: Frame | null; detached?: DetachedBinding } | null {
  if (isValueSlotArray(node)) {
    return null;
  }
  if (node.type === 'DetachedRuleset') {
    const binding = detachedBinding(frame, node);
    return { body: node.body, frame: binding?.lexicalFrame ?? frame, detached: binding };
  }
  if (node.type === 'VariableReference') {
    const bound = lookupVar(frame, node.name);
    if (!bound) {
      return null;
    }
    if (isValueSlotArray(bound)) {
      return null;
    }
    if (bound.type === 'DetachedRuleset') {
      const binding = detachedBinding(frame, bound);
      return { body: bound.body, frame: binding?.lexicalFrame ?? frame, detached: binding };
    }
    // The binding is itself an indirection to a ruleset — a `@var` alias chain or
    // a `@map[k]` accessor (`@scheme: @color-schemes[@@name]; each(@scheme, …)` /
    // `@scheme[@color]`). Follow it through the same resolver.
    if (bound.type === 'VariableReference' || bound.type === 'Reference' || bound.type === 'Block') {
      return resolveForRuleset(bound, frame, e);
    }
    return null;
  }
  if (node.type === 'Reference') {
    const resolved = resolveReferenceResult(node, frame, e);
    return resolved === null || isMixinCallValue(resolved.value)
      ? null
      : resolveForRuleset(resolved.value, resolved.frame, e);
  }
  return null;
}

/** Follow a `VariableReference` / `Block` chain to the underlying value node + its owning
 *  frame, so an `each()` iterable's list-vs-scalar shape reads off the DECLARED
 *  node (a literal `Any` list) rather than its flattened bytes. */
function resolveForNode(
  node: ValueSlot,
  frame: Frame | null,
  e: EvalCtx
): { node: ValueSlot; frame: Frame | null } {
  let cur = node;
  let f = frame;
  for (;;) {
    if (isValueSlotArray(cur)) {
      return { node: cur, frame: f };
    }
    if (cur.type === 'Block') {
      cur = cur.inner;
      continue;
    }
    if (cur.type === 'VariableReference') {
      const hit = resolveVarRef(f, cur.name, cur.lookup, e);
      // A mixin-CALL binding is not a plain list/scalar iterable node; stop at the
      // `VariableReference` (the list-fallback then treats it as a single item — the mixin-call
      // iterable proper is handled up front in `forItems`).
      if (!hit || isMixinCallValue(hit.value)) {
        return { node: cur, frame: f };
      }
      cur = hit.value;
      f = hit.frame;
      continue;
    }
    return { node: cur, frame: f };
  }
}

/**
 * Resolve an `each(.mixin(), …)` iterable: the ITERABLE is a mixin CALL whose
 * OUTPUT is iterated. Dispatch the call, collect its emitted declarations, and
 * present them as map items (key = declaration name, value = its value node) —
 * exactly the shape a detached-ruleset map iterates. Nested rulesets in the mixin
 * body are captured but discarded (a map iterates declarations, not rules).
 */
function forItemsFromMixinCall(call: MixinCall, frame: Frame, e: Emit): ForItem[] {
  const collected: Leaf[] = [];
  const noop = (): void => {};
  // Collect EVERY declaration (`forceLeading` → all decls to `collected`), discard
  // nested rules (they defer to `trailing`, which is never drained here).
  const discard: Partition = {
    encounteredContainer: false,
    afterBubbledAtRule: false,
    trailing: [],
    pending: [],
    emitBlock: noop
  };
  expandCall(call, null, null, frame, collected, noop, discard, e, false, true);
  const items: ForItem[] = [];
  for (const leaf of collected) {
    const n = leaf.node;
    if (n.type === 'Declaration') {
      const name = typeof n.name === 'string' ? n.name : evalBytesSync(n.name, leaf.frame, e);
      items.push({ value: n.value, key: any(name) });
    } else if (n.type === 'VariableDeclaration' && !isMixinCallValue(n.value)) {
      items.push({ value: n.value, key: any(n.name) });
    }
  }
  return items;
}

/** The ordered items an `each()` iterable expands to. */
function forItems(node: ValueSlot | MixinCall, frame: Frame | null, e: Emit): ForItem[] {
  // [each mixin-call iterable] `.mixin()` output → iterate its declarations.
  if (isMixinCallValue(node)) {
    return frame === null ? [] : forItemsFromMixinCall(node, frame, e);
  }
  if (!isValueSlotArray(node) && node.type === 'Range') {
    return forRangeItems(node, frame, e);
  }
  const map = resolveForRuleset(node, frame, e);
  if (map) {
    const items: ForItem[] = [];
    for (const s of map.body) {
      if (s.type === 'Declaration') {
        const name = typeof s.name === 'string' ? s.name : evalBytesSync(s.name, map.frame, e);
        items.push({
          value: s.value,
          key: any(name),
          ...(!isValueSlotArray(s.value) && s.value.type === 'DetachedRuleset' && map.detached
            ? { detached: map.detached }
            : {})
        });
      } else if (s.type === 'VariableDeclaration' && !isMixinCallValue(s.value)) {
        items.push({ value: s.value, key: any(s.name) });
      }
    }
    return items;
  }
  // A list iterable. A LITERAL word — an authored list (`1 2 3`, `a, b`) or a var
  // bound to one — is byte-split into its top-level items (Less's Expression/Value
  // list model, which the flattened value domain does not preserve structurally). A
  // COMPUTED value evaluates: a genuine `List` (`range(…)`) iterates its typed
  // items; any other single value (an escaped `e("…")`, a scalar) is ONE item — it
  // is not a list, so it is never split.
  const { node: base, frame: baseFrame } = resolveForNode(node, frame, e);
  if (isValueSlotArray(base)) {
    return base.map(value => ({ value, key: null }));
  }
  if (base.type === 'Range') {
    return forRangeItems(base, baseFrame, e);
  }
  if (base.type === 'List') {
    return base.value.map(value => ({ value, key: null }));
  }
  if (base.type === 'SpacedValue') {
    return base.parts.map(value => ({ value, key: null }));
  }
  if (base.type === 'Any' || base.type === 'Keyword') {
    return splitListBytes(base.src).map(b => ({ value: any(b), key: null }));
  }
  const v = evalTyped(base, baseFrame, e);
  if (isThenable(v)) {
    throw new Error('async value in an each() iterable is unsupported');
  }
  if (v.type === 'List') {
    return v.value.map(it => ({ value: any(it.bytes), key: null }));
  }
  return [{ value: any(v.bytes), key: null }];
}

function forRangeItems(node: Range, frame: Frame | null, e: Emit): ForItem[] {
  const start = evalTyped(node.start, frame, e);
  const end = evalTyped(node.end, frame, e);
  const step = node.step === null ? null : evalTyped(node.step, frame, e);
  if (isThenable(start) || isThenable(end) || isThenable(step)) {
    throw new Error('async value in a $for range is unsupported');
  }
  if (start.type !== 'Dimension' || end.type !== 'Dimension' || (step !== null && step.type !== 'Dimension')) {
    throw new Error('$for range bounds and step must be dimensions');
  }
  const delta = step?.number ?? (start.number <= end.number ? 1 : -1);
  if (delta === 0) {
    throw new RangeError('$for range step cannot be 0');
  }
  const first = start.number + (node.includeStart ? 0 : delta);
  const items: ForItem[] = [];
  for (let current = first; delta > 0
    ? node.includeEnd ? current <= end.number : current < end.number
    : node.includeEnd ? current >= end.number : current > end.number;
    current += delta) {
    items.push({ value: dimension(current, end.unit), key: null });
  }
  return items;
}

function bindForEntry(node: For, value: ValueSlot, key: ValueNode | null, index: ValueNode): Map<string, ValueSlot> {
  const bindings = new Map<string, ValueSlot>();
  const binding = node.binding;
  if (binding.kind === 'single') {
    bindings.set(binding.name, value);
  } else if (binding.kind === 'comma') {
    bindings.set(binding.names[0], value);
    if (binding.names[1] !== undefined) {
      bindings.set(binding.names[1], key ?? index);
    }
    if (binding.names[2] !== undefined) {
      bindings.set(binding.names[2], index);
    }
  } else if (binding.kind === 'bracket') {
    bindings.set(binding.names[0], key ?? index);
    bindings.set(binding.names[1], value);
  } else {
    const values = isValueSlotArray(value) ? value : value.type === 'SpacedValue' ? value.parts : value.type === 'List' ? value.value : [value];
    for (let i = 0; i < binding.names.length && i < values.length; i++) {
      bindings.set(binding.names[i]!, values[i]!);
    }
  }
  return bindings;
}

/** Preserve one iterable detached-ruleset activation through loop parameters. */
function bindForDetached(frame: Frame, bindings: Map<string, ValueSlot>, item: ForItem): void {
  if (!item.detached) {
    return;
  }
  for (const value of bindings.values()) {
    if (value === item.value && !isValueSlotArray(value) && value.type === 'DetachedRuleset') {
      bindDetached(frame, value, item.detached.lexicalFrame, item.detached.sourceOwner);
    }
  }
}

/**
 * Expand a Less `each()` loop: emit the callback `rules` once per iterable item,
 * binding the loop variables (`@value`/`@key`/`@index`, or the anonymous-mixin
 * param names) in each iteration's scope. The statement-emitting counterpart to
 * {@link expandCall}: it walks the SAME shared `group`/`flush` so a `+`/`+_` merge
 * accumulates across iterations (`index+: @index` → `1, 2, 3`).
 */
function expandFor(
  node: For,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  imp = false,
  forceLeading = false, // [partition] inherited leading-hoist context
  propertyScope: Frame = frame,
  applyExpansion = false
): MaybePromise<void> {
  const items = forItems(node.iterable, frame, e);
  const run = (start: number): MaybePromise<void> => {
    for (let i = start; i < items.length; i++) {
      const item = items[i]!;
      const { value, key } = item;
      const index = dimension(i + 1);
      const bindings = bindForEntry(node, value, key, index);
      const extendPlacement = e.plannedForExtendPlacements?.get(node)?.[i];
      const loopFrame: Frame = {
        parent: frame,
        mixins: collectMixins(node.rules),
        declIndex: collectDeclIndex(node.rules, bindings), cells: cellsForParams(bindings), reassign: null,
        statements: node.rules,
        sourceOwner: frame.sourceOwner ?? null,
        ...(extendPlacement ? { extendPlacement } : {})
      };
      bindForDetached(loopFrame, bindings, item);
      const emitted = walkBody(node.rules, composed, ancestor, loopFrame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
      if (isThenable(emitted)) {
        return emitted.then(() => run(i + 1));
      }
    }
  };
  return run(0);
}

/**
 * [guards] Resolve the overloaded definitions that match a call. Args resolve to
 * BYTES in the caller frame (pattern-match); guard leaves compare TYPED values
 * in the callee frame through the injected `ValueEvaluator`.
 */
function dispatch(
  candidates: MixinDef[],
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
  homes?: Map<MixinDef, Frame> // [closure] def → its DEFINITION frame (guard scope)
): Selection[] {
  const resolveCaller = makeResolver(frame, e);
  // [closure] a guard resolves free variables in the mixin's DEFINITION scope, with
  // the params overlaid and the call site as a fallback — the same frame layering
  // `expandCall` builds for the body. Absent a home (detached call)
  // it falls back to the caller frame (`parent: frame`).
  const makeCalleeTyped = (
    def: MixinDef,
    bindings: Map<string, CallValue> | null,
    isDefault: () => boolean
  ): TypedResolver => {
    const home = homes?.get(def);
    // [default-fn] thread the dispatch decision into the operand-resolution ctx so a
    // `default()` inside a comparison (`when (@x = default())`) folds to it. Guard
    // operands resolve SYNC (`makeTypedResolver` throws on async), so the spread ctx
    // never drives the async Emit machinery.
    return makeTypedResolver(
      home && home !== frame
        ? { parent: home, mixins: null, declIndex: collectDeclIndex([], bindings), cells: cellsForParams(bindings), reassign: null, fallback: frame }
        : { parent: frame, mixins: null, declIndex: collectDeclIndex([], bindings), cells: cellsForParams(bindings), reassign: null },
      { ...e, defaultFn: isDefault }
    );
  };
  // A DEFAULT param value resolves with the params bound so far in scope (Less:
  // `@hover-background: darken(@background, …)` reads the `@background` param)
  // overlaid on the mixin's DEFINITION scope, with the call site as a fallback —
  // the same frame layering `makeCalleeTyped` builds for guards. So a default like
  // `@parameter: @parameterDefault` reads the def-scope `@parameterDefault`, not a
  // same-name variable redeclared in the caller (`scope` fixture #allAreUsedHere).
  const resolveDefault: DefaultResolver = (v, boundSoFar, def) => {
    const home = homes?.get(def);
    const overlay: Frame = home && home !== frame
      ? { parent: home, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null, fallback: frame }
      : { parent: frame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    const b = evalBytes(v, overlay, e);
    if (isThenable(b)) {
      throw new Error('async value in a synchronous dispatch position');
    }
    return b;
  };
  // [spread] `.mixin(@args...)` splats a list variable into positional args at the
  // call site (Less variadic forwarding) BEFORE binding, so overloads select on the
  // splatted arity.
  const call1 = expandSpreadArgs(call, resolveCaller);
  // an arg that is a variable bound to a detached ruleset must bind BY
  // REFERENCE (its body/closure survives); substitute the resolved node so the
  // eager byte-resolver never tries to serialize a ruleset as a value.
  const call2 = substituteClosureVarArgs(call1, frame);
  try {
    return selectDefinitions(candidates, call2, resolveCaller, makeCalleeTyped, e.ev, e.modes, resolveDefault);
  } catch (error) {
    if (error instanceof DefaultGuardAmbiguityError) {
      throw ERR.ambiguousDefault({ node: call, meta: { callee: `${call.name}()` } });
    }
    throw error;
  }
}

/** [spread] Replace each `@args...` spread arg with the POSITIONAL args it splats
 * to: resolve the list variable's bytes in the caller frame and split it on the
 * top-level list separator (comma, else whitespace). A spread of an empty/missing
 * value contributes no args. Non-spread args pass through unchanged. */
function expandSpreadArgs(call: MixinCall, resolveCaller: ValueResolver): MixinCall {
  if (!call.args.some(a => a.spread)) {
    return call;
  }
  const args: CallArg[] = [];
  for (const a of call.args) {
    if (!a.spread) {
      args.push(a);
      continue;
    }
    if (isMixinCallValue(a.value)) {
      throw new Error('A deferred mixin call cannot be used as a spread argument.');
    }
    const bytes = resolveCaller(a.value).trim();
    if (bytes === '') {
      continue;
    }
    for (const piece of splitListBytes(bytes)) {
      args.push({ value: any(piece) });
    }
  }
  return { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important };
}

/** Replace `@rs` args (a VariableReference bound to a detached ruleset) with the
 * resolved `DetachedRuleset` node so it binds by reference. */
/**
 * Recognize a mixin-call-shaped VALUE — a `SpacedValue` of a `.`/`#` selector head
 * (`Any`) glued to a `Block` arg group (`.something(foo)`, `#library.core.colors()`)
 * — and build the `MixinCall` it denotes, so a mixin call passed as an arg value
 * (`.wrapper(.something(foo))`) binds as a callable. Returns `undefined` for any
 * other value shape. Mirrors {@link tryMixinCallIterable}, on the serializer's value
 * model rather than raw parser children.
 */
function substituteClosureVarArgs(call: MixinCall, frame: Frame): MixinCall {
  let changed = false;
  const args = call.args.map((a) => {
    // A mixin call passed directly as an arg value (`.wrapper(.something(foo))`):
    // wrap it as a detached ruleset whose body is that call, so `@another-mixin()`
    // dispatches it (its args resolve in the caller frame's runtime binding).
    if ('type' in a.value && a.value.type === 'VariableReference') {
      const bound = lookupVar(frame, a.value.name);
      if (bound && !isValueSlotArray(bound) && bound.type === 'DetachedRuleset') {
        changed = true;
        return { ...a, value: bound };
      }
      // `@alias: .something(foo); .wrapper(@alias);` — a mixin-call-valued var passed
      // as an arg binds BY REFERENCE, wrapped as a detached ruleset whose body is that
      // call (so `@another-mixin()` in the callee dispatches it). The wrapper's home is
      // the caller frame, where the call's own selector/args resolve.
      if (bound && isMixinCallValue(bound)) {
        changed = true;
        return { ...a, value: bound };
      }
    }
    return a;
  });
  return changed ? { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important } : call;
}

function flushBlock(sel: string[], group: Leaf[], e: Emit, selNode?: SelectorList, parentKey?: object | null): void {
  // A root-level mixin/detached-ruleset call has no selector header. Its ordinary
  // declarations are invalid Less output; custom properties remain legal at root.
  if (sel.length === 0) {
    for (const leaf of group) {
      if (leaf.node.type !== 'Declaration') {
        continue;
      }
      const name = declName(leaf.node, leaf.frame, e);
      if (!name.startsWith('--')) {
        throw ERR.propertyInRoot({ node: leaf.node, meta: { what: name } });
      }
    }
  }
  // [atrule] indent by the current block depth (0 at top level == prior behavior).
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  const header = idt ? sel.join(',\n' + idt) : sel.join(',\n');
  // [adjacent-merge] v5 merges consecutive same-selector SIBLING rulesets nested
  // under a common parent (see `Emit.lastBlock`): a non-null parent-expansion key
  // matching the prior block's, same header+depth, and strict adjacency (nothing
  // emitted since it closed) reopen the prior block rather than starting a new one.
  const pk = parentKey ?? null;
  const lb = e.lastBlock;
  const reopen = pk !== null && lb.parentKey === pk
    && lb.depth === e.depth && lb.header === header && lb.endChunks === e.chunks.length;
  if (reopen) {
    popClose(e, idt); // remove the prior block's trailing `}` (and its indent)
  } else {
    if (idt) {
      put(e, idt);
    }
    const selStart = e.off;
    put(e, header);
    if (e.positions && selNode) {
      e.positions.push({ node: selNode, type: selNode.type, start: selStart, end: e.off });
    }
    put(e, ' {\n');
  }
  // a leaf group with any `+`/`+_` merge folds; otherwise the byte-identical
  // per-leaf path (zero-cost gate), after collapsing duplicate declarations.
  if (groupHasMerge(group)) {
    mergeFold(group, e, INDENT.repeat(e.depth + 1));
  } else {
    const kept = dedupGroup(group, e);
    for (const leaf of kept) {
      emitLeaf(leaf, e);
    }
  }
  if (idt) {
    put(e, idt);
  }
  put(e, '}\n');
  // [adjacent-merge] update the single record in place (no per-block allocation).
  lb.parentKey = pk;
  lb.header = header;
  lb.depth = e.depth;
  lb.endChunks = e.chunks.length;
}

/** [adjacent-merge] Rewind the trailing block-close chunks emitted by `flushBlock`
 * (`}\n`, preceded by the block's indent chunk when nested) so a following body can
 * append inside the just-closed block. Only called when `lastBlock.endChunks`
 * proves those chunks are the current tail. */
function popClose(e: Emit, idt: string): void {
  const close = e.chunks.pop()!; // '}\n'
  if (e.positions) {
    e.off -= close.length;
  }
  if (idt) {
    const ind = e.chunks.pop()!; // the block-indent chunk
    if (e.positions) {
      e.off -= ind.length;
    }
  }
}

/**
 * [dedup] Canonical duplicate-declaration handling: within one block, for each
 * (name, value, !important) key keep only the LAST occurrence and drop earlier
 * exact duplicates, including repeated or overloaded mixin output. A cheap gate counts resolved names first
 * and bails when no property repeats, so a block without duplicates resolves no
 * value bytes (perf-neutral common path). Merge (`+`/`+_`) groups take the fold
 * path and never reach here.
 */
function dedupGroup(group: Leaf[], e: Emit): Leaf[] {
  if (group.length < 2) {
    return group;
  }
  // Gate: resolve each declaration NAME (cheap for string names); dedup only runs
  // if some property name occurs more than once in the block.
  const names: (string | null)[] = new Array(group.length).fill(null);
  const nameCounts = new Map<string, number>();
  let repeats = false;
  for (let i = 0; i < group.length; i++) {
    const n = group[i]!.node;
    if (n.type !== 'Declaration') {
      continue;
    }
    const nm = declName(n, group[i]!.frame, e);
    names[i] = nm;
    const c = (nameCounts.get(nm) ?? 0) + 1;
    nameCounts.set(nm, c);
    if (c > 1) {
      repeats = true;
    }
  }
  if (!repeats) {
    return group;
  }
  // Reverse keep-last: a key already recorded from a LATER position collapses this
  // (earlier) occurrence.
  const seen = new Set<string>();
  let suppressed: Set<number> | null = null;
  for (let i = group.length - 1; i >= 0; i--) {
    const leaf = group[i]!;
    const n = leaf.node;
    if (n.type !== 'Declaration') {
      continue;
    }
    const nm = names[i]!;
    if ((nameCounts.get(nm) ?? 0) < 2) {
      continue;
    } // unique name → nothing to collapse
    const val = evalBytesSync(n.value, leaf.frame, e);
    const important = n.important || leaf.important === true;
    const key = `${nm}\x00${val}\x00${important ? '!' : ''}`;
    if (seen.has(key) && leaf.fromApply !== true) {
      (suppressed ??= new Set<number>()).add(i);
    } else {
      seen.add(key);
    }
  }
  if (!suppressed) {
    return group;
  }
  const out: Leaf[] = [];
  for (let i = 0; i < group.length; i++) {
    if (!suppressed.has(i)) {
      out.push(group[i]!);
    }
  }
  return out;
}

/* --------------------------------------------------------------- merge */

function groupHasMerge(group: Leaf[]): boolean {
  for (const l of group) {
    if (l.node.type === 'Declaration' && l.node.merge !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Emit a leaf group, folding `+`/`+_` merge declarations. v5 LAST-occurrence
 * anchor: a merged property's combined line sits at its LAST member's position;
 * members keep source order; any member's `!important` promotes the whole line.
 * Non-merge decls and comments emit in place (unchanged). `idt` is the leaf
 * indentation of the enclosing block. Deliberate v5 divergence from less.js
 * `_mergeRules` (which anchors FIRST); see CUTOVER-STATUS.md.
 */
function mergeFold(group: Leaf[], e: Emit, idt: string, emitOne: (l: Leaf, e: Emit) => void = emitLeaf): void {
  // Resolve each declaration's name once.
  const names: (string | null)[] = group.map(l =>
    l.node.type === 'Declaration' ? declName(l.node, l.frame, e) : null
  );
  // Merge groups: resolved name → member indices (source order).
  const mergeGroups = new Map<string, number[]>();
  for (let i = 0; i < group.length; i++) {
    const n = group[i]!.node;
    if (n.type === 'Declaration' && n.merge !== null) {
      const key = names[i]!;
      const arr = mergeGroups.get(key);
      if (arr) {
        arr.push(i);
      } else {
        mergeGroups.set(key, [i]);
      }
    }
  }
  for (let i = 0; i < group.length; i++) {
    const leaf = group[i]!;
    const n = leaf.node;
    if (n.type === 'Declaration' && n.merge !== null) {
      const indices = mergeGroups.get(names[i]!)!;
      if (i !== indices[indices.length - 1]) {
        continue;
      } // earlier members emit nothing; anchor at LAST
      let combined = '';
      let important = false;
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k]!;
        const mergeLeaf = group[idx]!;
        if (mergeLeaf.node.type !== 'Declaration') {
          throw new TypeError('Expected declaration merge member');
        }
        const dn = mergeLeaf.node;
        // Match ordinary declaration emission: an Important wrapper may sit
        // behind a variable reference, and promotes this whole merged line.
        // Keep that one-bit signal on the existing emit context: merged output
        // already takes this path only after `groupHasMerge` admitted the group.
        const previousImportant = e.mergeImportant;
        e.mergeImportant = false;
        const bytes = evalBytesSync(dn.value, group[idx]!.frame, e);
        important ||= dn.important || group[idx]!.important === true || e.mergeImportant;
        e.mergeImportant = previousImportant;
        if (k === 0) {
          combined = bytes;
        } else {
          combined += (dn.merge === ',' ? ', ' : ' ') + bytes;
        }
      }
      emitMergedLine(e, names[i]!, combined, important, idt);
    } else {
      emitOne(leaf, e);
    }
  }
}

/** A declaration value that is an SCSS nested-property {@link Collection}. */
function isCollectionValue(value: ValueSlot): value is Collection {
  return !Array.isArray(value) && (value as ValueNode).type === 'Collection';
}

/** Append literal text to an interpolation part list, coalescing adjacent literals. */
function appendInterpLiteral(parts: Interpolation['parts'], text: string): void {
  const previous = parts[parts.length - 1];
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + text };
  } else {
    parts.push({ lit: text });
  }
}

/** Join an SCSS nested-property outer name and a leaf name with a literal `-`,
 * preserving interpolation structure when either side is an {@link Interpolation}. */
function joinNestedPropertyName(prefix: string | Interpolation, leaf: string | Interpolation): string | Interpolation {
  if (typeof prefix === 'string' && typeof leaf === 'string') {
    return `${prefix}-${leaf}`;
  }
  const parts: Interpolation['parts'] = [];
  const appendName = (name: string | Interpolation): void => {
    if (typeof name === 'string') {
      appendInterpLiteral(parts, name);
    } else {
      for (const part of name.parts) {
        if ('lit' in part) {
          appendInterpLiteral(parts, part.lit);
        } else {
          parts.push(part);
        }
      }
    }
  };
  appendName(prefix);
  appendInterpLiteral(parts, '-');
  appendName(leaf);
  return interpolation(parts);
}

/** Emit one folded `name: combined[ !important];` line. */
function emitMergedLine(e: Emit, name: string, combined: string, important: boolean, idt: string): void {
  const start = e.off;
  put(e, idt);
  put(e, name);
  put(e, ': ');
  put(e, combined);
  if (important) {
    put(e, ' !important');
  }
  put(e, ';\n');
  if (e.positions) {
    e.positions.push({ node: any(combined), type: 'Any', start, end: e.off });
  }
}

function emitLeaf(leaf: Leaf, e: Emit, atRoot = false): void {
  const { node, frame } = leaf;
  const start = e.off;
  // [atrule] a declaration/comment sits one level in from its container's depth.
  // A leaf emitted directly at the document root (not inside any block) sits flush
  // left at depth 0 rather than one level in.
  const idt = atRoot ? INDENT.repeat(e.depth) : e.depth > 0 ? INDENT.repeat(e.depth + 1) : INDENT;
  if (node.type === 'Declaration') {
    assertDeclarationValueIsNotRuleset(node, frame, e);
    if (atRoot && !declName(node, frame, e).startsWith('--')) {
      throw ERR.propertyInRoot({ node, meta: { what: declName(node, frame, e) } });
    }
    put(e, idt);
    put(e, declName(node, frame, e)); // resolve interpolated property name
    const onNewLine = node.valueOnNewLine === true;
    put(e, onNewLine ? ':' : ': ');
    const important = node.important === true || leaf.important === true;
    putValue(e, node.value, frame, isValueSlotArray(node.value) ? undefined : node.value, idt + INDENT, important, onNewLine); // [whitespace] continuation indent
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
    put(e, ';\n');
  } else if (node.type === 'Comment') {
    put(e, idt);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
  } else if (node.type === 'FunctionCall') {
    const bytes = evalBytesSync(node, frame, e);
    if (bytes.length === 0) {
      return;
    }
    put(e, idt);
    put(e, bytes);
    put(e, '\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
  } else if (node.type === 'AtRuleBlock') {
    // [atrule-nested] a stay-nested at-rule buffered into a decl group: emit one
    // block level deeper than the containing declarations.
    e.depth++;
    emitAtRuleBlock(node, frame, e);
    e.depth--;
  } else if (node.type === 'AtRuleStatement') {
    e.depth++;
    emitAtRuleStatement(node, frame, e);
    e.depth--;
  } else if (node.type === 'ImportAtRule') {
    e.depth++;
    emitImportAtRule(node, frame, e, e.importDocument);
    e.depth--;
  } else if (node.type === 'OpaqueAtRuleBlock') {
    e.depth++;
    emitOpaqueAtRuleBlock(node, e);
    e.depth--;
  }
}

/* ------------------------------------------------------------ [atrule] emit */

/** A statement at-rule: `@name prelude;` with prelude bytes kept literal. */
/** [charset] `@charset` is a document-prelude construct, not an inline at-rule. */
function isCharset(node: AtRuleStatement): boolean {
  return node.name.toLowerCase() === '@charset';
}

/**
 * [charset] Emit the FIRST document-level `@charset` at the top of the output.
 * Every inline occurrence (including this one) is dropped by
 * `emitAtRuleStatement`, so the single hoisted copy is the whole output — the
 * dedupe. Mirrors legacy jess / Less 4.x: first charset wins, rest dropped.
 */
function emitHoistedCharset(children: Statement[], frame: Frame, e: Emit): void {
  for (const c of children) {
    if (c.type === 'AtRuleStatement' && isCharset(c as AtRuleStatement)) {
      emitAtRuleStatementRaw(c as AtRuleStatement, frame, e);
      return;
    }
  }
}

/**
 * Less emits root CSS-terminal imports before ordinary rules and retains only
 * their first identical occurrence. This is a root-output rule, not import
 * resolution: loaded stylesheet imports still execute exactly at their source
 * position through Context. Keep this narrow until typed Less import options and
 * media wrapping are represented rather than guessed from source text.
 */
function rootCssImportKey(node: ImportAtRule): string | null {
  if (node.options !== null || node.alias !== null) {
    return null;
  }
  const target = node.target;
  const path = target.type === 'Quoted'
    ? target.src
    : target.type === 'Url' && target.value.type === 'Quoted'
      ? `url(${target.value.src})`
      : null;
  if (path === null) {
    return null;
  }
  const cssTarget = /\.css(?:[?#].*)?"?$/iu.test(path)
    || /^(?:"|')?(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(path);
  // The current typed Less route already treats a media/layer tail as CSS
  // terminal output. Preserve that established boundary while the later media
  // wrapping import slice is still unimplemented.
  if (!cssTarget && node.tail === null) {
    return null;
  }
  if (node.tail !== null && node.tail.type !== 'Any') {
    return null;
  }
  return `${node.name}\u0000${path}\u0000${node.tail?.src ?? ''}`;
}

function emitHoistedCssImports(children: Statement[], frame: Frame, e: Emit): void {
  const seen = new Set<string>();
  let hoisted: Set<ImportAtRule> | null = null;
  for (const child of children) {
    if (child.type !== 'ImportAtRule') {
      continue;
    }
    const key = rootCssImportKey(child);
    if (key === null) {
      continue;
    }
    (hoisted ??= new Set()).add(child);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    emitCssImportAtRule(child, frame, e);
  }
  e.hoistedCssImports = hoisted;
}

function emitAtRuleStatement(node: AtRuleStatement, frame: Frame, e: Emit): void {
  // [charset] Inline `@charset` occurrences are dropped; `serialize` hoists the
  // first to the document top (dedupe).
  if (isCharset(node)) {
    return;
  }
  emitAtRuleStatementRaw(node, frame, e);
}

function emitAtRuleStatementRaw(node: AtRuleStatement, frame: Frame, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  put(e, node.name);
  if (node.prelude !== null) {
    // A statement prelude resolves only `@{…}` interpolation (`@charset
    // "UTF-@{Eight}"`); a bare-`@var` / static prelude is a verbatim `Any`.
    const p = evalBytesSync(node.prelude, frame, e).replace(/^\s+/u, '');
    if (p.length > 0) {
      put(e, ' ');
      put(e, p);
    }
  }
  put(e, ';\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/**
 * Emit a typed import. With a driver-supplied document capability, a loaded
 * canonical document executes at this exact source-order point in `frame`.
 * Core deliberately knows neither paths nor parser plugins; a declined request
 * remains a CSS import statement.
 */
function emitImportAtRule(
  node: ImportAtRule,
  frame: Frame,
  e: Emit,
  importDocument?: SerializeOptions['importDocument'],
  emitLoaded?: (document: Stylesheet, frame: Frame) => MaybePromise<void>
): MaybePromise<void> {
  if (importDocument) {
    const planned = e.plannedImportDocuments;
    const plannedImport = planned?.has(node)
      ? (() => {
          const loaded = planned.get(node)!;
          planned.delete(node);
          return loaded;
        })()
      : null;
    const request = plannedImport?.request ?? {
      node,
      specifier: importSpecifier(node, frame, e),
      options: node.options === null ? null : evalBytesSync(node.options, frame, e),
      tail: node.tail === null ? null : evalQueryPreludeSync(node.tail, frame, e)
    };
    const loadedRequest = plannedImport ? plannedImport.loaded : importDocument(request);
    return mapMaybe(loadedRequest, (loaded) => {
      if (loaded !== undefined) {
        if ('inline' in loaded) {
          emitRawInline({ type: 'RawInline', text: loaded.inline, ...(loaded.media !== null ? { media: loaded.media } : {}) }, e);
          return;
        }
        if (request.options === null && e.multipleImportDepth === 0 && loaded.key !== undefined) {
          const seen = e.loadedImports ??= new Set();
          if (seen.has(loaded.key)) {
            return;
          }
          seen.add(loaded.key);
        }
        for (const child of loaded.document?.children ?? []) {
          if (child.type === 'MixinDef') {
            publishImportedMixinDefinition(frame, child);
          }
          if (child.type === 'VariableDeclaration') {
            publishImportedVariableDeclaration(frame, child);
          }
          if (child.type === 'Rule') {
            publishImportedRuleset(frame, child);
            // Keep bare ruleset-mixin lookup aligned with namespace lookup for
            // an executed lexical import. This is a render-frame callable fact,
            // not an AST copy or an alternate import path.
            publishOrderedMixins(frame, orderedMixinsForStatements([child], frame, e), frame);
          }
        }
        if (loaded.document === null) {
          return;
        }
        rememberImportedCallableBodies(loaded.document, loaded.document.children, e.context);
        const emitDocument = () => emitLoaded
          ? emitLoaded(loaded.document!, frame)
          : emitDocumentStatements(loaded.document!.children, frame, e, importDocument, true);
        // A stylesheet import with a typed postlude is still a stylesheet
        // import—not a CSS terminal.  Its loaded document executes once at this
        // lexical position inside ONE media wrapper carrying the complete typed
        // tail.  Do not split/query-reparse the tail: the parser already owns it.
        const emit = (): MaybePromise<void> => {
          if (request.tail === null) {
            return emitDocument();
          }
          const indent = e.depth > 0 ? INDENT.repeat(e.depth) : '';
          if (indent) {
            put(e, indent);
          }
          put(e, '@media ');
          put(e, request.tail);
          put(e, ' {\n');
          e.depth++;
          const finish = (): void => {
            e.depth--;
            if (indent) {
              put(e, indent);
            }
            put(e, '}\n');
          };
          try {
            const emitted = emitDocument();
            return isThenable(emitted)
              ? emitted.then(() => {
                  finish();
                }, (error) => {
                  e.depth--;
                  throw error;
                })
              : (finish(), emitted);
          } catch (error) {
            e.depth--;
            throw error;
          }
        };
        const multiple = importHasOption(request.options, 'multiple');
        const reference = e.referenceImportDepth > 0 || importHasOption(request.options, 'reference');
        if (multiple || reference) {
          if (multiple) {
            e.multipleImportDepth++;
          }
          if (reference) {
            e.referenceImportDepth++;
          }
          let result: MaybePromise<void>;
          try {
            result = loaded.withinDocument ? loaded.withinDocument(emit) : emit();
          } catch (error) {
            if (reference) {
              e.referenceImportDepth--;
            }
            if (multiple) {
              e.multipleImportDepth--;
            }
            throw error;
          }
          if (isThenable(result)) {
            return result.then(
              () => {
                if (reference) {
                  e.referenceImportDepth--;
                }
                if (multiple) {
                  e.multipleImportDepth--;
                }
              },
              (error) => {
                if (reference) {
                  e.referenceImportDepth--;
                }
                if (multiple) {
                  e.multipleImportDepth--;
                }
                throw error;
              }
            );
          }
          if (reference) {
            e.referenceImportDepth--;
          }
          if (multiple) {
            e.multipleImportDepth--;
          }
          return result;
        }
        return loaded.withinDocument ? loaded.withinDocument(emit) : emit();
      }
      emitCssImportAtRule(node, frame, e);
    });
  }
  emitCssImportAtRule(node, frame, e);
}

/** A missing typed interpolation reference is retryable only at an import boundary. */
class ImportPathNotReady extends Error {
  constructor(override readonly cause: Error) {
    super(cause.message);
  }
}

/** Extract the resolver-facing specifier without reproducing parser recognition. */
function importSpecifier(node: ImportAtRule, frame: Frame, e: Emit): string {
  try {
    if (node.target.type === 'Quoted') {
      return node.target.value;
    }
    if (node.target.type === 'Url' && node.target.value.type === 'Quoted') {
      return node.target.value.value;
    }
    const bytes = evalBytesSync(node.target, frame, e);
    if (bytes.startsWith('url(') && bytes.endsWith(')')) {
      return bytes.slice(4, -1);
    }
    if (bytes.length >= 2 && (bytes[0] === '"' || bytes[0] === '\'') && bytes.at(-1) === bytes[0]) {
      return bytes.slice(1, -1);
    }
    return bytes;
  } catch (error) {
    if (
      error instanceof ReferenceError
      || (error instanceof JessError && error.code === 'resolve/name-not-found')
    ) {
      throw new ImportPathNotReady(error);
    }
    throw error;
  }
}

/** Write the preserved CSS import syntax when no canonical document is loaded. */
function emitCssImportAtRule(node: ImportAtRule, frame: Frame, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  put(e, node.name);
  if (node.options !== null) {
    put(e, ` (${evalBytesSync(node.options, frame, e)})`);
  }
  put(e, ' ');
  put(e, evalBytesSync(node.target, frame, e));
  if (node.alias !== null) {
    put(e, ' as ');
    put(e, evalBytesSync(node.alias, frame, e));
  }
  if (node.tail !== null) {
    const tail = evalQueryPreludeSync(node.tail, frame, e);
    if (tail.length > 0) {
      put(e, ` ${tail}`);
    }
  }
  put(e, ';\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/** Write parser-owned Jess import facts. Loading/resolution stays out of core. */
function emitStyleImport(node: StyleImport, frame: Frame, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  put(e, node.forward ? '@-export ' : node.mode === 'compose' ? '@-compose ' : '@-import ');
  put(e, evalBytesSync(node.path, frame, e));
  if (node.namespace !== null) {
    put(e, ` as ${node.namespace}`);
  }
  put(e, ';\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

function emitModuleImport(node: ModuleImport, frame: Frame, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  if (node.mode === 'use') {
    put(e, '@-use ');
    put(e, evalBytesSync(node.path, frame, e));
    if (node.namespace !== null) {
      put(e, ` as ${node.namespace}`);
    }
    put(e, ';\n');
  } else {
    put(e, '@-from ');
    put(e, evalBytesSync(node.path, frame, e));
    put(e, ' import ');
    if (node.namespace !== null) {
      if (node.defaultImport !== null || node.imports.length !== 0) {
        throw new TypeError('ModuleImport namespace form cannot carry other bindings.');
      }
      put(e, `* as ${node.namespace}`);
    } else {
      if (node.defaultImport === null && node.imports.length === 0) {
        throw new TypeError('ModuleImport @-from requires bindings.');
      }
      if (node.defaultImport !== null) {
        put(e, node.defaultImport);
      }
      if (node.imports.length > 0) {
        if (node.defaultImport !== null) {
          put(e, ', ');
        }
        put(e, '(');
        node.imports.forEach((specifier, index) => {
          if (index > 0) {
            put(e, ', ');
          }
          put(e, specifier.name);
          if (specifier.alias !== null) {
            put(e, ` as ${specifier.alias}`);
          }
        });
        put(e, ')');
      }
    }
    put(e, ';\n');
  }
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/** Write a grammar-owned opaque at-rule body without evaluating or walking it. */
function emitOpaqueAtRuleBlock(node: OpaqueAtRuleBlock, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  put(e, node.name);
  if (node.prelude !== null && node.prelude.length > 0) {
    put(e, ' ');
    put(e, node.prelude);
  }
  put(e, ' {');
  put(e, node.rawBody);
  put(e, '}\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/**
 * [import:inline] Emit `@import (inline)` raw bytes verbatim: the target file's
 * exact text, unparsed and unindented, followed by a single newline separating it
 * from the next statement (mirrors Less's inline splice — an `Anonymous` value
 * printed as-is with a trailing rule separator).
 *
 * [import:inline-media] With a media postlude, the splice is wrapped in an
 * `@media <media> { … }` block: Less wraps the inline `Anonymous` in a media
 * ruleset, so the raw first line is indented one level and the block closes with a
 * `\n}` — reproducing the media-feature colon spacing (`(min-width:…)` →
 * `(min-width: …)`) Less's media parser reprints.
 */
function emitRawInline(node: RawInline, e: Emit): void {
  const start = e.off;
  if (node.media != null) {
    const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
    put(e, idt);
    put(e, '@media ');
    put(e, normalizeMediaFeatures(node.media));
    put(e, ' {\n');
    put(e, INDENT.repeat(e.depth + 1));
    put(e, node.text);
    put(e, '\n');
    put(e, idt);
    put(e, '}\n');
  } else {
    put(e, node.text);
    put(e, '\n');
  }
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/**
 * [import:inline-media] Reprint a media-query prelude's feature colons with
 * Less's `name: value` spacing (`(min-width:600px)` → `(min-width: 600px)`),
 * matching Less's media parser which re-emits each feature with a space after the
 * colon. Only the feature colon immediately inside a paren is touched; other text
 * (media types, `and`/`or`, values) is preserved verbatim.
 */
function normalizeMediaFeatures(prelude: string): string {
  return prelude.replace(/\(\s*([-\w]+)\s*:\s*/gu, '($1: ');
}

/**
 * A bare value-position call in statement position (e.g. `e('…');`): Less
 * evaluates it and prints the result bytes as a standalone line (an `Anonymous`
 * at document scope — no trailing `;`), so an `e(...)` unquote emits its inner
 * text. Emitted at the current indent; an empty result contributes nothing.
 */
function emitCallStatement(node: FunctionCall, frame: Frame, e: Emit, precomputed?: string): void {
  const start = e.off;
  // A typed color is a value, not a statement surface.  Keep the normal
  // byte-only fast path for ordinary/unknown calls, but retain this one fact
  // while evaluating a known call so `rgba(0,0,0,0);` fails like Less instead
  // of leaking a color token into the root output.
  if (precomputed === undefined && e.ev) {
    const value = evalValue(node, frame, e);
    if (!isThenable(value) && typeof value !== 'string' && value.type === 'Color') {
      throw ERR.invalidStatement({ node, meta: { what: 'Color' } });
    }
  }
  const bytes = precomputed ?? evalBytesSync(node, frame, e);
  if (bytes.length === 0) {
    return;
  }
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  put(e, bytes);
  put(e, '\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.off });
  }
}

/**
 * [atrule-bubbling] Conditional-group at-rules whose bodies participate in
 * selector nesting: when such an at-rule is bubbled OUT of a ruleset, the
 * enclosing composed selector PROPAGATES inside — direct declarations wrap in a
 * ruleset with that selector and nested rulesets compose against it. Every other
 * (directive) at-rule — `@font-face`, `@keyframes`, `@page`, `@counter-style`,
 * `@property`, `@viewport`, `@font-feature-values`, … — bubbles to the same
 * level but does NOT take a selector context (its declarations / keyframe
 * selectors stay bare). Matches Less's media/atrule bubbling.
 */
const BUBBLEABLE_ATRULES: ReadonlySet<string> = new Set([
  '@media',
  '@supports',
  '@document',
  '@-moz-document',
  '@container',
  '@layer',
  '@scope'
]);
function isBubbleable(name: string): boolean {
  return BUBBLEABLE_ATRULES.has(name.toLowerCase());
}

/**
 * [atrule-nested] Directive at-rules that BUBBLE out of a ruleset to the same
 * level WITHOUT taking a selector context (their declarations / keyframe
 * selectors stay bare). Distinct from the conditional-group family
 * ({@link BUBBLEABLE_ATRULES}) which projects the enclosing selector inside.
 */
const DIRECTIVE_ATRULES: ReadonlySet<string> = new Set([
  '@font-face',
  '@keyframes',
  '@-webkit-keyframes',
  '@-moz-keyframes',
  '@-o-keyframes',
  '@page',
  '@viewport',
  '@-ms-viewport',
  '@counter-style',
  '@property',
  '@font-feature-values',
  '@host',
  '@-x-document',
  '@namespace'
]);

/**
 * [atrule-nested] An at-rule that STAYS NESTED inside its parent ruleset (v5,
 * `collapseNesting:false` for this shape): `@starting-style` — whose direct
 * declarations belong to the enclosing selector's starting state and so cannot
 * hoist to root — and any UNKNOWN at-rule (e.g. `@apply`), which the serializer
 * cannot bubble without knowing its semantics. Every recognized conditional-group
 * ({@link BUBBLEABLE_ATRULES}) or directive ({@link DIRECTIVE_ATRULES}) at-rule
 * bubbles as before; this predicate only diverts the remaining names.
 */
function staysNested(name: string): boolean {
  const n = name.toLowerCase();
  if (n === '@starting-style') {
    return true;
  }
  return !BUBBLEABLE_ATRULES.has(n) && !DIRECTIVE_ATRULES.has(n);
}

/**
 * [atrule-supports] v5 NORMALIZES an `@supports` condition's prelude to the
 * compact single-line form, diverging from 4.x (which preserves source spacing).
 * Collapse whitespace runs (incl. authored newlines/indent) to a single space,
 * then strip the padding immediately inside each condition's parens:
 *   `( box-shadow: … ) or\n   ( -moz-box-shadow: … )`
 *     → `(box-shadow: …) or (-moz-box-shadow: …)`
 * `not (…)` / operator spacing is preserved (a space that is neither right after
 * `(` nor right before `)` stays). All other corpus `@supports` preludes are
 * already compact, so this is a no-op there.
 */
/** A prelude fragment whose grammar owns its bytes (not merely their values). */
type SupportsPreludePart = { bytes: string; protected: boolean };

function normalizeSupportsBytes(p: string): string {
  let out = '';
  let plainStart = 0;
  const appendPlain = (end: number): void => {
    out += p.slice(plainStart, end).replace(/\s+/gu, ' ').replace(/\(\s+/gu, '(').replace(/\s+\)/gu, ')');
  };
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '"' || c === '\'') {
      appendPlain(i);
      const quote = c;
      let end = i + 1;
      for (; end < p.length; end++) {
        if (p[end] === '\\') {
          end++;
          continue;
        }
        if (p[end] === quote) {
          end++;
          break;
        }
      }
      out += p.slice(i, end);
      plainStart = end;
      i = end - 1;
      continue;
    }
    if (c === '/' && p[i + 1] === '*') {
      appendPlain(i);
      const close = p.indexOf('*/', i + 2);
      const end = close < 0 ? p.length : close + 2;
      out += p.slice(i, end);
      plainStart = end;
      i = end - 1;
    }
  }
  appendPlain(p.length);
  return out;
}

function normalizeSupportsPrelude(parts: readonly SupportsPreludePart[]): string {
  let out = '';
  let plain = '';
  const flushPlain = (): void => {
    if (plain.length > 0) {
      out += normalizeSupportsBytes(plain);
    }
    plain = '';
  };
  for (const part of parts) {
    if (part.protected) {
      flushPlain();
      out += part.bytes;
    } else {
      plain += part.bytes;
    }
  }
  flushPlain();
  return out;
}

/**
 * `Block` is transparent when it encloses an evaluated ordinary value, but an
 * `@supports` condition owns parentheses as syntax: dropping them changes the
 * condition's grouping (and can make a feature cease to be a feature). Preserve
 * that grammar-owned structure here while evaluating only leaf values. This is
 * deliberately local to the supports prelude; ordinary declaration values keep
 * their existing evaluation semantics.
 */
function evalSupportsPreludeSync(node: ValueSlot, frame: Frame | null, e: EvalCtx): SupportsPreludePart[] {
  const plain = (bytes: string): SupportsPreludePart[] => [{ bytes, protected: false }];
  if (isValueSlotArray(node)) {
    const authored = valueLayoutOf(node);
    return node.flatMap((part, index) => [
      ...(index === 0 ? [] : plain(authored?.[index - 1] ?? ' ')),
      ...evalSupportsPreludeSync(part, frame, e)
    ]);
  }
  switch (node.type) {
    case 'GeneralEnclosed':
      // `<general-enclosed>` owns arbitrary CSS syntax. Its bytes must not pass
      // through the supports-condition whitespace canonicalizer below.
      return [{ bytes: generalEnclosedBytes(node, evalBytesSync(node.content, frame, e)), protected: true }];
    case 'Block': {
      const open = node.delimiter === 'square' ? '[' : '(';
      const close = node.delimiter === 'square' ? ']' : ')';
      return [...plain(open), ...evalSupportsPreludeSync(node.inner, frame, e), ...plain(close)];
    }
    case 'Operation': {
      const left = evalSupportsPreludeSync(node.left, frame, e);
      const right = evalSupportsPreludeSync(node.right, frame, e);
      return [...left, ...plain(node.operator === ':' ? ': ' : ` ${node.operator} `), ...right];
    }
    case 'SpacedValue':
      return node.parts.flatMap((part, index) => [
        ...(index === 0 ? [] : plain(' ')),
        ...evalSupportsPreludeSync(part, frame, e)
      ]);
    default:
      return plain(evalBytesSync(node, frame, e));
  }
}

/**
 * Media and container queries also own `Block` as grammar syntax. Unlike an
 * ordinary value position, evaluating a variable inside `(min-width: @size)`
 * must not erase the feature delimiters.  Keep that structural spelling while
 * delegating all leaf evaluation to the normal value path.
 */
function evalQueryPreludeSync(node: ValueSlot, frame: Frame | null, e: EvalCtx): string {
  if (isValueSlotArray(node)) {
    const authored = valueLayoutOf(node);
    let out = '';
    for (let index = 0; index < node.length; index += 1) {
      if (index > 0) {
        const separator = authored?.[index - 1];
        out += separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : ' ';
      }
      out += evalQueryPreludeSync(node[index]!, frame, e);
    }
    return out;
  }
  switch (node.type) {
    case 'Block': {
      const open = node.delimiter === 'square' ? '[' : '(';
      const close = node.delimiter === 'square' ? ']' : ')';
      return `${open}${evalQueryPreludeSync(node.inner, frame, e)}${close}`;
    }
    case 'Operation': {
      const left = evalQueryPreludeSync(node.left, frame, e);
      const right = evalQueryPreludeSync(node.right, frame, e);
      return node.operator === ':'
        ? `${left}: ${right}`
        : `${left} ${node.operator} ${right}`;
    }
    case 'SpacedValue':
      return node.parts.map(part => evalQueryPreludeSync(part, frame, e)).join(' ');
    case 'List':
      const glue = node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ';
      const authored = valueLayoutOf(node);
      let out = '';
      for (let index = 0; index < node.value.length; index += 1) {
        if (index > 0) {
          const separator = authored?.[index - 1];
          out += separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : glue;
        }
        out += evalQueryPreludeSync(node.value[index]!, frame, e);
      }
      return out;
    default:
      return evalBytesSync(node, frame, e);
  }
}

/**
 * [atrule-prelude] v5 normalizes a `@media` / `@container` query prelude's
 * SPACING (a serialization concern — evaluating a `@var` / operation / escaped
 * string in a prelude is a SEPARATE, not-yet-wired capability, so those pass
 * through as-is). On the PLAIN (non-opaque) runs:
 *   - a feature colon gets `name: value` spacing (`(orientation:portrait)` →
 *     `(orientation: portrait)`);
 *   - a `<` / `>` / `<=` / `>=` range comparison and a `/` ratio operator get
 *     single surrounding spaces (`(width<500px)` → `(width < 500px)`,
 *     `(aspect-ratio: 3/2)` → `(aspect-ratio: 3 / 2)`) — v5 operators/separators
 *     emit spaced;
 *   - padding immediately inside a condition paren is stripped (`( width< 500px )`
 *     → `(width < 500px)`);
 *   - a logical `and` / `or` / `not` keeps a space before its `(` (`and(…)` →
 *     `and (…)`).
 * Quoted runs (`"…"`, `'…'`, `~"…"`, `~'…'`) and `/* … *\/` comments are OPAQUE:
 * their bytes pass through untouched, so an escaped `~"2/1"` is never mistaken for
 * a ratio operator and a `/* … *\/` keyword comment survives verbatim. Every
 * transform is idempotent on an already-canonical prelude (`(min-width: 1024px)`,
 * `screen, print, handheld`, `(a) or (b)`), so already-matching goldens are
 * unaffected.
 */
function normalizeQueryPrelude(p: string): string {
  let out = '';
  let i = 0;
  const n = p.length;
  while (i < n) {
    const c = p[i]!;
    // OPAQUE — a `/* … */` comment: copy through verbatim.
    if (c === '/' && p[i + 1] === '*') {
      const end = p.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += p.slice(i, stop);
      i = stop;
      continue;
    }
    // OPAQUE — a quoted string, optionally escaped (`~"…"` / `~'…'`).
    const esc = c === '~' && (p[i + 1] === '"' || p[i + 1] === '\'');
    if (c === '"' || c === '\'' || esc) {
      const q = esc ? p[i + 1]! : c;
      let j = esc ? i + 2 : i + 1;
      while (j < n && p[j] !== q) {
        j++;
      }
      const stop = j < n ? j + 1 : n;
      // Less UNQUOTES an escaped string `~"…"` / `~'…'`: emit its inner bytes VERBATIM
      // (its `@{…}` interpolation is already resolved upstream at eval), dropping the
      // `~` + quotes. The inner run stays OPAQUE to the plain-run spacing rules, so a
      // ratio like `~"2/1"` prints tight (`2/1`), NOT ` / `-spaced. A plain (un-escaped)
      // quoted string keeps its quotes and passes through verbatim.
      out += esc ? p.slice(i + 2, j) : p.slice(i, stop);
      i = stop;
      continue;
    }
    // PLAIN run — up to the next opaque start; normalize its spacing.
    let j = i;
    while (j < n) {
      const d = p[j]!;
      if (d === '"' || d === '\'') {
        break;
      }
      if (d === '~' && (p[j + 1] === '"' || p[j + 1] === '\'')) {
        break;
      }
      if (d === '/' && p[j + 1] === '*') {
        break;
      }
      j++;
    }
    out += normalizeQueryPlainRun(p.slice(i, j));
    i = j;
  }
  return out;
}

/** [atrule-prelude] Spacing normalization of ONE plain (non-quote/comment) run of
 * a query prelude. See {@link normalizeQueryPrelude} for the rules; each `replace`
 * is idempotent on canonical input. */
function normalizeQueryPlainRun(s: string): string {
  return s
    .replace(/\(\s+/gu, '(') // strip padding right after `(`
    .replace(/\s+\)/gu, ')') // strip padding right before `)`
    .replace(/\s*:\s*/gu, ': ') // feature colon → `name: value`
    .replace(/\s*\/\s*/gu, ' / ') // ratio `/` → spaced (v5 operators spaced)
    .replace(/\s*(<=|>=|<|>)\s*/gu, ' $1 ') // range comparison → spaced
    .replace(/\b(and|or|not)\s*\(/gu, '$1 ('); // `and(` → `and (`
}

/**
 * A block at-rule: `@name prelude { …body }`, emitted at the current block depth.
 *
 * [atrule-bubbling] `ctx` is the enclosing composed selector context this at-rule
 * bubbled out of (null / empty at document root or directly inside another
 * at-rule). For a bubbleable (conditional-group) at-rule the body PROJECTS that
 * context inside (see `emitBubbleBody`); for a directive at-rule the body is a
 * plain declaration/keyframe block (`emitAtRuleBody`) and `ctx` is ignored. An
 * at-rule whose body renders empty is dropped entirely (header + braces).
 */
function emitAtRuleBlock(node: AtRuleBlock, frame: Frame, e: Emit, ctx: string[] | null = null): MaybePromise<void> {
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) {
    put(e, idt);
  }
  put(e, node.name);
  if (node.prelude !== null) {
    const lname = node.name.toLowerCase();
    let p = lname === '@supports'
      ? normalizeSupportsPrelude(evalSupportsPreludeSync(node.prelude, frame, e))
      : lname === '@media' || lname === '@container'
        ? evalQueryPreludeSync(node.prelude, frame, e)
        : evalBytesSync(node.prelude, frame, e);
    if (lname === '@media' || lname === '@container') {
      p = normalizeQueryPrelude(p);
    }
    if (p.length > 0) {
      put(e, ' ');
      put(e, p);
    }
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const bodyFrame: Frame = {
    parent: frame,
    mixins: collectMixins(node.body),
    declIndex: collectDeclIndex(node.body), cells: null, reassign: null,
    statements: node.body
  };
  const emitted = prepareBodyPlugins(node.body, bodyFrame, e);
  const finish = (): MaybePromise<void> => {
    if (e.chunks.length === afterHeader) {
    // Nothing emitted: drop the whole at-rule (rewind chunks/offset/positions).
      e.chunks.length = markChunks;
      e.off = markOff;
      if (e.positions) {
        e.positions.length = markPos;
      }
      return;
    }
    if (idt) {
      put(e, idt);
    }
    put(e, '}\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
  };
  return mapMaybe(emitted, () => {
    const rendered = isBubbleable(node.name)
      // A non-empty selector context propagates inside; null/empty keeps the
      // top-level shape (bare direct decls) but still bubbles nested at-rules out
      // of the body's rulesets.
      ? emitBubbleBody(node.body, ctx && ctx.length > 0 ? ctx : null, bodyFrame, e)
      : (emitAtRuleBody(node.body, bodyFrame, e), undefined);
    return mapMaybe(rendered, finish);
  });
}

/**
 * Emit an at-rule body. Consecutive declarations/comments group as DIRECT block
 * children (no selector wrapper). A nested ruleset / at-rule descends one level.
 */
function emitAtRuleBody(
  statements: Statement[],
  frame: Frame,
  e: Emit
): void {
  const group: Leaf[] = [];
  const flushDirect = (): void => {
    if (group.length > 0) {
      if (groupHasMerge(group)) {
        mergeFold(group, e, INDENT.repeat(e.depth + 1));
      } else {
        for (const leaf of group) {
          emitLeaf(leaf, e);
        }
      }
      group.length = 0;
    }
  };
  for (const node of statements) {
    switch (node.type) {
      case 'Declaration':
      case 'Comment':
      case 'FunctionCall':
        group.push({ node, frame });
        break;
      case 'Rule':
        flushDirect();
        e.depth++;
        flatten(node, null, null, frame, e);
        e.depth--;
        break;
      case 'AtRuleBlock':
        flushDirect();
        e.depth++;
        emitAtRuleBlock(node, frame, e);
        e.depth--;
        break;
      case 'AtRuleStatement':
        flushDirect();
        e.depth++;
        emitAtRuleStatement(node, frame, e);
        e.depth--;
        break;
      case 'Plugin':
        break;
      case 'ImportAtRule':
        flushDirect();
        e.depth++;
        emitImportAtRule(node, frame, e, e.importDocument);
        e.depth--;
        break;
      case 'StyleImport':
        flushDirect();
        e.depth++;
        emitStyleImport(node, frame, e);
        e.depth--;
        break;
      case 'ModuleImport':
        flushDirect();
        e.depth++;
        emitModuleImport(node, frame, e);
        e.depth--;
        break;
      case 'OpaqueAtRuleBlock':
        flushDirect();
        e.depth++;
        emitOpaqueAtRuleBlock(node, e);
        e.depth--;
        break;
      case 'MixinCall':
        // Best-effort: expand into the direct-declaration group.
        expandCall(node, null, null, frame, group, flushDirect, null, e);
        break;
      case 'Apply':
        expandApply(node, null, null, frame, group, flushDirect, null, e);
        break;
      case 'Reference':
        expandReferenceCall(node, null, null, frame, group, flushDirect, null, e);
        break;
      case 'For':
        expandFor(node, null, null, frame, group, flushDirect, null, e);
        break;
      case 'If': {
        const body = selectIfBodyForRender(node, frame, e);
        if (body) {
          emitAtRuleBody(body, frame, e);
        }
        break;
      }
      // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
      case 'RawInline':
        flushDirect();
        emitRawInline(node, e);
        break;
      case 'MixinDef':
        publishSelectedMixinDefinition(frame, node);
        break;
      case 'VariableDeclaration':
        activateVariableDeclaration(node, frame, e);
        break;
    }
  }
  flushDirect();
}

/**
 * [atrule-bubbling] Emit a bubbleable (conditional-group) at-rule body, PROJECTING
 * the enclosing selector context `ctx` inside per the spine-is-projection
 * principle (no tree mutation):
 *   - `ctx !== null`  — the at-rule bubbled out of a ruleset: consecutive direct
 *     declarations wrap in a `ctx { … }` block, and a nested ruleset composes
 *     against `ctx` (so `.b &` under `.a` → `.b .a`). Everything sits one block
 *     level in from the at-rule header.
 *   - `ctx === null`  — a top-level (or directly at-rule-nested) bubbleable
 *     at-rule: direct declarations stay bare and nested rulesets keep their own
 *     selectors — byte-identical to `emitAtRuleBody`.
 * In BOTH cases a further-nested at-rule bubbles: one inside a nested ruleset
 * carries that ruleset's composed selector as its context (via `walkBody`); one
 * directly inside this body inherits `ctx` unchanged.
 */
function emitBubbleBody(
  statements: Statement[],
  ctx: string[] | null,
  frame: Frame,
  e: Emit
): MaybePromise<void> {
  // [nesting] opaque ancestor for `&`-less rules composed inside the bubbled context.
  const ctxAncestor = ctx === null ? null : wrapIsList(ctx);
  const group: Leaf[] = [];
  // Less hoists direct declarations in a bubbled conditional block ahead of
  // nested rules, even when those declarations occur after a child rule in
  // authored order (`.a { @media/@container { .b { … } color: blue; } }`).
  // Keep this narrow: only a static declaration/comment/rule/at-rule body can
  // be safely staged without executing dynamic mixin/loop/import expansion
  // twice or changing live-binding activation order. Dynamic bodies retain the
  // existing streaming path below.
  const deferStaticChildren = ctx !== null && statements.every(statement =>
    statement.type === 'Declaration'
    || statement.type === 'Comment'
    || statement.type === 'Rule'
    || statement.type === 'AtRuleBlock'
    || statement.type === 'AtRuleStatement'
  );
  const deferredChildren: Array<() => MaybePromise<void>> | null = deferStaticChildren ? [] : null;
  const flushDirect = (): void => {
    if (group.length === 0) {
      return;
    }
    if (ctx !== null) {
      // Wrap the direct declarations in the propagated selector context.
      e.depth++;
      flushBlock(ctx, group, e);
      e.depth--;
    } else if (groupHasMerge(group)) {
      mergeFold(group, e, INDENT.repeat(e.depth + 1));
    } else {
      for (const leaf of group) {
        emitLeaf(leaf, e);
      }
    }
    group.length = 0;
  };

  // Keep one direct-leaf group and one cursor for the whole body.  In
  // particular, an async import resumes this exact group/body placement rather
  // than closing over a per-statement callback or re-walking a sliced tail.
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;
      switch (node.type) {
        case 'Declaration':
        case 'Comment':
        case 'FunctionCall':
          group.push({ node, frame });
          break;
        case 'Rule':
          if (deferStaticChildren) {
            deferredChildren!.push(() => {
              e.depth++;
              const emitted = flatten(node, ctx, ctxAncestor, frame, e);
              if (isThenable(emitted)) {
                return emitted.then(() => {
                  e.depth--;
                }, (error) => {
                  e.depth--;
                  throw error;
                });
              }
              e.depth--;
            });
          } else {
            flushDirect();
            e.depth++;
            {
              const emitted = flatten(node, ctx, ctxAncestor, frame, e);
              if (isThenable(emitted)) {
                return emitted.then(
                  () => {
                    e.depth--;
                    return run(index + 1);
                  },
                  (error) => {
                    e.depth--;
                    throw error;
                  }
                );
              }
            }
            e.depth--;
          }
          break;
        case 'AtRuleBlock':
          if (deferStaticChildren) {
            deferredChildren!.push(() => {
              e.depth++;
              const nested = emitAtRuleBlock(node, frame, e, ctx);
              if (isThenable(nested)) {
                return nested.then(() => {
                  e.depth--;
                }, (error) => {
                  e.depth--;
                  throw error;
                });
              }
              e.depth--;
            });
          } else {
            flushDirect();
            e.depth++;
            const nested = emitAtRuleBlock(node, frame, e, ctx); // directly-nested at-rule inherits ctx
            if (isThenable(nested)) {
              return nested.then(
                () => {
                  e.depth--;
                  return run(index + 1);
                },
                (error) => {
                  e.depth--;
                  throw error;
                }
              );
            }
            e.depth--;
          }
          break;
        case 'AtRuleStatement':
          if (deferStaticChildren) {
            deferredChildren!.push(() => {
              e.depth++;
              emitAtRuleStatement(node, frame, e);
              e.depth--;
            });
          } else {
            flushDirect();
            e.depth++;
            emitAtRuleStatement(node, frame, e);
            e.depth--;
          }
          break;
        case 'ImportAtRule':
          flushDirect();
          e.depth++;
          const imported = emitImportAtRule(
            node,
            frame,
            e,
            e.importDocument,
            (document, importFrame) => {
            // The surrounding import owns the one statement indentation level.
            // Its loaded body belongs to this bubble body's level instead, just
            // like an authored sibling; restore the import level before the
            // cursor resumes after an async load.
            // `emitBubbleBody` increments before a Rule while the former
            // document dispatcher emitted loaded root Rules directly.  Drop
            // the import level and that one prospective Rule level so the
            // canonical loaded document keeps its historical body placement.
              e.depth -= 2;
              const emitted = emitBubbleBody(document.children, ctx, importFrame, e);
              if (isThenable(emitted)) {
                return emitted.then(
                  () => {
                    e.depth += 2;
                  },
                  (error) => {
                    e.depth += 2;
                    throw error;
                  }
                );
              }
              e.depth += 2;
              return emitted;
            }
          );
          if (isThenable(imported)) {
            return imported.then(
              () => {
                e.depth--;
                return run(index + 1);
              },
              (error) => {
                e.depth--;
                throw error;
              }
            );
          }
          e.depth--;
          break;
        case 'StyleImport':
          flushDirect();
          e.depth++;
          emitStyleImport(node, frame, e);
          e.depth--;
          break;
        case 'ModuleImport':
          flushDirect();
          e.depth++;
          emitModuleImport(node, frame, e);
          e.depth--;
          break;
        case 'OpaqueAtRuleBlock':
          flushDirect();
          e.depth++;
          emitOpaqueAtRuleBlock(node, e);
          e.depth--;
          break;
        case 'MixinCall':
          {
            const expanded = expandCall(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'Apply':
          {
            const expanded = expandApply(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'Reference':
          {
            const expanded = expandReferenceCall(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'For': {
          const expanded = expandFor(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
          if (isThenable(expanded)) {
            return expanded.then(() => run(index + 1));
          }
          break;
        }
        case 'If': {
          const body = selectIfBodyForRender(node, frame, e);
          if (body) {
            const emitted = emitBubbleBody(body, ctx, frame, e);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'MixinDef':
          publishSelectedMixinDefinition(frame, node);
          break;
        case 'VariableDeclaration':
          activateVariableDeclaration(node, frame, e);
          break;
      }
    }
    flushDirect();
    if (deferredChildren === null) {
      return;
    }
    const runDeferred = (childIndex: number): MaybePromise<void> => {
      for (let i = childIndex; i < deferredChildren.length; i++) {
        const emitted = deferredChildren[i]!();
        if (isThenable(emitted)) {
          return emitted.then(() => runDeferred(i + 1));
        }
      }
    };
    return runDeferred(0);
  };
  return run(0);
}

/* ------------------------------------------------------ [nested/R0] emit */

/**
 * Nested-output emit (Less v5 default, `collapseNesting:false`).
 *
 * Convention: when a `*Nested*` emitter runs, `e.depth` is the indentation
 * LEVEL of the statements it emits — a direct declaration, a child-rule header,
 * or a nested at-rule header all sit at `INDENT.repeat(e.depth)`. Entering a
 * rule/at-rule body raises the level by one for the body's contents.
 *
 * Unlike the flattened path, selectors are NEVER composed with the parent: each
 * rule emits its own local selector text verbatim (so `&:hover`, `> .b`,
 * `.b &`, and `.b, .c` all stay literal), and a placed mixin body splices its
 * statements inline at the call-site level (its own nested rules therefore nest
 * under the call site, keeping their own local selectors).
 */
interface NestedLeafBuffer {
  readonly leaves: Leaf[];
  readonly flush: () => void;
}

function emitNestedBody(
  statements: Statement[],
  frame: Frame,
  e: Emit,
  hoist?: { rule: Rule; frame: Frame }[],
  imp = false, // [important] call-level `!important` forced onto this body's decls
  source: NestedHeaderSource | null = null,
  placement: NestedRuleMixinPlacement | null = null,
  sharedLeaves?: NestedLeafBuffer,
  applyExpansion = false
): MaybePromise<void> {
  // buffer consecutive DIRECT leaves so a `+`/`+_` merge group can fold at
  // last-occurrence; flush when an interrupting nested rule/at-rule appears (a
  // merge group does not span an interrupting nested block). Absent any merge the
  // buffer flushes verbatim per-leaf (byte-identical to the prior stream).
  const buf = sharedLeaves?.leaves ?? [];
  const flushBuf = sharedLeaves?.flush ?? (() => {
    if (buf.length === 0) {
      return;
    }
    if (groupHasMerge(buf)) {
      mergeFold(buf, e, e.depth > 0 ? INDENT.repeat(e.depth) : '', emitNestedLeaf);
    } else {
      for (const leaf of buf) {
        emitNestedLeaf(leaf, e);
      }
    }
    buf.length = 0;
  });
  const inlineLeaves: NestedLeafBuffer = sharedLeaves ?? { leaves: buf, flush: flushBuf };
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;
      // Root sibling grouping is source-adjacent only. Any non-Rule—including a
      // silent declaration/definition—forms a hard boundary.
      if (frame.parent === null && node.type !== 'Rule') {
        e.lastBlock.parentKey = null;
      }
      switch (node.type) {
        case 'Declaration':
        case 'Comment':
          if (e.referenceImportDepth > 0) {
            break;
          }
          buf.push({ node, frame, ...(imp ? { important: true } : {}), ...(applyExpansion ? { fromApply: true } : {}) });
          break;
        case 'Rule': {
          if (e.referenceImportDepth > 0) {
            break;
          }
          flushBuf();
          // [extend] a rule whose extend match crosses the `&` FLATTENS: defer it to
          // the enclosing rule's hoist queue (emitted flat at that rule's depth).
          if (hoist && extendProjection(frame, e)?.nestedPlan.get(node)?.flatten) {
            hoist.push({ rule: node, frame });
            break;
          }
          // Only a selected synthesized ruleset mixin gets a placement fact.  It
          // is consumed by the first `&`-bearing nested header; ordinary authored
          // nesting has no fact and stays literal in collapse:false mode.
          const appliesPlacement = placement !== null && selectorListHasAmpersand(node.selector);
          const emitted = emitNestedRule(node, frame, e, imp, source, appliesPlacement ? placement : null);
          if (isThenable(emitted)) {
            return emitted.then(() => {
              if (appliesPlacement) {
                placement = null;
              }
              return run(index + 1);
            });
          }
          if (appliesPlacement) {
            placement = null;
          }
          break;
        }
        case 'MixinCall':
          {
            const emitted = expandNestedCall(node, frame, e, imp, source, inlineLeaves, applyExpansion);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        case 'Apply':
          {
            const emitted = expandNestedApply(node, frame, e, imp, source, inlineLeaves);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        case 'Reference':
          {
            const emitted = expandNestedReferenceCall(node, frame, e, imp, source, inlineLeaves, applyExpansion);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        case 'For':
          {
            const emitted = expandNestedFor(node, frame, e, imp, source, inlineLeaves, applyExpansion);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        case 'If': {
          flushBuf();
          const body = selectIfBodyForRender(node, frame, e);
          if (body) {
            const emitted = emitNestedBody(body, frame, e, hoist, imp, source, placement, undefined, applyExpansion);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'AtRuleBlock':
          flushBuf();
          {
            const emitted = emitNestedAtRuleBlock(node, frame, e, source);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        case 'AtRuleStatement':
          flushBuf();
          emitAtRuleStatement(node, frame, e);
          break;
        case 'ImportAtRule':
          flushBuf();
          {
            const imported = emitImportAtRule(
              node,
              frame,
              e,
              e.importDocument,
              (document, importFrame) => emitNestedBody(document.children, importFrame, e, hoist, imp)
            );
            if (isThenable(imported)) {
              return imported.then(() => run(index + 1));
            }
          }
          break;
        case 'StyleImport':
          flushBuf();
          emitStyleImport(node, frame, e);
          break;
        case 'ModuleImport':
          flushBuf();
          emitModuleImport(node, frame, e);
          break;
        case 'OpaqueAtRuleBlock':
          flushBuf();
          emitOpaqueAtRuleBlock(node, e);
          break;
          // [import:inline] raw verbatim bytes spliced by `@import (inline)`.
        case 'RawInline':
          flushBuf();
          emitRawInline(node, e);
          break;
          // a bare value-position call statement (`e('/* … */');`): evaluate + emit.
        case 'FunctionCall':
          flushBuf();
          emitCallStatement(node, frame, e);
          break;
        case 'MixinDef':
          publishSelectedMixinDefinition(frame, node);
          break;
        case 'VariableDeclaration':
          activateVariableDeclaration(node, frame, e);
          break;
      }
    }
    if (!sharedLeaves) {
      flushBuf();
    }
  };
  return run(0);
}

/** A `name: value;` / comment leaf at exactly the current `e.depth` level. */
function emitNestedLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (node.type === 'Declaration') {
    assertDeclarationValueIsNotRuleset(node, frame, e);
    if (idt) {
      put(e, idt);
    }
    put(e, declName(node, frame, e)); // resolve interpolated property name
    const onNewLine = node.valueOnNewLine === true;
    put(e, onNewLine ? ':' : ': ');
    const valStart = e.off;
    const important = node.important === true || leaf.important === true;
    putValue(e, node.value, frame, isValueSlotArray(node.value) ? undefined : node.value, idt + INDENT, important, onNewLine); // [whitespace] continuation indent
    if (e.positions) {
      if (!isValueSlotArray(node.value)) {
        e.positions.push({ node: node.value, type: node.value.type, start: valStart, end: e.off });
      }
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
    put(e, ';\n');
  } else if (node.type === 'Comment') {
    if (idt) {
      put(e, idt);
    }
    put(e, node.text);
    put(e, '\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
  }
}

/**
 * Emit one rule with its authored nesting preserved. The header is the rule's
 * OWN selector list (never composed with the parent); the body is emitted one
 * level deeper. A rule whose body produces no output (empty, definition-only, or
 * only-nested-rules-that-themselves-drop) is dropped entirely — header and
 * braces rewound — matching v5.
 */
function nestedSourceStrings(source: NestedHeaderSource, e: EvalCtx): string[] {
  const parents = source.parent === null
    ? ownStringsSync(source.selector, source.frame, e)
    : composeSync(nestedSourceStrings(source.parent, e), source.selector, source.frame, e);
  return parents;
}

interface TransparentShell {
  readonly rule: Rule;
  readonly call: MixinCall;
  readonly def: MixinDef;
  readonly bindings: Map<string, CallValue> | null;
  readonly home: Frame;
}

/**
 * A deliberately narrow Less compatibility projection.  It admits only the
 * `mi-test-c` shape: a parent containing immediate `&` shells, each shell
 * containing exactly one call whose sole selected target is a synthesized
 * ruleset-mixin.  Anything less exact remains authored nested output.
 */
function transparentShells(rule: Rule, frame: Frame, e: Emit): TransparentShell[] | null {
  if (rule.body.length === 0) {
    return null;
  }
  const shells: TransparentShell[] = [];
  for (const child of rule.body) {
    if (child.type !== 'Rule' || !selectorListHasAmpersand(child.selector) || child.body.length !== 1) {
      return null;
    }
    const call = child.body[0];
    if (call?.type !== 'MixinCall') {
      return null;
    }
    const shellFrame: Frame = {
      parent: frame,
      mixins: collectMixins(child.body),
      declIndex: collectDeclIndex(child.body), cells: null, reassign: null,
      statements: child.body
    };
    const homes = new Map<MixinDef, Frame>();
    const candidates = call.path.length > 0
      ? findPathCandidates(shellFrame, call, e, homes)
      : lookupCandidates(shellFrame, call.name, e, homes);
    const selected = dispatch(candidates, call, shellFrame, e, homes);
    if (selected.length !== 1 || selected[0]!.def.ruleMixin !== true) {
      return null;
    }
    const selectedOne = selected[0]!;
    shells.push({ rule: child, call, def: selectedOne.def, bindings: selectedOne.bindings, home: homes.get(selectedOne.def) ?? shellFrame });
  }
  return shells;
}

function emitTransparentShells(
  shells: readonly TransparentShell[],
  parentSource: NestedHeaderSource | null,
  frame: Frame,
  e: Emit,
  imp: boolean
): MaybePromise<void> {
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < shells.length; index++) {
      const shell = shells[index]!;
      const callFrame: Frame = {
        parent: shell.home,
        mixins: collectMixins(shell.def.body),
        declIndex: collectDeclIndex(shell.def.body, shell.bindings), cells: cellsForParams(shell.bindings), reassign: null,
        statements: shell.def.body,
        sourceOwner: sourceOwnerForBody(shell.def.body, frame, e)
      };
      captureArgDefFrames(shell.bindings, frame, callFrame, e);
      const source: NestedHeaderSource = { parent: parentSource, selector: shell.rule.selector, frame };
      const header = nestedSourceStrings(source, e);
      const markChunks = e.chunks.length;
      const markOff = e.off;
      const markPos = e.positions ? e.positions.length : 0;
      const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
      if (idt) {
        put(e, idt);
      }
      put(e, idt ? header.join(',\n' + idt) : header.join(',\n'));
      put(e, ' {\n');
      const afterHeader = e.chunks.length;
      e.depth++;
      const finish = (): void => {
        e.depth--;
        if (e.chunks.length === afterHeader) {
          e.chunks.length = markChunks;
          e.off = markOff;
          if (e.positions) {
            e.positions.length = markPos;
          }
        } else {
          if (idt) {
            put(e, idt);
          }
          put(e, '}\n');
        }
      };
      const emitted = emitNestedBody(shell.def.body, callFrame, e, undefined, imp, source);
      if (isThenable(emitted)) {
        return emitted.then(() => {
          finish();
          return run(index + 1);
        });
      }
      finish();
    }
  };
  return run(0);
}

function emitNestedRule(
  rule: Rule,
  frame: Frame,
  e: Emit,
  imp = false,
  source: NestedHeaderSource | null = null,
  placement: NestedRuleMixinPlacement | null = null
): MaybePromise<void> {
  // [guards] a guarded ruleset emits its block only when the guard is true (the
  // flattened path applies the same gate in `flatten`).
  if (!ruleGuardPasses(rule, frame, e)) {
    return;
  }
  if (!e.collapse) {
    const shells = transparentShells(rule, frame, e);
    if (shells !== null) {
      return emitTransparentShells(
        shells,
        { parent: source, selector: rule.selector, frame },
        frame,
        e,
        imp
      );
    }
  }
  const plan = extendProjection(frame, e)?.nestedPlan.get(rule);
  if (plan?.collapseTransparent) {
    // [extend] decl-less `&&` self-collapse: emit the body (the pure-`&` child,
    // which carries its composed header via its own plan) at THIS level, dropping
    // this rule's wrapper.
    const childFrame: Frame = {
      parent: frame,
      mixins: collectMixins(rule.body),
      declIndex: collectDeclIndex(rule.body), cells: null, reassign: null
    };
    return emitNestedBody(rule.body, childFrame, e, undefined, imp, source, placement);
  }
  if (plan?.flatten && !plan.hoistNested) {
    // Fallback (a top-level rule never flattens; a body-nested one is deferred by
    // emitNestedBody's hoist queue). Emit via the flat path with compaction.
    return emitHoisted(rule, frame, e);
  }
  // A `hoistNested` rule falls through: it is emitted NESTED here (at the hoist
  // position), its `plan.header` already carrying the composed cross-`&` sibling
  // list; children stay literal-nested.
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  // [extend] nested header uses the projected own-local branch list; children
  // stay literal (nested mode composes nothing).
  // `placement` only originates at a selected synthesized ruleset mixin.  Its
  // header is composed structurally from the original selector nodes and their
  // render frames; it does not rewrite selector strings or re-render a body.
  const own = plan
    ? plan.header
    : placement === null
      ? ownStringsSync(rule.selector, frame, e)
      : composeSync(nestedSourceStrings(placement.source, e), rule.selector, placement.callFrame, e);
  const header = idt ? own.join(',\n' + idt) : own.join(',\n');
  // Less only coalesces this nested-output root seam after an authored header
  // has been evaluated. Static same-selector root rules remain distinct.
  const rootSibling = frame.parent === null && e.depth === 0
    && rule.selector.selectors.some(complexHasInterp);
  const lb = e.lastBlock;
  const reopen = rootSibling && lb.parentKey === frame && lb.depth === e.depth
    && lb.header === header && lb.endChunks === e.chunks.length;
  if (reopen) {
    popClose(e, idt);
  } else {
    if (idt) {
      put(e, idt);
    }
    const selStart = e.off;
    put(e, header);
    if (e.positions) {
      e.positions.push({ node: rule.selector, type: rule.selector.type, start: selStart, end: e.off });
    }
    put(e, ' {\n');
  }
  const afterHeader = e.chunks.length;
  const childFrame: Frame = {
    parent: frame,
    mixins: collectMixins(rule.body),
    declIndex: collectDeclIndex(rule.body), cells: null, reassign: null,
    statements: rule.body
  };
  const childSource: NestedHeaderSource = { parent: source, selector: rule.selector, frame };
  // Nested output owns the same lexical placement facts as flattened output:
  // a later namespace call must enter this exact child frame to see imports that
  // executed inside the Rule.
  (frame.rulePlacements ??= new Map()).set(rule, childFrame);
  // [extend] children that flatten (extend crossed the `&`) bubble out to this
  // rule's depth; collect them and emit flat after the block closes.
  const hoist: { rule: Rule; frame: Frame }[] = [];
  e.depth++;
  const finish = (): MaybePromise<void> => {
    e.depth--;
    if (e.chunks.length === afterHeader) {
    // Nothing emitted in the block: drop the header/braces (rewind).
      e.chunks.length = markChunks;
      e.off = markOff;
      if (e.positions) {
        e.positions.length = markPos;
      }
    } else {
      if (idt) {
        put(e, idt);
      }
      put(e, '}\n');
      if (e.positions) {
        e.positions.push({ node: rule, type: rule.type, start, end: e.off });
      }
      if (rootSibling) {
        lb.parentKey = frame;
        lb.header = header;
        lb.depth = e.depth;
        lb.endChunks = e.chunks.length;
      }
    }
    // [extend] split-out exact extenders (target has surviving nested children):
    // sibling rules carrying only the target's DIRECT declarations (empty → drop).
    if (plan && plan.splits.length > 0) {
      const direct: Leaf[] = [];
      for (const st of rule.body) {
        if (st.type === 'Declaration' || st.type === 'Comment') {
          direct.push({ node: st, frame: childFrame });
        }
      }
      if (direct.length > 0) {
        for (const header of plan.splits) {
          flushBlock(header, direct, e);
        }
      }
    }
    // [extend] hoisted (flattened) children at this rule's depth: a `renest` child
    // emits NESTED (composed cross-`&` header, children literal); a `collapse` child
    // emits FLAT.
    const runHoist = (index: number): MaybePromise<void> => {
      for (let hoistIndex = index; hoistIndex < hoist.length; hoistIndex++) {
        const h = hoist[hoistIndex]!;
        const emitted = extendProjection(h.frame, e)?.nestedPlan.get(h.rule)?.hoistNested
          ? emitNestedRule(h.rule, h.frame, e, imp)
          : emitHoisted(h.rule, h.frame, e);
        if (isThenable(emitted)) {
          return emitted.then(() => runHoist(hoistIndex + 1));
        }
      }
    };
    return runHoist(0);
  };
  return mapMaybe(emitNestedBody(rule.body, childFrame, e, hoist, imp, childSource), finish);
}

/** Emit a flattened rule (and its descendants) via the flat path at `e.depth`,
 * using the nested-mode hoist header (flat composition + `:is()`-compaction). */
function emitHoisted(rule: Rule, frame: Frame, e: Emit): MaybePromise<void> {
  const prev = e.hoistMode;
  e.hoistMode = true;
  const emitted = flatten(rule, null, null, frame, e);
  if (isThenable(emitted)) {
    return emitted.then(
      () => {
        e.hoistMode = prev;
      },
      (error) => {
        e.hoistMode = prev;
        throw error;
      }
    );
  }
  e.hoistMode = prev;
  return emitted;
}

/**
 * Expand a mixin call in nested mode: select the matching overloaded
 * definitions, then SPLICE each shared body inline at the current level — the
 * body's declarations join the call-site block and its nested rules nest under
 * the call site (own selectors). No clone, no per-placement node build.
 */
function expandNestedCall(
  call: MixinCall,
  frame: Frame,
  e: Emit,
  imp = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer,
  applyExpansion = false
): MaybePromise<void> {
  // Candidate resolution mirrors the flat-path {@link expandCall}: a bare `.m()`
  // walks the scope chain accumulating same-name overloads (explicit `MixinDef`s
  // AND paren-less rulesets callable as zero-arg mixins), a namespaced/compound
  // call descends by element value; both record each candidate's DEFINITION frame
  // in `homes` so the body + guards resolve free variables in the mixin's CLOSURE
  // scope, not the call site (`mixins-closure`).
  const namespaced = call.path.length > 0;
  const homes = new Map<MixinDef, Frame>();
  const rawCandidates = namespaced
    ? findPathCandidates(frame, call, e, homes)
    : lookupCandidates(frame, call.name, e, homes);
  // [parent-exclusion] a paren-less ruleset-mixin does not re-enter its own body
  // while it is on the active expansion stack (see `expandCall`).
  const candidates = rawCandidates.some(d => d.ruleMixin === true)
    ? rawCandidates.filter(d => d.ruleMixin !== true || !parentExcludes(frame, d.body))
    : rawCandidates;
  if (rawCandidates.length === 0) {
    unresolvedMixinCall(call, e);
  }
  if (candidates.length === 0) {
    return;
  }
  const selected = dispatch(candidates, call, frame, e, homes);
  if (selected.length === 0) {
    return;
  }
  const bodyImp = imp || call.important; // [important] propagate call-level `!important`
  if (e.mixinDepth >= MAX_MIXIN_DEPTH) {
    throw new RangeError('maximum mixin recursion depth exceeded');
  }
  e.mixinDepth++;
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < selected.length; index++) {
      const { def, bindings } = selected[index]!;
      // [closure] free variables resolve in the mixin's DEFINITION scope first, with
      // the call-site scope as a fallback (a namespaced call is confined to the
      // namespace, so it takes no caller fallback) — the same layering `expandCall`
      // builds for the flat path.
      const homeFrame = homes.get(def) ?? frame;
      const callFrame: Frame = {
        parent: homeFrame,
        mixins: collectMixins(def.body),
        declIndex: collectDeclIndex(def.body, bindings), cells: cellsForParams(bindings), reassign: null,
        statements: def.body,
        sourceOwner: sourceOwnerForBody(def.body, frame, e),
        ...(namespaced || homeFrame === frame ? {} : { fallback: frame })
      };
      captureArgDefFrames(bindings, frame, callFrame, e);
      const placement = def.ruleMixin === true && source !== null
        ? { source, callFrame } satisfies NestedRuleMixinPlacement
        : null;
      const executeBody = () => mapMaybe(
        prepareBodyPlugins(def.body, callFrame, e),
        () => {
          return emitNestedBody(def.body, callFrame, e, undefined, bodyImp, source, placement, sharedLeaves, applyExpansion);
        }
      );
      const emitted = withSourceOwner(e, callFrame.sourceOwner, executeBody);
      if (isThenable(emitted)) {
        return emitted.then(() => {
          leakBodyVars(frame, def.body, callFrame, e);
          publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
          if (def.ruleMixin !== true) {
            publishExplicitRulesets(frame, def.body, callFrame);
          }
          return run(index + 1);
        });
      }
      // [scope-leak] the mixin's own `@x:` declarations and nested rulesets unlock
      // into the caller scope for later siblings (less@4 splices evaluated rules as
      // siblings of the call), matching the flat path.
      leakBodyVars(frame, def.body, callFrame, e);
      publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
      if (def.ruleMixin !== true) {
        publishExplicitRulesets(frame, def.body, callFrame);
      }
    }
  };
  const emitted = run(0);
  if (isThenable(emitted)) {
    return emitted.then(
      () => {
        e.mixinDepth--;
      },
      (error) => {
        e.mixinDepth--;
        throw error;
      }
    );
  }
  e.mixinDepth--;
  return emitted;
}

/** Nested-mode counterpart of {@link expandApply}. It keeps `$apply`'s
 * ruleset-only selection and explicit duplicate-preservation fact while sharing
 * the same canonical bodies and lexical frames as every other core expansion. */
function expandNestedApply(
  node: Apply,
  frame: Frame,
  e: Emit,
  imp = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer
): MaybePromise<void> {
  const selected: Array<{ rule: Rule; home: Frame }> = [];
  for (const selector of node.selectors) {
    const key = compoundCanonical(selector);
    for (let scope: Frame | null = frame; scope; scope = scope.parent) {
      const matches = frameRulesets(scope)?.get(key);
      if (!matches) {
        continue;
      }
      for (const rule of matches) {
        if (!parentExcludes(frame, rule.body) && ruleGuardPasses(rule, scope, e)) {
          selected.push({ rule, home: scope });
        }
      }
    }
  }
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < selected.length; index++) {
      const { rule, home } = selected[index]!;
      const applyFrame: Frame = {
        parent: home,
        mixins: collectMixins(rule.body),
        declIndex: collectDeclIndex(rule.body), cells: null, reassign: null,
        statements: rule.body,
        sourceOwner: sourceOwnerForBody(rule.body, frame, e),
        ...(home === frame ? {} : { fallback: frame })
      };
      const emitted = withSourceOwner(e, applyFrame.sourceOwner, () => mapMaybe(
        prepareBodyPlugins(rule.body, applyFrame, e),
        () => emitNestedBody(rule.body, applyFrame, e, undefined, imp, source, null, sharedLeaves, true)
      ));
      if (isThenable(emitted)) {
        return emitted.then(() => run(index + 1));
      }
    }
  };
  return run(0);
}

/** Expand a detached-ruleset call in nested mode. */
function expandNestedReferenceCall(
  call: Reference,
  frame: Frame,
  e: Emit,
  imp = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer,
  applyExpansion = false
): MaybePromise<void> {
  // A variable bound to a MIXIN CALL (`@alias: .something(foo); @alias();`) is
  // dispatched as that call, not spliced as a detached ruleset.
  const step = call.steps.at(-1);
  if (step?.type !== 'Call') {
    return;
  }
  const resolved = resolveReferenceResult(call, frame, e);
  if (!resolved) {
    return;
  }
  if (isMixinCallValue(resolved.value)) {
    return expandNestedCall(resolved.value, frame, e, imp, source, sharedLeaves, applyExpansion);
  }
  if (step.args.length !== 0) {
    throw new Error('Reference call arguments require a callable mixin target.');
  }
  const dr = resolveDetachedRuleset(resolved.value, resolved.frame, e);
  if (!dr) {
    return;
  }
  const r = referenceCallFrame(dr, frame, resolved.frame, resolved.sourceOwner);
  const executeBody = () => mapMaybe(
    prepareBodyPlugins(r.dr.body, r.callFrame, e),
    () => emitNestedBody(r.dr.body, r.callFrame, e, undefined, imp, source, null, sharedLeaves, applyExpansion)
  );
  return withSourceOwner(e, r.callFrame.sourceOwner, executeBody);
}

/** Expand an `each()` loop in nested mode: splice the callback body once per item
 *  with that iteration's loop-variable bindings. (A cross-iteration `+`/`+_` merge
 *  does not fold across the per-iteration bodies in nested mode — flat mode does.) */
function expandNestedFor(
  node: For,
  frame: Frame,
  e: Emit,
  imp = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer,
  applyExpansion = false
): MaybePromise<void> {
  const items = forItems(node.iterable, frame, e);
  const run = (start: number): MaybePromise<void> => {
    for (let i = start; i < items.length; i++) {
      const item = items[i]!;
      const { value, key } = item;
      const index = dimension(i + 1);
      const bindings = bindForEntry(node, value, key, index);
      const extendPlacement = e.plannedForExtendPlacements?.get(node)?.[i];
      const loopFrame: Frame = {
        parent: frame,
        mixins: collectMixins(node.rules),
        declIndex: collectDeclIndex(node.rules, bindings), cells: cellsForParams(bindings), reassign: null,
        statements: node.rules,
        sourceOwner: frame.sourceOwner ?? null,
        ...(extendPlacement ? { extendPlacement } : {})
      };
      bindForDetached(loopFrame, bindings, item);
      const emitted = mapMaybe(
        prepareBodyPlugins(node.rules, loopFrame, e),
        () => emitNestedBody(node.rules, loopFrame, e, undefined, imp, source, null, sharedLeaves, applyExpansion)
      );
      if (isThenable(emitted)) {
        return emitted.then(() => run(i + 1));
      }
    }
  };
  return run(0);
}

/**
 * A block at-rule in nested mode: `@name prelude { …body }`. The header sits at
 * the current level; the body is a fresh nesting context one level deeper whose
 * nested rulesets STAY nested (they are not flattened). An at-rule whose body
 * renders empty is dropped entirely.
 */
function emitNestedAtRuleBlock(
  node: AtRuleBlock,
  frame: Frame,
  e: Emit,
  source: NestedHeaderSource | null = null
): MaybePromise<void> {
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) {
    put(e, idt);
  }
  put(e, node.name);
  if (node.prelude !== null) {
    const lname = node.name.toLowerCase();
    let p = lname === '@supports'
      ? normalizeSupportsPrelude(evalSupportsPreludeSync(node.prelude, frame, e))
      : lname === '@media' || lname === '@container'
        ? evalQueryPreludeSync(node.prelude, frame, e)
        : evalBytesSync(node.prelude, frame, e);
    if (lname === '@media' || lname === '@container') {
      p = normalizeQueryPrelude(p);
    }
    if (p.length > 0) {
      put(e, ' ');
      put(e, p);
    }
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const bodyFrame: Frame = {
    parent: frame,
    mixins: collectMixins(node.body),
    declIndex: collectDeclIndex(node.body), cells: null, reassign: null,
    statements: node.body
  };
  e.depth++;
  const finish = (): void => {
    e.depth--;
    if (e.chunks.length === afterHeader) {
      e.chunks.length = markChunks;
      e.off = markOff;
      if (e.positions) {
        e.positions.length = markPos;
      }
      return;
    }
    if (idt) {
      put(e, idt);
    }
    put(e, '}\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
  };
  return mapMaybe(
    prepareBodyPlugins(node.body, bodyFrame, e),
    () => mapMaybe(emitNestedBody(node.body, bodyFrame, e, undefined, false, source), finish)
  );
}
