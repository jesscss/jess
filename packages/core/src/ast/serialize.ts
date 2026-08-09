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
import type { Combinator, Node, NodeType } from './node.js';
import {
  any,
  callArg,
  decl,
  dimension,
  importOptionWords,
  interpolation,
  mixinCall,
  operation,
  spaced,
  variableDeclaration,
  isLiteralNode,
  isTypedLiteral,
  isValueBlock,
  valueBlockBody,
  compoundCanonical,
  compoundHasInterp,
  complexCanonical,
  complexHasInterp,
  complexHasAmpersand,
  pseudoCanonical,
  pseudoHasInterp,
  pseudoJoin,
  selectorBranchCanonical,
  selectorBranchHasAmpersand,
  selectorBranchHasInterp,
  selectorTermCanonical,
  selectorTermHasInterp,
  simpleSelector,
  branchTextIsPlaceholder
} from './nodes.js';
import type {
  Any,
  Apply,
  Collection,
  CollectionEntry as AstCollectionEntry,
  Color,
  Comment,
  ComplexSelector,
  CompoundSelector,
  Declaration,
  AnonymousMixin,
  ValueBlock,
  Dimension,
  For,
  If,
  While,
  IfValue,
  FunctionCall,
  Interpolation,
  Keyword,
  Reference,
  MixinCall,
  MixinDefinition,
  ModuleImport,
  Operation,
  PseudoSelector,
  Quoted,
  Range,
  RelativeSelector,
  Stylesheet,
  Ruleset,
  Sequence,
  SelectorBranch,
  SimpleSelector,
  SimpleToken,
  SelectorTerm,
  SelectorList,
  List,
  Statement,
  StyleImport,
  ValueNode,
  ValueSlot,
  VariableDeclaration,
  Lookup
} from './nodes.js';

// [atrule] block + statement at-rule node types
import type { AtRuleBlock, AtRuleStatement, OpaqueAtRuleBlock, Plugin } from './at-rule.js';

// typed synchronous value evaluator seam + boundary-clean value domain.
import {
  DEFAULT_MODES,
  IncomparableOperandsError,
  emitValue,
  isValueGroupArray,
  isElided,
  isLiteral,
  literal,
  type EvalModes,
  type FnScope,
  type PluginCallCtx,
  type PluginHost,
  type PluginRawArgument,
  type PluginVariableHit,
  type CollectionEntry as ValueCollectionEntry,
  type EvalValue,
  type ValueEvaluator,
  type ValueGroup,
  type Value
} from './value-eval.js';
import type { Fn, FnCtx, FnIo } from './functions/types.js'; // [plugin/P1] scoped-fn registry; [io] file-read seam
import { type MaybePromise, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { colorFromSrc, dimensionFromFields, quotedFromFields, materializeAny } from './literal-tag.js'; // [value node model]
import { UnitArithmeticError, calcInner, validateFinalUnits } from './value-operate.js'; // [calc/unit validation]
import { makeAny, makeBlock, makeCollection, makeKeyword, makeBool, makeList, makeNull, NULL } from './value-factory.js'; // [calc]
import { groupItems } from './value-list.js';
import { DefaultGuardAmbiguityError, bindArgs, selectDefinitions, type Selection, type DefaultResolver, type CallArg, type CallValue } from './mixin-dispatch.js'; // [guards]
import { evalGuard, guardUsesDefault, type GuardNode, type ValueResolver, type TypedResolver } from './guard.js'; // [guards]
import { isTruthy } from './value-truth.js'; // [§4.4] the one typed truthiness predicate
import { computeExtends, type ExtendPlacementResults, type ExtendResults } from './extend.js'; // [extend]
import { documentHasExtend, recordAstExtendProfile } from './extend/plan.js'; // [extend/selector-interp]
import type { PlanInstruction, PlanOverlay, PlanSubject } from './extend/plan.js';
import type { Branch, Level } from './extend/ir.js';
import { mkBranch } from './extend/ir.js';
import type { Context } from '../context.js';
import { Deprecation } from '../deprecation.js';
import { ERR, WARN, toDiagnostic } from '../error/diagnostics.js';
import { JessError } from '../error/jess-error.js';
import { lineColAt } from '../error/code-frame.js';
import { NO_SPAN, bodyEndOf, bodySpanOf, bodyStartOf, sourceEndOf, sourceSpanOf, sourceStartOf, triviaMapOf, valueLayoutOf, withValueLayout, type AstSourceSpan } from './provenance.js';
import type { Trivia, TriviaMap } from '../types/index.js';

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

function observeRejectedThenable(value: Promise<unknown>): void {
  void value.then(undefined, () => undefined);
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

  /** Parser-owned source trivia for comments/spacing that are not AST children. */
  trivia?: TriviaMap;

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

  /** Compile-prepared static imports, consumed by render without loading them again. */
  preparedImports?: PreparedImports;
}

export interface ImportDocumentRequest {
  node: StyleImport;

  /** Evaluated, unquoted specifier supplied to the Context/plugin dispatcher. */
  specifier: string;

  /** Evaluated parenthesized option bytes, without the enclosing parentheses. */
  options: string | null;
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

/**
 * A Context-read `(inline)` import: raw source is deliberately never parsed.
 *
 * There is no media wrapper. `@import (inline) "a.txt" (min-width: 100px)` is a
 * PARSE ERROR — `(inline)` makes the import compile-time, and a postlude on a
 * compile-time import is rejected by the grammar — so the spliced bytes are
 * always emitted bare.
 */
export interface ImportDocumentInline {
  readonly inline: string;
}

export type ImportDocument = ImportDocumentTree | ImportDocumentInline;

export interface PlannedImportDocument {
  request: ImportDocumentRequest;
  loaded: ImportDocument | undefined;
}

export interface PreparedImports {
  readonly documents: WeakMap<StyleImport, PlannedImportDocument>;
}

/**
 * The driver-facing option string: the authored option WORDS, comma-joined.
 * A structured option fact — SCSS `@use "x" with (…)` — is a typed configuration
 * carried on the node, not bytes, and deliberately stays out of this string.
 */
function importRequestOptions(options: List | null): string | null {
  const words = importOptionWords(options);
  return words.length === 0 ? null : words.join(', ');
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
  const importError = (request: ImportDocumentRequest, error: unknown): never => {
    if (error instanceof JessError && error.code !== 'import/not-found') {
      throw error;
    }
    const file = context.sourceContext?.file;
    const source = file?.source;
    const span = source === undefined ? undefined : sourceSpanOf(request.node);
    const location = source === undefined || span === undefined ? undefined : lineColAt(source, span.start, file);
    if (error instanceof JessError && error.code === 'import/not-found') {
      throw ERR.importNotFound({
        node: request.node,
        filePath: file?.fullPath,
        source,
        line: location?.line,
        column: location?.column,
        meta: {
          specifier: request.specifier,
          from: file?.path ?? process.cwd()
        }
      });
    }
    throw ERR.importLoadFailed({
      node: request.node,
      filePath: file?.fullPath,
      source,
      line: location?.line,
      column: location?.column,
      meta: {
        specifier: request.specifier,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
  };
  return async ({ node, specifier, options }) => {
    const request = { node, specifier, options };
    if (importHasOption(options, 'inline')) {
      try {
        const bytes = await context.readBinary(specifier);
        return { inline: bytes.toString() };
      } catch (error) {
        importError(request, error);
      }
    }

    /*
     * Parse-mode selection remains Context/plugin-owned. The typed Less `(less)`
     * flag asks the existing dispatcher for its `less` plugin even when the path
     * ends in `.css`; core never chooses or invokes a parser itself.
     */
    const explicitSourceImport = node.name.toLowerCase() === '@-import';
    let loaded: Awaited<ReturnType<Context['loadImport']>>;
    try {
      loaded = await context.loadImport(specifier, importHasOption(options, 'less') || explicitSourceImport ? { type: 'less' } : {});
    } catch (error) {
      /*
       * `(optional)` suppresses ONLY the missing-file diagnostic, and the import
       * then contributes nothing at all — no rules and no CSS terminal. A file
       * that exists but fails to parse still raises: `optional` means "may be
       * absent", not "may be broken".
       */
      if (importHasOption(options, 'optional') && error instanceof JessError && error.code === 'import/not-found') {
        return { document: null };
      }
      importError(request, error);
    }

    /*
     * An unclaimed external specifier (`//host/x.css`, `https:…`) is a CSS
     * terminal, not a failed load, so `(optional)` stays moot on it.
     */
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
  readonly definition: MixinDefinition;
  readonly rank: MixinRank;
}

interface OrderedMixinIndex {
  readonly byName: Map<string, OrderedMixinCandidate[]>;
}

interface SelectedMixinPath {
  readonly node: If;
  readonly rules: Statement[];
}

interface MixinDefinitionMeta {
  readonly rank: MixinRank;
  readonly selectedPath: readonly SelectedMixinPath[];
}

/** Shared, source-order declaration facts for one lexical body. Never mutated. */
interface DeclIndex {
  readonly byName: Map<string, VariableDeclaration[]>;
}

/**
 * One activation's current binding for a name, plus the same-activation bindings
 * it SHADOWED, newest first.
 *
 * `prev` is what makes the live store obey the same rule the scoped store gets
 * from {@link DeclIndex}: a read resolves against declarations `1..N-1` with the
 * declaration being evaluated (`N`) excluded. `declIndex` keeps every same-name
 * declaration in a source-order stack, so `lookupScopedBinding` can skip the
 * excluded one and land on the previous. A live cell used to be a SINGLE slot,
 * so write `N` destroyed `N-1` and the skip had nothing left to land on —
 * `$i: 3; $i: $i - 1` reported a false `Recursive reference`. The chain restores
 * the missing history; the exclusion set itself is untouched.
 *
 * The chain is only extended when the incoming value can actually read the name
 * back (see {@link activateVariableDeclaration}), so a plain overwrite sequence
 * stays O(1) and only a genuine read-then-write retains its predecessor.
 */
interface BindingCell {
  declaration: VariableDeclaration;
  value: Binding;
  valueFrame?: Frame;
  prev: BindingCell | null;
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
 * `Ruleset` mutation: a later namespaced call must enter the activation that
 * actually evaluated the rule (and therefore owns its live bindings/imports).
 */
interface PublishedRulesetPlacement {
  readonly rule: Ruleset;
  readonly frame: Frame;
}

export interface Frame {
  parent: Frame | null;

  /**
   * Identity of one executed `$for`/`each()` iteration when this frame descends
   * from it. This is render-local placement state, never a property of the
   * canonical `For` or `Ruleset` AST: the same rule body may execute repeatedly
   * with distinct bindings and therefore needs distinct extend-plan facts.
   */
  extendPlacement?: object;

  // [guards] a name maps to ALL same-name defs (overloads), in definition order.
  mixins: Map<string, MixinDefinition[]> | null;

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

  /*
   * [scope-leak] variables UNLOCKED into this frame by a mixin call in its body
   * (`leakBodyVars`). v5 "outer-binding-wins": the mixin-injected variable is NOT
   * hoisted into the ordinary `vars` scope — it is consulted ONLY after the whole
   * lexical chain (`vars` up every `parent`, plus `fallback`) misses. So a name
   * that ANY enclosing scope already binds resolves to that lexical binding
   * (`.tiny-scope`'s `@mix` → root `blue`), while a name bound NOWHERE else falls
   * through to the leaked value (`.heightIsSet`'s `@height` → the leaked `1024px`).
   * This drops the 4.x mixin-injected-variable hoist (which put the leak in `vars`
   * and let it shadow the outer binding → `#989`). See DESIGN-DECISIONS R2.
   */
  leaked?: Map<string, Binding[]> | null;

  /*
   * secondary scope consulted after the `parent` chain is exhausted (the
   * detached-ruleset definition closure — caller-first, definition-fallback).
   */
  fallback?: Frame | null;

  /*
   * rulesets visible at this level, keyed by their own-local selector
   * string (namespace path descent). Lazily built only when a namespaced call or
   * map/namespace accessor needs it.
   */
  rulesets?: Map<string, Ruleset[]> | null;

  /** Root rulesets spliced by already-executed imports, in import/source order. */
  importedRules?: Ruleset[] | null;

  /**
   * Imported callable statements in their source order. Namespaced descent must
   * see imported mixin definitions as well as rulesets; ordinary call lookup
   * already receives the definitions through `mixins`.
   */
  importedCallables?: Array<MixinDefinition | Ruleset> | null;

  /**
   * Source-ordered direct ruleset placements unlocked by executed explicit
   * mixins. They are visible only to later lookup in this caller frame.
   */
  publishedRules?: PublishedRulesetPlacement[] | null;

  /**
   * Render-local placement frames for rules evaluated in this lexical frame.
   * A nested import executes in the Ruleset's child frame; namespace descent must
   * therefore retain that frame's imported prefix instead of reconstructing a
   * scope from authored `Ruleset.rules` alone. This belongs to the render frame,
   * never to the immutable AST Ruleset.
   */
  rulePlacements?: Map<Ruleset, Frame>;

  /*
   * [dedup] source-ordered dispatch candidates keyed by name: parametric MixinDefs
   * AND paren-less ruleset-mixins INTERLEAVED in authored order (unlike `mixins`,
   * which groups all parametric defs). Lazily built once from `statements` and
   * cached; published (unlocked) defs are merged in at lookup from `mixins`.
   */
  orderedMixins?: OrderedMixinIndex | null;

  /** Lexical rank/path facts; indexing does not publish any selected-arm definition. */
  mixinDefinitionMeta?: Map<MixinDefinition, MixinDefinitionMeta>;

  /** Definitions reached while walking selected arms in this activation. */
  selectedMixinEvents?: Map<string, OrderedMixinCandidate[]>;

  /*
   * [closure/publish] a mixin def UNLOCKED into this frame by a body expansion
   * (`publishMixins`) carries its CLOSURE — the callee frame it was authored in,
   * where its params/locals are bound. A later call to that def resolves its free
   * variables + guard in this home, not the frame it was published into
   * (`.lock-mixin(1)` publishes `.inner-locked-mixin` whose `when (@a = 1)` reads
   * the `@a` bound during that expansion). Absent an entry a def's home is the
   * frame it is found in (the ordinary lexical case).
   */
  mixinHomes?: Map<MixinDefinition, Frame> | null;

  // the statements this frame was built from (for lazy rulesets / decl-map).
  statements?: Statement[] | null;

  /** Evaluated declaration visibility for Less `$property` accessors. */
  propertyTimeline?: PropertyDeclarationFact[] | null;

  /*
   * [plugin/P1] functions registered by a `@plugin` (or, later, `@use`) directive
   * textually inside THIS frame's block, keyed lower-case like the global registry.
   * `null`/absent on EVERY frame unless this exact block loaded a scoped function
   * Resolution
   * walks `fns` up the `parent` chain (nearest-first), so a scoped fn is visible in
   * its subtree and shadows a same-name built-in; the chain IS the `parent` chain —
   * no parallel scope structure.
   */
  fns?: Map<string, Fn> | null;

  /*
   * [plugin/P1] nearest frame at-or-above this one that owns any local function
   * registrations. This is only an accelerator for candidate frames: lookup is
   * still nearest-frame-with-the-requested-entry, so a frame with unrelated
   * functions does not stop a requested name from falling through to an outer
   * scoped function or, after scoped lookup misses, the built-in registry.
   * `fns` stays local, so scoped functions never share storage with
   * variables/declarations and ordinary empty frames allocate no function map.
   */
  fnScope?: Frame | null;

  /** Version of the render-local scoped-function graph that populated `fnScope`. */
  fnScopeVersion?: number;

  /** Value-block (anonymous-mixin / collection) closure facts for this activation;
   * never stored on AST nodes. */
  detachedBindings?: Map<ValueBlock, DetachedBinding>;

  /** Per-activation value owners for synthetic parameter declarations. */
  bindingValueFrames?: Map<Binding, Frame>;

  /** Opaque Context source identity that authored this activation's body. */
  sourceOwner?: object | null;
}

function sourceOwnerForBody(rules: object, frame: Frame, e: EvalCtx): object | null {
  return e.context?.sourceOwnerForBody?.(rules) ?? frame.sourceOwner ?? null;
}

function withSourceOwner<T>(e: EvalCtx, owner: object | null | undefined, run: () => T | Promise<T>): T | Promise<T> {
  return e.context?.withSourceOwner ? e.context.withSourceOwner(owner, run) : run();
}

function bindDetached(frame: Frame, value: Binding, lexicalFrame: Frame, sourceOwner: object | null): void {
  if (!isValueBlockBinding(value)) {
    return;
  }
  (frame.detachedBindings ??= new Map()).set(value, { lexicalFrame, sourceOwner });
}

function isValueBlockBinding(value: Binding): value is ValueBlock {
  return 'type' in value && isValueBlock(value);
}

function detachedBinding(frame: Frame | null, value: Binding): DetachedBinding | undefined {
  if (!isValueBlockBinding(value)) {
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
  e.fnScopeVersion = (e.fnScopeVersion ?? 0) + 1;
  const map = frame.fns ??= new Map();
  const names = e.scopedFunctionNames ??= new Set();
  for (const fn of fns) {
    const name = fn.name.toLowerCase();
    map.set(name, fn);
    names.add(name);
  }
  frame.fnScope = frame;
  frame.fnScopeVersion = e.fnScopeVersion;
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

/** The render-local name gate: only these calls can require a lexical lookup. */
function scopedFunctionNames(fns: ReadonlyMap<string, Fn> | null): Set<string> | undefined {
  return fns === null ? undefined : new Set(fns.keys());
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
      const deprecation = Deprecation.fromId('less-plugin') ?? Deprecation.userAuthored;
      e.context?.warnAtNode(
        'eval/deprecated',
        'eval',
        statement,
        {
          what: 'Less @plugin',
          use: '@use or @-use',
          deprecation
        },
        { code: `deprecation/${deprecation.id}` }
      );

      /*
       * A `@plugin` that cannot be resolved, or whose script throws while
       * installing, is a hard failure attributed to the `@plugin` statement —
       * never a silently skipped registration.
       */
      const failed = (error: unknown): never => {
        throw error instanceof JessError
          ? error
          : ERR.pluginLoadFailed({
              node: statement,
              ...callSiteLocation(statement, e),
              meta: {
                specifier,
                reason: error instanceof JessError
                  ? error.message
                  : error instanceof Error
                    ? error.message
                    : String(error)
              }
            });
      };
      let loaded: MaybePromise<readonly Fn[]>;
      try {
        loaded = load({ specifier, options });
      } catch (error) {
        return failed(error);
      }
      if (isThenable(loaded)) {
        return loaded.then((fns) => {
          addScopedFns(frame, fns, e);
          return run(index + 1);
        }, failed);
      }
      addScopedFns(frame, loaded, e);
    }
  };
  return run(0);
}

export interface FnScopeCacheState {
  fnScopeVersion?: number;
}

function nearestFnScope(frame: Frame | null, state?: FnScopeCacheState): Frame | null {
  if (!frame) {
    return null;
  }
  const version = state?.fnScopeVersion ?? 0;
  if (frame.fnScopeVersion === version) {
    return frame.fnScope ?? null;
  }
  for (let current: Frame | null = frame; current; current = current.parent) {
    if (current.fns?.size) {
      frame.fnScope = current;
      frame.fnScopeVersion = version;
      return current;
    }
    if (current.fnScopeVersion === version) {
      frame.fnScope = current.fnScope ?? null;
      frame.fnScopeVersion = version;
      return frame.fnScope ?? null;
    }
  }
  frame.fnScope = null;
  frame.fnScopeVersion = version;
  return null;
}

/**
 * Resolve one lower-cased name through frames that actually own function
 * registrations. A candidate frame that has functions but not this name is
 * skipped; only the nearest matching entry wins.
 */
export function lookupScopedFn(frame: Frame | null, lowerName: string, state?: FnScopeCacheState): Fn | undefined {
  for (let f = nearestFnScope(frame, state); f; f = nearestFnScope(f.parent, state)) {
    const hit = f.fns!.get(lowerName);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

/**
 * [plugin/P1] Build the legacy {@link FnScope} lazy view a direct consumer can
 * consult. The serializer resolves a name directly through {@link lookupScopedFn}
 * and does not allocate this view on its hot path.
 */
export function makeFnScope(frame: Frame | null, state?: FnScopeCacheState): FnScope {
  return {
    lookup: (name: string): Fn | undefined => lookupScopedFn(frame, name.toLowerCase(), state)
  };
}

// [guards] collect ALL definitions per name (overloaded dispatch), not last-wins.
function collectMixins(statements: Statement[]): Map<string, MixinDefinition[]> | null {
  let map: Map<string, MixinDefinition[]> | null = null;
  for (const s of statements) {
    if (s.type === 'MixinDefinition') {
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
  const visit = (rules: Statement[]): void => {
    for (const statement of rules) {
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
      } else if (statement.type === 'While') {
        /*
         * Unconditional, unlike an `$if` arm: a `$while` has exactly one body and
         * no alternative to select, so its declarations belong to this index the
         * moment the loop is reachable. This is what makes `$i: $i - 1` inside the
         * body a REASSIGNMENT of the containing `$i` rather than a self-reference
         * — without it the body's own declaration is invisible here and the
         * recursion guard fires on the first iteration.
         */
        visit(statement.rules);
      }
    }
  };
  visit(statements);
  return byName.size === 0 ? null : { byName };
}

/** Seed one activation's live cells from mixin/function parameters. */
function cellsForParams(
  params: Map<string, Binding> | null,
  valueFrames?: ReadonlyMap<Binding, Frame>
): Map<string, BindingCell> | null {
  if (!params) {
    return null;
  }
  const cells = new Map<string, BindingCell>();
  for (const [name, value] of params) {
    const declaration = variableDeclaration(name, value, { mode: 'declare' });
    const valueFrame = valueFrames?.get(value);
    cells.set(name, valueFrame
      ? { declaration, value, valueFrame, prev: null }
      : { declaration, value, prev: null });
  }
  return cells;
}

/*
 * collect the rulesets defined directly in a scope, keyed by own-local
 * selector string (namespace-path descent). Built lazily on first path lookup.
 */
function collectRulesets(statements: Statement[]): Map<string, Ruleset[]> | null {
  let map: Map<string, Ruleset[]> | null = null;
  const add = (key: string, s: Ruleset): void => {
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
    if (s.type === 'Ruleset') {
      for (const c of s.selector.selectors) {
        const key = selectorBranchCanonical(c);
        add(key, s);

        /*
         * A leading combinator (`#theme { > .mixin {} }` → key `> .mixin`) is a
         * child-descent placement; a namespace-accessor call (`#theme > .mixin()`)
         * dispatches by the bare own-local selector, so also key the stripped form.
         */
        const stripped = key.replace(/^[>+~]\s*/u, '');
        if (stripped !== key) {
          add(stripped, s);
        }
      }
    }
  }
  return map;
}

function frameRulesets(frame: Frame): Map<string, Ruleset[]> | null {
  if (frame.rulesets !== undefined) {
    return frame.rulesets;
  }
  const built = collectRulesets([...(frame.importedRules ?? []), ...(frame.statements ?? [])]);
  frame.rulesets = built;
  return built;
}

/*
 * [guards] collect every visible same-name def up the scope chain (nearest
 * scope first), so overload resolution sees all candidates. after the
 * `parent` chain, consult the first `fallback` seen (detached-ruleset closure).
 */
function lookupMixinCandidates(frame: Frame | null, name: string): MixinDefinition[] {
  let out: MixinDefinition[] | null = null;
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
    /*
     * The fallback (caller) chain can rejoin the parent (definition) chain at a
     * shared ancestor, so a def already collected must NOT be dispatched twice —
     * merge by identity, first occurrence wins (mirrors `lookupCandidates`).
     */
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
 * parametric `MixinDefinition`s AND paren-less rulesets callable as zero-arg mixins,
 * INTERLEAVED in authored order. Less expands every matching body in definition
 * order, and a braceless `.m {…}` sits at its source position AMONG the `.m(…)`
 * overloads — not lumped after all of them (the bug the old `[...defs, ...rules]`
 * concat produced). A frame with no `statements` list (e.g. a decl-map closure)
 * has no rule-mixins and falls back to its explicit-def map.
 */
/**
 * [dedup] Build (once, cached) a frame's source-ordered candidate map: for every
 * name, its parametric `MixinDefinition`s and paren-less ruleset-mixins in the order they
 * were authored. One O(statements) pass — the same cost class as
 * {@link collectMixins} / {@link collectRulesets} — so per-call lookup stays O(1)
 * (a map `get`), not a per-call statement walk.
 */
function orderedMixinsForStatements(
  statements: Statement[],
  f: Frame,
  e: EvalCtx
): MaybePromise<OrderedMixinIndex | null> {
  const byName = new Map<string, OrderedMixinCandidate[]>();
  const add = (name: string, definition: MixinDefinition, rank: MixinRank): void => {
    const list = byName.get(name);
    const candidate = { definition, rank };
    if (list) {
      list.push(candidate);
    } else {
      byName.set(name, [candidate]);
    }
  };

  /*
   * Reused across statements: the key buffer never escapes `addRuleKeys`, so the
   * all-static index build allocates nothing per rule.
   */
  const scratchKeys: string[] = [];

  /*
   * The names this rule answers to as a zero-arg mixin: each selector's canonical
   * form plus its leading-combinator-stripped form (mirrors the keys
   * `collectRulesets` builds). Collect UNIQUE keys first so a rule with two
   * selectors that canonicalize alike adds ONE candidate, not two.
   * [mixin-interp] an INTERPOLATED selector (`.@{name}`) keys under its RESOLVED
   * name in this frame (`.@{a1}` with `@a1: foo` answers to `.foo()`), so a call
   * dispatches on the concrete name the parser could not know statically.
   */
  const addRuleKeys = (rule: Ruleset, index: number, resolvedKeys: readonly string[]): void => {
    let keys: Set<string> | null = null;
    for (const key of resolvedKeys) {
      (keys ??= new Set<string>()).add(key);
      const stripped = key.replace(/^[>+~]\s*/u, '');
      if (stripped !== key) {
        keys.add(stripped);
      }
    }
    if (!keys) {
      return;
    }
    for (const key of keys) {
      /*
       * one synthesized candidate per name, interleaved at the rule's source position.
       * [guards] a guarded ruleset called as a zero-arg mixin filters on its guard.
       */
      const rm: MixinDefinition = {
        type: 'MixinDefinition', name: key, params: [], rules: rule.rules, ruleMixin: true,
        ...(rule.guard !== undefined ? { guard: rule.guard } : {}),

        /* the synthesized ruleset-mixin stands for the same source as its rule */
        _s: rule._s, _e: rule._e, _bs: rule._bs, _be: rule._be
      };
      add(key, rm, [index]);
    }
  };

  /**
   * Statements are folded in SOURCE ORDER. That order is load-bearing: `add`
   * appends, and `frameCandidatesInOrder` consumes each list assuming it is
   * rank-sorted. A rule whose interpolated key must be awaited therefore
   * SUSPENDS the fold rather than deferring its own `add` past later statements,
   * which would silently invert dispatch order.
   */
  const run = (index: number): MaybePromise<void> => {
    for (; index < statements.length; index++) {
      const s = statements[index]!;
      if (s.type === 'MixinDefinition') {
        add(s.name, s, [index]);
        continue;
      }
      if (s.type !== 'Ruleset') {
        continue;
      }
      let interpolated = false;
      for (const c of s.selector.selectors) {
        if (selectorBranchHasInterp(c)) {
          interpolated = true;
          break;
        }
      }
      if (!interpolated) {
        scratchKeys.length = 0;
        for (const c of s.selector.selectors) {
          scratchKeys.push(selectorBranchCanonical(c));
        }
        addRuleKeys(s, index, scratchKeys);
        continue;
      }

      /*
       * Only an interpolated selector can await, and only then does this rule
       * allocate: resolve its keys, then continue the fold from the next statement.
       */
      const parts = s.selector.selectors.map(c =>
        (selectorBranchHasInterp(c) ? resolveSelectorBranch(c, f, e) : selectorBranchCanonical(c)));
      let pending = false;
      for (const part of parts) {
        if (isThenable(part)) {
          pending = true;
          break;
        }
      }
      if (pending) {
        const rule = s;
        const at = index;
        return Promise.all(parts).then((resolvedKeys) => {
          addRuleKeys(rule, at, resolvedKeys);
          return run(at + 1);
        });
      }
      scratchKeys.length = 0;
      for (const part of parts) {
        if (!isThenable(part)) {
          scratchKeys.push(part);
        }
      }
      addRuleKeys(s, index, scratchKeys);
    }
    return undefined;
  };

  return mapMaybe(run(0), () => (byName.size === 0 ? null : { byName }));
}

/**
 * The memoized per-frame index. `f.orderedMixins` only ever holds a SETTLED
 * index (or `null`) — never a promise — so the frame shape stays monomorphic and
 * every reader below keeps its existing synchronous contract.
 *
 * Building it can await only when a rule's selector key is interpolated from an
 * awaitable value. {@link ensureOrderedMixins} pre-warms the chain on the
 * awaitable lane before a lookup walk begins; reaching this function with an
 * unbuilt, awaitable index means the pre-warm did not cover this frame, which is
 * reported rather than guessed at.
 */
function frameOrderedMixins(f: Frame, e: EvalCtx): OrderedMixinIndex | null {
  if (f.orderedMixins !== undefined) {
    return f.orderedMixins;
  }
  const st = f.statements;
  if (!st) {
    return (f.orderedMixins = null);
  }
  const built = orderedMixinsForStatements(st, f, e);
  if (isThenable(built)) {
    observeRejectedThenable(built);
    throw ERR.asyncInSyncPosition({
      node: f.statements?.[0] ?? {},
      meta: { where: 'mixin-index build (an interpolated selector used as a mixin key)' }
    });
  }
  return (f.orderedMixins = built);
}

/**
 * Ensure a frame's index is built, on the awaitable lane. Folded INTO the lookup
 * walk (see {@link frameCandidatesInOrder}) rather than run as a separate
 * pre-pass: a separate pass duplicated the walk `lookupCandidates` performs
 * immediately afterwards, visited every frame's fallback where the lookup takes
 * only the nearest, and still covered nothing for the path-descent lane.
 *
 * After a frame's first build this is a single `!== undefined` check.
 */
function ensureFrameIndex(f: Frame, e: EvalCtx): MaybePromise<void> {
  if (f.orderedMixins !== undefined) {
    return undefined;
  }
  const st = f.statements;
  if (!st) {
    f.orderedMixins = null;
    return undefined;
  }
  const built = orderedMixinsForStatements(st, f, e);
  if (isThenable(built)) {
    return built.then((index) => {
      f.orderedMixins = index;
    });
  }
  f.orderedMixins = built;
  return undefined;
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

function frameMixinDefinitionMeta(frame: Frame): Map<MixinDefinition, MixinDefinitionMeta> {
  if (frame.mixinDefinitionMeta) {
    return frame.mixinDefinitionMeta;
  }
  const meta = new Map<MixinDefinition, MixinDefinitionMeta>();
  const visit = (rules: Statement[], rank: MixinRank, selectedPath: readonly SelectedMixinPath[]): void => {
    for (let index = 0; index < rules.length; index++) {
      const statement = rules[index]!;
      const at = [...rank, index];
      if (statement.type === 'MixinDefinition') {
        meta.set(statement, { rank: at, selectedPath });
      } else if (statement.type === 'If') {
        for (const branch of statement.branches) {
          visit(branch.rules, at, [...selectedPath, { node: statement, rules: branch.rules }]);
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
function publishSelectedMixinDefinition(frame: Frame, definition: MixinDefinition): void {
  const meta = frameMixinDefinitionMeta(frame).get(definition);
  if (!meta || meta.selectedPath.length === 0) {
    return;
  }
  const selected = frame.selectedIfBodies;
  if (!selected || !meta.selectedPath.every(path => selected.get(path.node) === path.rules)) {
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
function publishImportedMixinDefinition(frame: Frame, definition: MixinDefinition, recordCallable = true): void {
  const mixins = frame.mixins ??= new Map();
  const candidates = mixins.get(definition.name);
  if (candidates) {
    candidates.push(definition);
  } else {
    mixins.set(definition.name, [definition]);
  }
  if (recordCallable) {
    (frame.importedCallables ??= []).push(definition);
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
function publishImportedRuleset(frame: Frame, rule: Ruleset): void {
  (frame.importedRules ??= []).push(rule);
  (frame.importedCallables ??= []).push(rule);

  /*
   * It may have been materialized before this import; rebuild lazily with the
   * newly published import prefix on the next namespace lookup.
   */
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
  rules: readonly Statement[],
  context: Context | undefined
): void {
  if (!context) {
    return;
  }
  for (const child of rules) {
    if (child.type === 'MixinDefinition' || child.type === 'Ruleset') {
      context.rememberDocumentBody(document, child.rules);
    }
  }
}

/**
 * [dedup] A frame's source-ordered candidate list for `name`: the cached
 * interleaved parametric-def/ruleset-mixin list, plus any dynamically PUBLISHED
 * defs (detached-ruleset scope unlocking via `@rs()`, which pushes into `mixins`
 * without touching `statements`) appended.
 */
function frameCandidatesInOrder(f: Frame, name: string, e: EvalCtx): MixinDefinition[] {
  const mapDefs = f.mixins?.get(name);
  if (!f.statements) {
    return mapDefs?.slice() ?? [];
  }
  const base = frameOrderedMixins(f, e)?.byName.get(name) ?? [];
  const events = f.selectedMixinEvents?.get(name) ?? [];
  const out: MixinDefinition[] = [];
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
  homes?: Map<MixinDefinition, Frame> // [closure] def → the frame it was DEFINED in
): MaybePromise<MixinDefinition[]> {
  let out: MixinDefinition[] | null = null;
  let fb: Frame | null | undefined;

  /** Collect one frame's contribution. Pure bookkeeping — never awaits. */
  const collect = (f: Frame): void => {
    const hit = frameCandidatesInOrder(f, name, e);
    if (hit.length) {
      /*
       * [closure/publish] a def UNLOCKED into `f` keeps its authored closure home
       * (`f.mixinHomes`); an ordinarily-declared def is homed at `f`.
       */
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
  };

  /*
   * Walk the parent chain, building each frame's index as it is reached. The
   * walk stays fully synchronous unless an index genuinely needs awaiting.
   */
  const walk = (from: Frame | null): MaybePromise<void> => {
    for (let f = from; f; f = f.parent) {
      const ready = ensureFrameIndex(f, e);
      if (isThenable(ready)) {
        const at = f;
        return ready.then(() => {
          collect(at);
          return walk(at.parent);
        });
      }
      collect(f);
    }
    return undefined;
  };

  return mapMaybe(walk(frame), () => {
    if (!fb) {
      return out ?? [];
    }

    /*
     * The [closure] fallback chain (caller scope) can rejoin the parent (definition)
     * chain at a shared ancestor, so a def already collected must NOT be dispatched
     * twice: merge the fallback candidates by identity, first occurrence wins.
     */
    return mapMaybe(lookupCandidates(fb, name, e, homes), (more) => {
      for (const d of more) {
        if (!out?.includes(d)) {
          (out ??= []).push(d);
        }
      }
      return out ?? [];
    });
  });
}

/**
 * [mixin-match] Split ONE PARSER LEAF spelling into mixin-match ATOMS (`.foo` /
 * `#bar`), dropping combinators and the parent-ref `&` — Less resolves a mixin
 * call/definition on element VALUES only (`Selector.mixinElements`), so
 * combinator (` ` vs `>` vs compound-`.`) is irrelevant to the match and `&`
 * contributes nothing. `&.support` → [`.support`].
 *
 * [C2] The argument must be a string the PARSER produced as bytes — a mixin
 * call/definition name, a namespace path segment, an opaque (`args: null`)
 * pseudo/simple `text`, or an interpolation RESULT. It is NEVER a re-serialized
 * structured node: a parsed selector reaches its atoms through
 * `pushBranchAtoms`, which walks the terms and tokens the parser already built.
 */
function pushLeafAtoms(text: string, out: string[]): void {
  /*
   * A parsed leaf is almost always ONE whole atom — `.foo`, `#bar`, `div`,
   * `&`, `&-foo` — so scan it and push the string itself: no regex machinery
   * and no match array. Only a leaf carrying non-atom bytes (an attribute
   * selector, a functional pseudo, an escape) needs the general split.
   */
  const len = text.length;
  if (len === 0) {
    return;
  }
  const first = text.charCodeAt(0);
  if (first === 0x26 /* & */) {
    /* a bare `&` contributes nothing; a fused `&-foo` needs the general split */
    if (len > 1) {
      pushSplitLeafAtoms(text, out);
    }
    return;
  }
  const start = first === 0x2E /* . */ || first === 0x23 /* # */ ? 1 : 0;
  if (start === len) {
    /* a lone `.`/`#` carries no atom bytes */
    return;
  }
  for (let i = start; i < len; i++) {
    if (!isAtomByte(text.charCodeAt(i))) {
      pushSplitLeafAtoms(text, out);
      return;
    }
  }
  out.push(text);
}

/** `\w` plus `-`: the bytes an element-value atom is made of. */
function isAtomByte(code: number): boolean {
  return (code >= 0x61 && code <= 0x7A) /* a-z */
    || (code >= 0x41 && code <= 0x5A) /* A-Z */
    || (code >= 0x30 && code <= 0x39) /* 0-9 */
    || code === 0x5F /* _ */
    || code === 0x2D; /* - */
}

/** The general split, for a leaf that is not a single atom. */
function pushSplitLeafAtoms(text: string, out: string[]): void {
  const m = text.match(/[#.][\w-]+|&[\w-]*|[\w-]+/gu);
  if (!m) {
    return;
  }
  for (const a of m) {
    if (a === '&') {
      continue;
    }
    out.push(a.charAt(0) === '&' ? a.slice(1) : a);
  }
}

/** [mixin-match] `pushLeafAtoms` as a fresh array, for a standalone leaf name. */
function leafAtoms(text: string): string[] {
  const out: string[] = [];
  pushLeafAtoms(text, out);
  return out;
}

function complexTerms(c: ComplexSelector): SelectorTerm[] {
  const out: SelectorTerm[] = [];
  for (const part of c.value) {
    if (typeof part !== 'string') {
      out.push(part);
    }
  }
  return out;
}

function relativeTerms(c: RelativeSelector): SelectorTerm[] {
  const out: SelectorTerm[] = [];
  for (let index = 1; index < c.value.length; index++) {
    const part = c.value[index]!;
    if (typeof part !== 'string') {
      out.push(part);
    }
  }
  return out;
}

function selectorBranchTerms(branch: SelectorBranch): SelectorTerm[] {
  if (branch.type === 'ComplexSelector') {
    return complexTerms(branch);
  }
  if (branch.type === 'RelativeSelector') {
    return relativeTerms(branch);
  }
  return [branch];
}

function complexCombinators(c: ComplexSelector): Combinator[] {
  const out: Combinator[] = [];
  for (const part of c.value) {
    if (typeof part === 'string') {
      out.push(part);
    }
  }
  return out;
}

function relativeCombinators(c: RelativeSelector): Combinator[] {
  const out: Combinator[] = [];
  for (const part of c.value) {
    if (typeof part === 'string') {
      out.push(part);
    }
  }
  return out;
}

function selectorBranchCombinators(branch: SelectorBranch): Combinator[] {
  if (branch.type === 'ComplexSelector') {
    return complexCombinators(branch);
  }
  if (branch.type === 'RelativeSelector') {
    return relativeCombinators(branch);
  }
  return [];
}

function termTokens(term: SelectorTerm): readonly SimpleToken[] {
  return term.type === 'CompoundSelector' ? term.value : [term];
}

function termIsBareAmp(term: SelectorTerm): boolean {
  const tokens = termTokens(term);
  if (tokens.length !== 1) {
    return false;
  }
  const only = tokens[0]!;
  return only.type === 'SimpleSelector' && only.interp === null && only.text === '&';
}

/**
 * [mixin-match] [C2] The atoms of ONE parsed token, read off the STRUCTURE the
 * parser built — never off a canonical join. A structured pseudo contributes its
 * bare name (`:is` → `is`) then the atoms of each argument branch, which is
 * exactly what the inline `:is(.a, .b)` spelling used to yield; an opaque token
 * contributes its retained leaf `text`. An interp-only token (`text: null`)
 * contributes nothing, matching `simpleTokenText`'s `''`.
 */
function pushTokenAtoms(sim: SimpleToken, out: string[]): void {
  if (sim.type === 'PseudoSelector' && sim.args !== null) {
    pushLeafAtoms(sim.name, out);
    for (const branch of sim.args.selectors) {
      pushBranchAtoms(branch, out);
    }
    return;
  }
  if (sim.text !== null) {
    pushLeafAtoms(sim.text, out);
  }
}

/** [mixin-match] Walk a parsed branch term-by-term, token-by-token. Combinators
 * are skipped: they can contribute no atom. */
function pushBranchAtoms(c: SelectorBranch, out: string[]): void {
  for (const term of selectorBranchTerms(c)) {
    for (const sim of termTokens(term)) {
      pushTokenAtoms(sim, out);
    }
  }
}

/** [mixin-match] The element-value atom list of a selector branch, used to match
 * a namespaced/compound mixin call. */
function selectorBranchAtoms(c: SelectorBranch): string[] {
  const out: string[] = [];
  pushBranchAtoms(c, out);
  return out;
}

/**
 * [mixin-match] [C2] The atom list of an INTERPOLATED branch. Resolution turns a
 * token's `@{…}` template into bytes, so the resolved LEAF is tokenized — but the
 * branch/term/token structure still comes from the parser, so no joined selector
 * is ever rebuilt and re-split.
 */
function resolvedBranchAtoms(c: SelectorBranch, frame: Frame | null, e: EvalCtx): string[] {
  const out: string[] = [];
  for (const term of selectorBranchTerms(c)) {
    for (const sim of termTokens(term)) {
      pushResolvedTokenAtoms(sim, frame, e, out);
    }
  }
  return out;
}

/**
 * [mixin-match] One token's atoms with its `@{…}` templates resolved. A
 * structured pseudo recurses into `args` so an interpolated MEMBER
 * (`.a:not(.@{x})`) contributes its resolved leaf; the static `pushTokenAtoms`
 * would drop it (`text: null` contributes nothing), which is the same content
 * loss the emit path had.
 */
function pushResolvedTokenAtoms(sim: SimpleToken, frame: Frame | null, e: EvalCtx, out: string[]): void {
  if (sim.type === 'PseudoSelector' && sim.args !== null) {
    pushLeafAtoms(sim.name, out);
    for (const branch of sim.args.selectors) {
      for (const term of selectorBranchTerms(branch)) {
        for (const inner of termTokens(term)) {
          pushResolvedTokenAtoms(inner, frame, e, out);
        }
      }
    }
    return;
  }
  if (sim.interp !== null) {
    pushLeafAtoms(resolveSimpleTextSync(sim, frame, e), out);
    return;
  }
  pushTokenAtoms(sim, out);
}

/** [mixin-match] The flat element-value atom list of a namespaced/compound mixin
 * CALL (`.a.b.c()` / `#ns > .m()` / `.do.re.mi()`), path segments then name. */
function callAtoms(call: MixinCall): string[] {
  const out: string[] = [];
  for (const p of call.path) {
    pushLeafAtoms(p.selector, out);
  }
  pushLeafAtoms(call.name, out);
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
 * `MixinDefinition` terminates when its name atoms equal `remaining` exactly. Each
 * pushed candidate records its DEFINITION scope in `homes` (closure/guard scope).
 */
function findPathInScope(
  scope: Frame,
  remaining: string[],
  homes: Map<MixinDefinition, Frame>,
  out: MixinDefinition[],
  e: EvalCtx
): void {
  const st = scope.statements;
  const visit = (s: Statement, placement?: Frame): void => {
    if (s.type === 'MixinDefinition') {
      const nEl = leafAtoms(s.name);
      if (nEl.length === 0 || !atomsArePrefix(nEl, remaining)) {
        return;
      }
      if (nEl.length === remaining.length) {
        out.push(s);
        if (!homes.has(s)) {
          homes.set(s, scope);
        }
      } else {
        /*
         * [namespace-descent] An intermediate mixin namespace receives the implicit
         * zero-argument call.  Reuse normal dispatch so required parameters and guards
         * participate before entering its body; only the terminal segment receives the
         * authored arguments.
         */
        if (settledDispatch(dispatch([s], mixinCall(s.name), scope, e), mixinCall(s.name), e).length === 0) {
          return;
        }
        const child: Frame = {
          parent: scope,
          mixins: collectMixins(s.rules),
          declIndex: collectDeclIndex(s.rules), cells: null, reassign: null,
          statements: s.rules
        };
        findPathInScope(child, remaining.slice(nEl.length), homes, out, e);
      }
    } else if (s.type === 'Ruleset') {
      for (const c of s.selector.selectors) {
        /*
         * [mixin-interp] an interpolated selector resolves in THIS scope before its
         * element atoms are taken, so a compound/namespaced call matches on the
         * concrete name (`#@{c1}-foo > .@{c2}()` answers `#foo-foo > .bar()`).
         * A published rule retains its evaluated child placement; selector
         * interpolation itself resolves one frame outside that child, in the
         * explicit mixin activation which supplied its parameters.
         */
        const selectorFrame = placement?.parent ?? scope;
        const el = selectorBranchHasInterp(c) ? resolvedBranchAtoms(c, selectorFrame, e) : selectorBranchAtoms(c);
        if (el.length === 0 || !atomsArePrefix(el, remaining)) {
          continue;
        }
        if (el.length === remaining.length) {
          const rm: MixinDefinition = {
            type: 'MixinDefinition',
            name: selectorBranchHasInterp(c) ? resolveSelectorBranchSync(c, selectorFrame, e) : selectorBranchCanonical(c),
            params: [], rules: s.rules, ruleMixin: true,
            ...(s.guard !== undefined ? { guard: s.guard } : {}),

            /* the synthesized ruleset-mixin stands for the same source as its rule */
            _s: s._s, _e: s._e, _bs: s._bs, _be: s._be
          };
          out.push(rm);
          homes.set(rm, placement ?? scope);
        } else {
          /*
           * Rulesets are namespace containers too, so a false Less `when` guard
           * prevents descent just as it prevents ordinary rule emission.
           */
          if (!settledGuard(ruleGuardPasses(s, scope, e), 'namespace-path index build', s.selector, e)) {
            continue;
          }

          /*
           * This Ruleset may have executed imports in its render-local placement.
           * Preserve that imported prefix for recursive namespace descent rather
           * than rebuilding a scope from the authored body alone.
           */
          const activePlacement = placement ?? scope.rulePlacements?.get(s);
          const body = activePlacement
            ? null
            : [...(scope.rulePlacements?.get(s)?.importedRules ?? []), ...s.rules];
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

  /*
   * Imported root rules are lexical splices in this scope. They must take part
   * in element-value namespace descent just like authored rules, and are kept
   * ahead of the importing document's source facts in import execution order.
   */
  for (const s of scope.importedCallables ?? scope.importedRules ?? []) {
    visit(s);
  }
  for (const s of st ?? []) {
    visit(s);
  }

  /*
   * Explicit mixin expansion can publish canonical rulesets at the call site.
   * Keep each activation frame beside its source Ruleset: a shared Ruleset node can
   * be placed more than once with different live values, so `Map<Ruleset, Frame>`
   * alone is not a truthful representation here.
   */
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
function findPathCandidates(frame: Frame, call: MixinCall, e: EvalCtx, homes: Map<MixinDefinition, Frame>): MixinDefinition[] {
  const elements = callAtoms(call);
  if (elements.length === 0) {
    return [];
  }
  for (let f: Frame | null = frame; f; f = f.parent) {
    const out: MixinDefinition[] = [];
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
 * [parent-exclusion] Is `body` (a ruleset-mixin's source Ruleset body array) held by
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
 *     Skipping only works where the store still HOLDS the earlier binding, which
 *     is why both stores keep per-name history: `declIndex` for scoped reads, and
 *     `BindingCell.prev` for live ones.
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
 * reflects the dynamic nesting — a Ruleset placement (`flatten`) and a mixin
 * expansion (`expandCall`) both seed the child frame's `statements` with the body
 * being walked — so an identity hit means we are inside that very ruleset. Mirrors
 * less@4's `mixin === context.frames[f]` check, scoped to ruleset-mixins.
 */
function parentExcludes(frame: Frame | null, rules: Statement[]): boolean {
  for (let f = frame; f; f = f.parent) {
    if (f.statements === rules) {
      return true;
    }
    if (f.fallback && parentExcludes(f.fallback, rules)) {
      return true;
    }
  }
  return false;
}

/**
 * The nearest last-wins binding for `name` (top of the nearest non-empty stack).
 * Used by the value-block / namespace paths that need the CURRENT value node
 * (e.g. to test for an `AnonymousMixin` / `Collection`); it does not honor exclusion
 * because those callers resolve a name to a concrete ruleset binding, not a lazy
 * self-referential value. The regular value read uses `resolveVarRef` instead.
 */
function lookupLiveCell(frame: Frame | null, name: string, e?: EvalCtx): { value: Binding; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    /* Newest binding first, then the ones it shadowed — the live-store twin of
     * `lookupScopedBinding`'s backward walk over the per-name declaration stack. */
    for (let hit: BindingCell | null | undefined = f.cells?.get(name); hit; hit = hit.prev) {
      if (!e?.excluded.has(hit.value)) {
        return { value: hit.value, frame: hit.valueFrame ?? f };
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  if (fb) {
    return lookupLiveCell(fb, name, e);
  }
  return undefined;
}

function hasExcludedLiveCell(frame: Frame | null, name: string, e: EvalCtx): boolean {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    for (let hit: BindingCell | null | undefined = f.cells?.get(name); hit; hit = hit.prev) {
      if (e.excluded.has(hit.value)) {
        return true;
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedLiveCell(fb, name, e) : false;
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

function hasExcludedLeakedBinding(frame: Frame | null, name: string, e: EvalCtx): boolean {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = f.leaked?.get(name);
    if (stack?.some(value => e.excluded.has(value))) {
      return true;
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedLeakedBinding(fb, name, e) : false;
}

function lookupScopedBinding(frame: Frame | null, name: string, e?: EvalCtx): { value: Binding; frame: Frame } | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const replacement = f.reassign?.get(name);
    if (replacement && (!e?.excluded.has(replacement.value))) {
      return { value: replacement.value, frame: f.bindingValueFrames?.get(replacement.value) ?? f };
    }
    const stack = (f.selectedDeclIndex ?? f.declIndex)?.byName.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const declaration = stack[i]!;

        /*
         * Non-declare writes live only in the activation overlay. Their source
         * facts stay indexed for provenance, but must not become final bindings
         * before the source-order write executes.
         */
        if (declaration.write.mode !== 'declare') {
          continue;
        }
        if (!e?.excluded.has(declaration.value)) {
          return { value: declaration.value, frame: f.bindingValueFrames?.get(declaration.value) ?? f };
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

function hasExcludedScopedBinding(frame: Frame | null, name: string, e: EvalCtx): boolean {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const replacement = f.reassign?.get(name);
    if (replacement && e.excluded.has(replacement.value)) {
      return true;
    }
    const stack = (f.selectedDeclIndex ?? f.declIndex)?.byName.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const declaration = stack[i]!;
        if (declaration.write.mode !== 'declare') {
          continue;
        }
        if (e.excluded.has(declaration.value)) {
          return true;
        }
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedScopedBinding(fb, name, e) : false;
}

/** {@link lookupVar} keeping the OWNING frame, for chain walks that must keep
 *  resolving in the scope each link came from rather than the scope they started in. */
function lookupVarIn(frame: Frame | null, name: string): { value: Binding; frame: Frame } | undefined {
  return lookupScopedBinding(frame, name)
    ?? lookupLiveCell(frame, name)
    ?? lookupLeakedBinding(frame, name);
}

function lookupVar(frame: Frame | null, name: string): Binding | undefined {
  return lookupVarIn(frame, name)?.value;
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
 * OWNING frame so it evaluates in its declaration scope.
 *
 * Both stores must therefore keep the EARLIER same-name bindings, or the skip has
 * nothing to land on. `scoped` reads get that from `declIndex`, a source-order
 * stack per name. `live` reads get it from `BindingCell.prev`; until that existed
 * a live cell was a single slot, so write `N` destroyed `N-1` and `$i: 3;
 * $i: $i - 1` reported a false `Recursive reference` — the read correctly skipped
 * its own node and then found nothing behind it. */
function resolveVarRef(frame: Frame | null, name: string, lookup: 'live' | 'scoped', e: EvalCtx): { value: Binding; frame: Frame } | undefined {
  return lookup === 'live'
    ? lookupLiveCell(frame, name, e)
    : lookupScopedBinding(frame, name, e) ?? lookupLeakedBinding(frame, name, e);
}

function hasExcludedVarRef(frame: Frame | null, name: string, lookup: 'live' | 'scoped', e: EvalCtx): boolean {
  return lookup === 'live'
    ? hasExcludedLiveCell(frame, name, e)
    : hasExcludedScopedBinding(frame, name, e) || hasExcludedLeakedBinding(frame, name, e);
}

function callValueContainsVarRef(value: CallValue, name: string, lookup: 'live' | 'scoped'): boolean {
  if (isValueSlotArray(value)) {
    return value.some(item => callValueContainsVarRef(item, name, lookup));
  }
  if (value.type === 'MixinCall') {
    return value.args.some(arg => callValueContainsVarRef(arg.value, name, lookup));
  }
  switch (value.type) {
    case 'Lookup':
      /* A direct `@x` matches by name; an indirect `@@x` recurses into the node
       * that NAMES the target, which is what the old VarIndirect arm did. */
      return typeof value.name === 'string'
        ? value.kind === 'var' && value.name === name && value.scope === lookup
        : callValueContainsVarRef(value.name, name, lookup);
    case 'Url':
      return callValueContainsVarRef(value.value, name, lookup);
    case 'Sequence':
      return value.parts.some(part => callValueContainsVarRef(part, name, lookup));
    case 'List':
      return value.value.some(part => callValueContainsVarRef(part, name, lookup));
    case 'Sequence':
      return value.parts.some(part => callValueContainsVarRef(part, name, lookup));
    case 'Important':
      return callValueContainsVarRef(value.value, name, lookup);
    case 'Operation':
      return callValueContainsVarRef(value.left, name, lookup)
        || callValueContainsVarRef(value.right, name, lookup);
    case 'FunctionCall':
      return value.args.some(arg => callValueContainsVarRef(arg.value, name, lookup));
    case 'Block':
      return callValueContainsVarRef(value.value, name, lookup);
    case 'Interpolation':
      return value.parts.some(part => 'ref' in part && callValueContainsVarRef(part.ref, name, lookup));
    case 'Reference':
      return callValueContainsVarRef(value.base, name, lookup)
        || value.steps.some((step) => {
          if (step.type === 'Call') {
            return step.args.some(arg => callValueContainsVarRef(arg.value, name, lookup));
          }
          return step.type === 'LookupStep' && typeof step.name !== 'string'
            && typeof step.name !== 'number'
            && callValueContainsVarRef(step.name, name, lookup);
        });
    case 'Range':
      return callValueContainsVarRef(value.start, name, lookup)
        || callValueContainsVarRef(value.end, name, lookup)
        || (value.step !== null && callValueContainsVarRef(value.step, name, lookup));
    case 'IfValue':
      /* Arm VALUES only, the same reach a `Condition` gets here: a guard tree is
       * not a value slot, so a self-reference inside one is out of this walk's
       * domain in both nodes alike. */
      return value.branches.some(branch => callValueContainsVarRef(branch.value, name, lookup));
    default:
      return false;
  }
}

/**
 * The same-activation binding a new live write for `node.name` SHADOWS.
 *
 * This is the live-store equivalent of v1's `declarationBucketsByName`
 * (`tree/scope-frame.ts:211`), the per-name source-order history v1 kept
 * ALONGSIDE its current-value map. v2 collapsed the live store to one slot per
 * name, which is what left the exclusion walk with nothing to fall back onto.
 *
 * A re-executed declaration in a SHARED frame (a control block re-entered by a
 * loop) presents the SAME value node again. Chaining a node to itself would only
 * add a link the exclusion walk skips anyway — identity is what exclusion tests —
 * so an unchanged head is not stacked. That keeps the chain bounded by the
 * DISTINCT declarations of a name, exactly as v1's buckets were, rather than by
 * iteration count.
 */
function liveCellPredecessor(
  cells: Map<string, BindingCell> | null,
  node: VariableDeclaration
): BindingCell | null {
  const existing = cells?.get(node.name);
  if (existing === undefined) {
    return null;
  }
  return existing.value === node.value ? existing.prev : existing;
}

function activateVariableDeclaration(node: VariableDeclaration, frame: Frame, e: EvalCtx): void {
  if (
    node.write.mode === 'declare'
    && callValueContainsVarRef(node.value, node.name, 'scoped')
    && withExcluded(e, node.value, () => resolveVarRef(frame, node.name, 'scoped', e)) === undefined
  ) {
    recursiveReference(node, `@${node.name}`, 'Variable', e);
  }
  bindDetached(frame, node.value, frame, sourceOwnerForBody(
    'type' in node.value && isValueBlock(node.value) ? valueBlockBody(node.value) : node,
    frame,
    e
  ));

  /*
   * [lambda-fn] A var bound to a CALLABLE lambda — one carrying `params` or
   * yielding a `result:` — is what the SCSS grammar lowers `@function f` to, and
   * it makes a bare `f(…)` call site mean "invoke this binding" rather than
   * "dispatch a builtin". Recording the name here is the whole recognition step:
   * an ordinary detached ruleset has neither params nor `result:`, so a Less
   * `@dr: { … }` never registers and its call path is untouched.
   */
  if (!isValueSlotArray(node.value) && node.value.type === 'AnonymousMixin'
    && (node.value.params !== undefined || lambdaResultValue(node.value.rules) !== undefined)) {
    (e.lambdaFunctionNames ??= new Set()).add(node.name);
  }
  if (node.write.mode === 'if-absent') {
    const found = node.write.scope === 'live'
      ? lookupLiveCell(frame, node.name)
      : lookupScopedBinding(frame, node.name, e);
    if (found) {
      return;
    }
    const cells = frame.cells ??= new Map();
    cells.set(node.name, { declaration: node, value: node.value, prev: liveCellPredecessor(cells, node) });
    (frame.reassign ??= new Map()).set(node.name, node);
    return;
  }
  if (node.write.mode === 'reassign') {
    if (node.write.scope === 'live') {
      const found = lookupLiveCell(frame, node.name);
      if (!found) {
        throw new ReferenceError(`live variable $${node.name} is undefined`);
      }
      const cells = found.frame.cells!;
      cells.set(node.name, { declaration: node, value: node.value, prev: liveCellPredecessor(cells, node) });
      return;
    }
    const found = lookupScopedBinding(frame, node.name, e);
    if (!found) {
      throw new ReferenceError(`scoped variable $^${node.name} is undefined`);
    }
    (found.frame.reassign ??= new Map()).set(node.name, node);
    return;
  }
  const cells = frame.cells ??= new Map();
  cells.set(node.name, { declaration: node, value: node.value, prev: liveCellPredecessor(cells, node) });
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
          /*
           * A declaration with an INTERPOLATED name — guard against re-entering it
           * while resolving the very property its own name interpolates (`${prop-name}`).
           */
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

            /*
             * The ordered timeline is also the merge-input order. A merge run
             * ends at the nearest non-merge / differently named declaration;
             * never reconstruct source text or create a synthetic value node.
             */
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

function hasExcludedPropRef(frame: Frame | null, name: string, e: EvalCtx): boolean {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const timeline = f.propertyTimeline;
    if (timeline) {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const { node } = timeline[i]!;
        if (typeof node.name === 'string' && node.name === name && e.excluded.has(node.value)) {
          return true;
        }
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedPropRef(fb, name, e) : false;
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
function evalBinding(b: Binding, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  return 'type' in b && b.type === 'MixinCall' ? literal('') : evalValueSlot(b, frame, e);
}

function unresolvedSymbol(node: object, symbol: string, e: EvalCtx): never {
  const file = e.context?.sourceContext?.file;
  const source = file?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  const location = source === undefined || span === undefined
    ? undefined
    : lineColAt(source, span.start, file);
  throw ERR.nameNotFound({
    node,
    filePath: file?.fullPath,
    source,
    line: location?.line,
    column: location?.column,
    meta: { symbol }
  });
}

function recursiveReference(node: object, symbol: string, kind: 'Variable' | 'Property', e: EvalCtx): never {
  const file = e.context?.sourceContext?.file;
  const source = file?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  const location = source === undefined || span === undefined
    ? undefined
    : lineColAt(source, span.start, file);
  throw ERR.recursiveReference({
    node,
    filePath: file?.fullPath,
    source,
    line: location?.line,
    column: location?.column,
    meta: { kind, symbol }
  });
}

/**
 * A {@link Lookup}'s target NAME. A plain `@x` carries it literally; an indirect
 * `@@x` carries the NODE whose resolved bytes name the target, which is the one
 * fact that used to justify a separate `VarIndirect` kind. Both paths land here,
 * so every caller reads one name and never re-derives the distinction.
 */
function lookupName(node: Lookup, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  return typeof node.name === 'string'
    ? node.name
    : mapMaybe(evalBytes(node.name, frame, e), raw => stripOuterQuotes(raw));
}

/**
 * A lookup's LITERAL name, for the synchronous paths. An indirect `@@x` cannot
 * resolve without evaluating its name node, which those paths cannot do — and
 * they never saw one before either, because only the string-named kinds reached
 * them. Empty string keeps the miss behaviour they already had.
 */
const literalName = (node: Lookup): string => typeof node.name === 'string' ? node.name : '';

function unresolvedRef(node: Lookup, name: string, e: EvalCtx): EvalValue {
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
  const path = call.path.map(segment => segment.selector).join(' ');
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
  return (v: ValueSlot) => evalBytes(v, frame, e);
}

/**
 * [R2/guards] A TYPED resolver: materializes a value node to a typed `Value`
 * (guard leaves compare typed values / call type-fns).
 *
 * This is a {@link MaybePromise} lane: a guard operand may name a value that
 * cannot be produced without awaiting (a `@plugin` function result). It is
 * returned UNWRAPPED when it is already settled, so the overwhelmingly common
 * synchronous guard costs nothing extra.
 */
function makeTypedResolver(frame: Frame | null, e: EvalCtx): TypedResolver {
  return (v: ValueSlot) => evalTypedSlot(v, frame, e);
}

/* ---------------------------------------------------- typed value eval */

/** The evaluator + modes carried through the value lane (a slim view of Emit). */
interface EvalCtx {
  ev: ValueEvaluator | null;
  modes: EvalModes;

  /** Context supplies document source only on genuine cold diagnostic paths. */
  context?: Context;

  /** Parser-owned source trivia for comment/spacing emission. */
  trivia?: TriviaMap;

  /*
   * [resolver] value nodes currently being evaluated (per-declaration cycle
   * guard). A backward stack walk `continue`s past any node in this set; it
   * accumulates down a sync descent and releases on sync-phase completion.
   */
  excluded: Set<Binding>;

  /*
   * [resolver] when true, a variable/lookup miss returns a sentinel instead of
   * throwing (`isdefined` / opt-in callers). Default (unset) is STRICT: miss
   * throws `ReferenceError`.
   */
  optional?: boolean;

  /*
   * [calc] `calc(…)` nesting depth. While > 0, dimension math is gated to the
   * safe-unit subset and cross-unit ops preserve as `calc(…)` sub-expressions.
   */
  calcDepth?: number;

  /**
   * Parenthesized AST value nesting enables Less arithmetic in paren modes.
   *
   * A BOOLEAN STACK, read via `.at(-1)`, not a counter. Entering a parenthesis
   * pushes `true`; entering a CALL pushes `false`, because a call's arguments
   * are not the caller's math context. A counter cannot express that: increment
   * and decrement can say "one level deeper", but they cannot say "disabled
   * here, then restore whatever the caller had, which may have been enabled".
   * The counter this replaced also had no decrement and no reset at all, so the
   * two defects were the same shape defect.
   */
  parenFrames?: readonly boolean[];

  /*
   * [condition-grammar] inside a `$( … )` computation boundary — the `Expression`
   * node. `.jess` has no `boolean()` (ledger P17), so `$( … )` is exactly where a
   * comparison legitimately lands in value position — while in `.less`/`.scss`
   * a `Condition` reaching the value lane is still the mis-parse the lane was
   * written for. Set only by `Expression`, which only jess parses, so the two
   * dialects that have no such boundary are untouched.
   */
  exprBoundary?: boolean;

  /*
   * [property-interp] declarations whose INTERPOLATED name (`${prop}: …` /
   * `@{v}: …`) is being resolved up-stack. `resolvePropRef` skips a candidate whose
   * name is already in flight, breaking the self-reference `${prop-name}: red` where
   * `prop-name`'s own accessor would otherwise re-enter this decl's name forever.
   */
  propNames: Set<Declaration>;

  /*
   * [important] Less `importantScope`: while resolving one declaration's value, an
   * `Important`-wrapped variable reference (`@v: @c !important`) sets `hit`, so the
   * enclosing declaration hoists a SINGLE trailing `!important`. Installed per
   * declaration by `putValue`; absent elsewhere (importance is meaningless outside
   * a declaration value, e.g. an at-rule prelude / interpolated name).
   */
  importantSink?: { hit: boolean };

  /*
   * [null] Per-declaration elision sink (§4.3). `evalBytes` sets `elided` when the
   * WHOLE value is `null`, so the declaration emitter can DROP the declaration
   * rather than write `b: ;`. Installed only around a declaration value; absent
   * everywhere else, where an empty value is not an absence.
   */
  elideSink?: { elided: boolean };

  /*
   * [important] Scalar equivalent of `importantSink` for a merged declaration
   * member. The merge path already owns one combined output line, so it carries
   * the signal on the existing emit state instead of allocating a sink per member.
   */
  mergeImportant?: boolean;

  /*
   * [default-fn] The `default()` value inside a guard OPERAND (`when (@x =
   * default())`): the mixin-dispatch decision (true iff no non-default def matched).
   * Set only on the ctx of a guard-operand typed resolver; absent everywhere else,
   * where `default()` emits verbatim (`case: default()` outside a guard).
   */
  defaultFn?: () => boolean;

  /*
   * [plugin/P1] Names registered by root or lexical plugin functions. Calls not
   * in this set take the flat evaluator registry path directly: no scope-view
   * allocation and no frame walk. The set is absent when no functions registered.
   */
  scopedFunctionNames?: Set<string>;

  /*
   * [lambda-fn] Names bound to a callable value lambda by this render — the
   * lowered SCSS user `@function`. A call whose name is absent is an ordinary
   * builtin/CSS call and skips the variable lookup entirely, so the set is the
   * same render-local gate `scopedFunctionNames` is for plugin functions. It is
   * ONLY a gate: whether the name is actually in scope at the call site is
   * decided by the ordinary lexical walk, never by membership here.
   */
  lambdaFunctionNames?: Set<string>;

  /** Render-local invalidation token for cached scoped-function parent links. */
  fnScopeVersion?: number;

  /*
   * [io] per-render file-read capability for the IO built-ins (`data-uri`/
   * `image-*`), forwarded to `ev.call` and thence to `FnCtx.io`. Set once at
   * top-level `serialize` from `SerializeOptions.io`; absent on renders with no
   * IO host wired (every value fn but the IO Tier-C set ignores it).
   */
  io?: FnIo;

  /*
   * [plugin/P2] driver-injected plugin runtime, threaded so nested frame
   * construction can register a scope-local `@plugin`'s functions. Absent on the
   * idle path (no plugins).
   */
  pluginHost?: PluginHost;

  /** Runtime-only lexical homes for mixin calls carried through an argument. */
  mixinCallHomes?: WeakMap<MixinCall, Frame>;
}

/** Force an internal eval value to a typed value node/group. A computed STRING carries no parse
 * tag → the evaluator sniffs (untagged fallback); an already-typed value passes through. */
function force(e: EvalCtx, v: EvalValue): ValueGroup {
  if (!isLiteral(v)) {
    return v;
  }
  if (!e.ev) {
    return { type: 'Keyword', text: v, bytes: v };
  }
  return e.ev.materialize(v);
}

function requireScalarValue(value: ValueGroup, reason: string): Value {
  if (isValueGroupArray(value)) {
    throw new TypeError(`${reason} requires a scalar value`);
  }
  return value;
}

/**
 * Materialize a value-literal LEAF node to a typed value node, driven by the node
 * `type` (task #44 — no side-car tag). Each typed leaf builds from its own fields
 * (`Color`/`Dimension`/`Quoted`), never re-classifying `src`; the opaque `Any` leaf
 * (alone) sniffs its bytes. When no evaluator is injected every leaf degrades to a
 * bare keyword of its `src` (the former `forceLiteral` no-`ev` behavior).
 */
function materializeNode(node: Keyword | Color | Dimension | Quoted | Any | Comment, e: EvalCtx): Value {
  const src = node.type === 'Comment' ? node.text : node.src;

  /*
   * `true` / `false` are BOOLEANS, not identifiers that happen to spell one.
   * Both dialect conditions lower to a comparison against `true` (§4.4.2), and
   * `boolean(…)` already mints a `Bool`, so an authored literal has to land on
   * the SAME value type or `@x: true` and `@x: boolean(1 > 0)` would answer the
   * same guard differently. `Bool` serializes to the same bytes, so nothing in
   * output position moves — and this sits ABOVE the no-evaluator early return
   * because what a literal IS does not depend on an evaluator being installed.
   */
  if (node.type === 'Keyword' && (src === 'true' || src === 'false')) {
    return makeBool(src === 'true');
  }
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
 * TYPED fold: materialize a value node to a typed value node/group for an OPERATED
 * / compared / typed-param position — sourcing the literal's TYPE from the parse
 * (the node's own `type`), NOT by re-classifying bytes. A typed leaf
 * (`Keyword`/`Color`/`Dimension`/`Quoted`) builds directly from its fields; the
 * opaque `Any` leaf sniffs. Variable refs / parens are transparent.
 */
function evalValueSlot(slot: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  if (!isValueSlotArray(slot)) {
    return evalValue(slot, frame, e);
  }

  /*
   * Less `math: 0` treats an authored top-level slash as arithmetic even when
   * the parser retained it as an adjacent ValueSlot array.  Promote only the
   * narrow, grammar-owned arithmetic shape here; ordinary space/slash values
   * (font shorthands, lists, nested groups) continue through the layout join
   * below.  The authored AST is immutable and no source bytes are inspected.
   */
  const promoted = promoteBareSlashValue(slot, e);
  if (promoted !== null) {
    return evalValue(promoted, frame, e);
  }

  /*
   * In Less's parens-division mode, a slash at this same authored boundary
   * keeps the whole scalar expression authored.  Evaluate parenthesized
   * children through their own `parenDepth`, but do not eagerly reduce a
   * neighboring `+`/`-` operation before the preserved slash is emitted.
   */
  const preserveBareSlash = (e.calcDepth ?? 0) === 0
    && e.modes.mathMode === 'parens-division'
    && hasTopLevelBareSlash(slot);
  const valueContext = preserveBareSlash
    ? { ...e, modes: { ...e.modes, mathMode: 'strict' as const } }
    : e;
  const values = slot.map(value => evalValueSlot(value, frame, valueContext));
  return combineAll(values, (resolved) => {
    const separators = valueLayoutOf(slot);

    /*
     * [null] An elided member takes its authored separator with it (§4.3), which
     * is why this is a skipping loop and not a `map().join()`: `b: 1px null 2px`
     * is `b: 1px 2px`, and `b: 1px, null, 2px` is `b: 1px, 2px` — one space and
     * one comma, not the two the dropped member's glue would leave behind.
     */
    let bytes = '';
    let empty = true;
    for (let index = 0; index < resolved.length; index += 1) {
      const item = resolved[index]!;
      if (!isLiteral(item) && isElided(item)) {
        continue;
      }
      if (!empty) {
        bytes += separators === undefined ? ' ' : separators[index - 1] ?? ' ';
      }
      bytes += emitValue(item);
      empty = false;
    }

    /*
     * Every member elided, so the WHOLE slot is absent — hand back the value, not
     * empty bytes, so the declaration emitter drops the declaration outright
     * (dart-sass: `$x: null; a { b: $x null }` emits nothing at all).
     */
    return empty && resolved.length > 0 ? NULL : literal(bytes);
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

  /*
   * Stay off the common adjacent-value path unless the grammar has already
   * exposed a top-level slash leaf.  Nested groups are deliberately ignored:
   * they have their own typed/list semantics and are not bare-slash facts.
   */
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

function evalTypedSlot(slot: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<ValueGroup> {
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
  return combineAll(values, resolved => resolved);
}

/**
 * The operation that produced a value whose unit CSS cannot express, kept so the
 * consuming boundary can report a SOURCE LOCATION for it.
 *
 * Recorded in every mode, not just `strict`. All three rungs of the §4.7 ladder
 * answer the same question at the same boundary — `strict` throws, `loose` and
 * `preserve` warn — so they need the same location.
 */
const unitOwners = new WeakMap<Value, Operation>();

function hasInvalidFinalUnits(value: Value): boolean {
  if (value.type !== 'Dimension') {
    return false;
  }
  const numerator = value.numerator ?? (value.unit ? [value.unit] : []);
  const denominator = value.denominator ?? [];
  return numerator.length > 1 || denominator.length > 0;
}

function rememberUnitOwner(value: Value, node: Operation): Value {
  if (hasInvalidFinalUnits(value)) {
    unitOwners.set(value, node);
  }
  return value;
}

function isOperationNode(node: object): node is Operation {
  return 'type' in node && node.type === 'Operation';
}

function arithmeticSiteLocation(node: object, e: EvalCtx): {
  filePath?: string; source?: string; line?: number; column?: number;
} {
  const location = callSiteLocation(node, e);
  if (!isOperationNode(node)) {
    return location;
  }
  const source = location.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  if (source === undefined || span === undefined) {
    return location;
  }
  const leftEndSlot = sourceEndOf(node.left);
  const rightStartSlot = sourceStartOf(node.right);
  const leftEnd = leftEndSlot === NO_SPAN ? span.start : leftEndSlot;
  const rightStart = rightStartSlot === NO_SPAN ? span.end : rightStartSlot;
  const searchStart = Math.max(span.start, leftEnd);
  const searchEnd = Math.min(span.end, rightStart);
  const operatorOffset = source.indexOf(node.operator, searchStart);
  if (operatorOffset < searchStart || operatorOffset >= searchEnd) {
    return location;
  }
  const operatorLocation = lineColAt(source, operatorOffset, e.context?.sourceContext?.file);
  return { ...location, line: operatorLocation.line, column: operatorLocation.column };
}

/**
 * §4.7 — NO RUNG OF THE `unitMode` LADDER IS SILENT. A value whose unit CSS
 * cannot express (`1px * 2px`, `1 / 2px`) warns in `loose` (which folds to Less
 * 4.x's dimensionally false answer) and in the default `preserve` (which says
 * the expression back as `calc(…)`); only `strict`, which throws, says nothing
 * extra. Silent preservation is the worst of the three: the author gets output
 * that looks fine and never learns the expression was meaningless.
 *
 * Raised at the CONSUMING BOUNDARY, beside the `strict` throw, rather than at
 * each operation. The three rungs are three answers to one question — "may this
 * value be emitted?" — and that question is only answerable about a FINAL value.
 * Asking it per-operation reports intermediates that the rest of the chain
 * resolves: `1px * 1px / 1px` is an honest `1px`, and warning about the `1px * 1px`
 * inside it is a false positive about an expression the author got right.
 */
function warnUnexpressibleUnit(value: Value, owner: object, e: EvalCtx): void {
  const site = unitOwners.get(value) ?? owner;
  e.context?.warn(WARN.unexpressibleUnit({
    node: site,
    ...arithmeticSiteLocation(site, e),
    meta: { expr: (value.type === 'Dimension' ? value.preserved : undefined) ?? value.bytes }
  }));
}

function throwUnitArithmetic(error: unknown, node: object, e: EvalCtx): never {
  if (error instanceof UnitArithmeticError) {
    throw ERR.invalidUnitArithmetic({
      node,
      ...arithmeticSiteLocation(node, e),
      meta: { reason: error.message }
    });
  }

  /*
   * A no-common-ground RELATIONAL comparison (`1px > red`) surfaces through the
   * same site as a unit clash: same operand position, same guard lane, so the
   * author gets the same structured error and location rather than a bare
   * TypeError out of the public API.
   */
  if (error instanceof IncomparableOperandsError) {
    throw ERR.incomparableOperands({
      node,
      ...arithmeticSiteLocation(node, e),
      meta: { reason: error.message }
    });
  }
  throw error;
}

/**
 * Run a guard evaluation so a comparison's unit clash surfaces as the SAME
 * structured error arithmetic raises.
 *
 * `dimensionCompare` throws `UnitArithmeticError` under `unitMode: 'strict'`, but
 * only the arithmetic path was wrapped — so `1px + 3em` produced a `JessError`
 * with `eval/invalid-unit-arithmetic` and a source location while `2px > 1em`
 * threw a bare `TypeError` with neither, straight out of the public API. Same
 * defect, two error contracts.
 */
function withUnitErrors<T>(node: object, e: EvalCtx, run: () => MaybePromise<T>): MaybePromise<T> {
  try {
    const result = run();
    return isThenable(result)
      ? result.then(value => value, error => throwUnitArithmetic(error, node, e))
      : result;
  } catch (error) {
    throwUnitArithmetic(error, node, e);
  }
}

function validateValueGroupUnits(
  value: ValueGroup,
  modes: EvalModes,
  owner: object,
  e: EvalCtx,
  demandExpressible: boolean
): void {
  if (isValueGroupArray(value)) {
    for (const item of value) {
      validateValueGroupUnits(item, modes, owner, e, demandExpressible);
    }
    return;
  }
  try {
    validateFinalUnits(value, modes, demandExpressible);
  } catch (error) {
    throwUnitArithmetic(error, unitOwners.get(value) ?? owner, e);
  }

  /*
   * §4.7 — the other two rungs, at the same boundary and on the same condition
   * `strict` throws on. `inCalc` is exempt: an operation the author WROTE inside
   * a math function is preserved because they asked for it (§4.6), not because
   * we declined to fabricate a unit, so there is nothing to report.
   *
   * A `demandExpressible` boundary has already thrown or passed, and it offers no
   * lenient rung to warn ABOUT — so it never reaches here.
   */
  if (!demandExpressible && modes.unitMode !== 'strict' && !modes.inCalc && hasInvalidFinalUnits(value)) {
    warnUnexpressibleUnit(value, owner, e);
  }
}

function evalTyped(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<ValueGroup> {
  switch (node.type) {
    /* An AUTHORED `null` — provenance explicit, so `null` and an unbound value
     * stay distinguishable downstream while remaining the same value. */
    case 'Null':
      return makeNull(true);
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Any':
    case 'Comment':
      return materializeNode(node, e);
    case 'Quoted':
      /*
       * `~'…'` / `~"…"` are Less escaped strings: typed arithmetic must see
       * their raw bytes just as ordinary value emission does.
       *
       * They land as `Any` — "opaque evaluated bytes produced by explicit
       * unquote APIs", which is what `e("…")` already produces — and NOT as a
       * `Keyword`. The two are not interchangeable once comparison has a ground
       * model (§4.1): an unquoted string carries a STRING ground against any
       * operand, while a `Keyword` is a bare identifier that shares no ground
       * with a number or a colour. Lowering `~"4"` to a Keyword made `5 > ~"4"`
       * and `1px > red` the same pair, and they are not.
       */
      return node.escaped ? makeAny(node.value) : materializeNode(node, e);
    case 'Url':
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
    case 'Lookup':
      /*
       * Only a VAR lookup resolves here. A `prop`/`entry` lookup falls through
       * to the default byte path, exactly as `PropertyReference` and
       * `DeclarationReference` did before they shared this kind.
       */
      if (node.kind !== 'var') {
        return mapMaybe(evalValue(node, frame, e), v => force(e, v));
      }
      return mapMaybe(lookupName(node, frame, e), (nm) => {
        const hit = resolveVarRef(frame, nm, node.scope, e);
        if (!hit) {
          if (hasExcludedVarRef(frame, nm, node.scope, e)) {
            recursiveReference(node, `@${nm}`, 'Variable', e);
          }
          return force(e, unresolvedRef(node, nm, e));
        }
        const bound = hit.value;
        return withExcluded(e, bound, () =>
          isMixinCallValue(bound)
            ? force(e, literal(''))
            : evalTypedSlot(bound, hit.frame, e));
      });
    case 'Reference': {
      /*
       * A typed guard comparison must retain the matched member's AST tag.
       * Falling through `evalValue` turns a typed `Keyword('true')` into an
       * untagged computed string before the value evaluator compares it.
       */
      const resolved = resolveReferenceResult(node, frame, e);
      if (resolved === null) {
        return force(e, literal(node.raw));
      }
      return isMixinCallValue(resolved.value)
        ? force(e, literal(node.raw))
        : evalTypedSlot(resolved.value, resolved.frame, e);
    }
    case 'Block':
      /*
       * A typed function argument still needs the surrounding-parenthesis math
       * context.  `round((@r / 3))` and `unit((4px * 4em / 2cm))` consume the
       * inner value through this path; dropping the paren frame made their
       * operations look like top-level parens-division math and left the whole
       * registered function call verbatim after its typed signature rejected it.
       */
      if (node.delimiter === 'square') {
        return mapMaybe(evalTypedSlot(node.value, frame, e), value => makeBlock(value, 'square', node.escaped));
      }

      /*
       * The paren IS the math frame and nothing else. It is consumed here, and
       * whatever the inner evaluated to is handed on UNCHANGED — in particular a
       * PRESERVED expression stays spelled `calc(…)`, which is the carrier the
       * value domain uses for one.
       *
       * This used to re-spell a `calc(…)` inner as a bare `(…)`, which threw that
       * carrier away. `operate`'s calc-splice guard (`value-operate.ts:410`)
       * recognizes `calc(…)` and nothing else, so the re-spelled operand fell
       * through to the un-operable-keyword guard (`:418`) and the operation came
       * back as RAW SOURCE with no math done — the paren consumed as a math
       * frame, the multiplication never composed:
       *
       *   (100% * 100%) * 2   ->   (100% * 100%) * 2      (half-evaluated)
       *    100% * 100%  * 2   ->   calc(100% * 100% * 2)  (correct)
       *
       * The inner paren was the only variable between those two, which is what
       * makes this the rewrite's defect and not the preserve rule's. Any mode
       * that preserves widens the input set that reaches it; the percentage
       * product is merely the one preserve already produced.
       */
      return evalTypedSlot(node.value, frame, { ...e, parenFrames: pushParenFrame(e, true) });
    case 'Collection':
      /*
       * A map reaching a TYPED position (a function argument, an operation) is
       * the value-domain map, not the bytes it renders to — that is the whole
       * point of the representation. Explicit rather than left to `default:`, so
       * a map argument can never silently regress to a sniffed keyword.
       */
      return evalCollection(node, frame, e);
    case 'List': {
      /*
       * A comma-list materializes to the value-domain `List`, its items materialized
       * LAZILY here (only now that the list is actually consumed typed — indexed by
       * `extract`, counted by `length`, or compared). The structure the parser owns
       * is handed to the value layer directly — no re-splitting a joined string.
       */
      const typed = node.value.map(it => evalTypedSlot(it, frame, e));
      return combineAll(typed, vals => makeList(vals, node.sep));
    }
    case 'Sequence': {
      /*
       * A structured SPACE-list (`@v: a b c` / `1px solid @c`) materializes to the
       * value-domain `List` with a space separator, so `extract` / `length` index
       * its structure directly (each part resolved) instead of re-splitting a joined
       * string. Typed consumption only — the emit path (`evalValue`) still joins the
       * parts to bytes, so an un-consumed space value serializes exactly as before.
       * EXCEPT a preserved-division slash group (`10px / 2`, built as a `Sequence`
       * `[left, '/', right]` by value-expr) is NOT a list — it is one arithmetic
       * value that must fold to bytes so an outer operation keeps it verbatim (guard
       * 3). Fall through to the joined-bytes path for it.
       */
      if (!isSlashGroup(node)) {
        const parts = node.parts.map(p => evalTyped(p, frame, e));
        return combineAll(parts, vals => vals);
      }
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
    }
    case 'FunctionCall':
      /*
       * Typed consumers deliberately bypass any direct-output preservation
       * policy. An operation or typed function argument needs the callable's
       * result, not its authored bytes.
       */
      return mapMaybe(evalCall(node, frame, e, true), v => force(e, v));
    case 'Condition':
      return mapMaybe(withUnitErrors(node, e, () => evalGuard(node.guard, guardDeps(frame, e))), makeBool);
    case 'IfValue':
      /* The taken arm is consumed TYPED — `if(@c, 1px, 2px) * 2` operates on the
       * branch value, not on its bytes. An unmatched chain has no value. */
      return mapMaybe(pickIfValue(node, frame, e), taken => taken === undefined
        ? NULL
        : evalTypedSlot(taken, frame, e));
    case 'Range':
      /*
       * Ranges are consumed structurally by `forItems`; a value-position use
       * retains authored range syntax rather than inventing a flattened list.
       */
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
    default:
      /*
       * Computed / joined shapes (Operation, FunctionCall, Sequence,
       * Interpolation, VarIndirect, Reference, …): fold to a Value then force. A
       * computed string has no parse tag → the evaluator sniffs.
       */
      return mapMaybe(evalValue(node, frame, e), v => force(e, v));
  }
}

/**
 * A preserved-division slash group — the `Sequence` `[left, '/', right]` that
 * value-expr builds for `a / b` when the division is kept verbatim (parens-division
 * math mode). It is ONE arithmetic value, not a space list, so it must NOT
 * materialize to a value-domain `List` (that would break an outer operation and
 * misreport `length`/`extract`). Detected by a top-level `/` literal part.
 */
function isSlashGroup(node: Sequence): boolean {
  /*
   * The direct Less grammar owns separator tokens as `Keyword` leaves; older
   * hand-built AST tests may still use opaque `Any`. Both are the same typed
   * slash fact here—never rediscover it from joined source bytes.
   */
  return node.parts.some(p => (p.type === 'Any' || p.type === 'Keyword') && p.src.trim() === '/');
}

/**
 * A Less variable may retain a glued top-level slash as the ordinary raw
 * `ValueSlot[]` shape (`50vh/2`).  That remains the public parser fact, but a
 * calc consumer still needs the same preserved-division interpretation as the
 * explicit spaced group.  Materialize only this temporary evaluator view; do
 * not change the authored AST or wrap ordinary arrays outside calc.
 */
function slashGroupOfSlot(slot: ValueSlot): Sequence | null {
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
  const node: Sequence = { type: 'Sequence', parts };
  const separators = valueLayoutOf(slot);
  return separators === undefined ? node : withValueLayout(node, separators);
}

/**
 * [calc] Reinterpret a preserved-division slash group (`[left, '/', right]`, and
 * left-associative chains `a / b / c`) as a left-nested division `Operation` so it
 * COMPUTES in a `calc(…)` math context. Returns `null` for a shape that is not a
 * clean `operand ('/' operand)+` chain (e.g. an interleaved space list carrying a
 * `/`), leaving it to fold verbatim. Each operand is a single part, or the run of
 * parts between two slashes wrapped back into a `Sequence`.
 */
function slashGroupToOperation(node: Sequence): Operation | null {
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
 * `and` / `or` in VALUE position (§4.5.5). They are NATIVE operators, not `fns/`
 * entries and not an `if(…)` rewrite: each returns one of its OPERANDS and
 * SHORT-CIRCUITS, so `$a or $default` is `$a` when truthy and the right operand
 * is never evaluated. That is why they cannot be a `FunctionCall` — an argument
 * list is evaluated before dispatch, and `false and (1px + 1em)` must not raise
 * the unit error its right operand carries (§3.4).
 *
 * The test is {@link isTruthy}, §4.4's ONE typed predicate — the same one the
 * `truth` guard uses. No dialect knowledge enters here: a dialect whose
 * truthiness differs lowers its OWN rule into a guard in its OWN grammar
 * (§4.4.2), exactly as `not` does.
 *
 * Unlike arithmetic these do not consult the math mode: there is no CSS value
 * meaning for the words `and` / `or` in this position to preserve, so there is
 * nothing for a `parens-division`-style guard to protect.
 */
function evalLogicalOperation(node: Operation, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  if (!e.ev) {
    // Fallback: un-evaluated, variable-resolved source assembly (no folding).
    const left = evalValue(node.left, frame, e);
    const right = evalValue(node.right, frame, e);
    return combineAll([left, right], values =>
      literal(`${emitValue(values[0]!)} ${node.operator} ${emitValue(values[1]!)}`));
  }
  const decidesLeft = node.operator === 'or';
  return mapMaybe(evalTyped(node.left, frame, e), left => isTruthy(left) === decidesLeft
    ? left
    : evalTyped(node.right, frame, e));
}

/*
 * A CSS escape sequence (css-syntax-3 §4.3.7): a backslash then either 1-6 hex
 * digits with an OPTIONAL single trailing whitespace that terminates them, or any
 * single non-hex code point that is not a newline. It is spelled here because a
 * `<custom-ident>` may contain one, and an escape can carry a code point — a
 * space, a dot, a leading digit — that would otherwise end the identifier:
 * `[a\ b]`, `[a\.b]` and `[\31 23]` are each ONE line name, not two and not
 * invalid. A predicate that misses this rejects valid CSS.
 */
const CSS_ESCAPE = String.raw`\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^0-9a-fA-F\n])`;
const IDENT = `(?:${CSS_ESCAPE}|[-_a-zA-Z\\u{80}-\\u{10FFFF}])(?:${CSS_ESCAPE}|[-\\w\\u{80}-\\u{10FFFF}])*`;
const WS = String.raw`[ \t\n\r\f]`;

/** `<line-names>` = `'[' <custom-ident>* ']'` — the interior, without the brackets. */
const LINE_NAMES = new RegExp(`^${WS}*(?:${IDENT}(?:${WS}+${IDENT})*${WS}*)?$`, 'u');

/**
 * Whether a bracketed value's inner bytes are PRINTABLE CSS (§12.6c).
 *
 * `[ … ]` is a first-class list: it may be bound, passed to a function, iterated,
 * indexed and measured, and none of that is constrained. But CSS admits `[ … ]`
 * in a value position for exactly ONE thing — grid line names, whose grammar is
 * `<line-names> = '[' <custom-ident>* ']'` (css-grid-2 §7.1). So `[a]`, `[a b]`
 * and `[]` say something in CSS and `[1, 2, 3]` does not. `*` is zero-or-more,
 * which is why `[]` is admitted.
 *
 * DELIBERATE UNDER-APPROXIMATION, with a stated bound. `<custom-ident>` excludes
 * the CSS-wide keywords, and `<line-names>` additionally excludes `span` and
 * `auto`, so `[span]`, `[auto]` and `[inherit]` are admitted here though CSS
 * rejects them. Under-accepting would reject valid stylesheets; over-accepting
 * only fails to catch an author error a browser will catch, and keeping the rule
 * to one identifier test is what the ruling asked for. It must never REJECT
 * something CSS accepts — that is the direction that matters, and why the escape
 * production above is spelled out rather than approximated.
 *
 * This is the ONE definition, applied where a bracketed VALUE becomes output —
 * the `Block` case of {@link evalValue}.
 *
 * It is deliberately NOT applied inside `serializeValue`. That function is the
 * value domain's general byte derivation, not a print site: function-argument
 * materialization runs through it, so a rule enforced there rejects
 * `length([1, 2])`, which the ruling permits. Measured, not assumed.
 *
 * It is deliberately NOT applied in the two AT-RULE PRELUDE formatters
 * (`evalSupportsPrelude`, `evalQueryPrelude`), which spell their own brackets.
 * Those positions preserve GRAMMAR-OWNED author bytes rather than emitting a
 * value — which is why they exist as separate formatters at all — and CSS
 * ACCEPTS what they carry: `@supports ([1, 2])` is a well-formed general-enclosed
 * condition that simply evaluates false, and a malformed media feature is a query
 * that evaluates to `not all`, not a parse error. Enforcing the rule there would
 * reject valid CSS, which is the one direction this predicate must never take.
 *
 * TODO(§12.6c residual), both recorded OPEN in the design doc:
 *   1. a bracketed list the value domain BUILDS rather than the author writing it
 *      — `join([1], [2])` — reaches output through `serializeValue` without
 *      passing this site, and still prints `[1 2]`;
 *   2. a bracketed list SPLICED from a variable into a prelude —
 *      `$x: [1, 2]; @media (min-width: $x)` — prints, while the same `$x` in a
 *      declaration errors. That one IS a positional inconsistency; closing it
 *      needs the prelude formatters to distinguish a spliced value from the
 *      author's own bytes, which they currently do not.
 */
const isLineNames = (bytes: string): boolean => LINE_NAMES.test(bytes);

/**
 * Fold a value AST node bottom-up to an internal eval value (a bare-string literal
 * for the static path, or a typed value node/group for a computed
 * operation/function). Lifts to `MaybePromise` only when a function call returns
 * a genuine thenable.
 */
function evalValue(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  switch (node.type) {
    /*
     * `null` is the ONE literal that does not emit its `src`: it emits nothing
     * and drops the separator that would follow it (§4.3 / ledger M5). It must
     * therefore leave this lane as a VALUE, not as bare bytes — the byte lane
     * has no way to spell "absent", and `literal('')` would leave the join glue
     * behind (`1px  2px`).
     */
    case 'Null':
      return makeNull(true);

    /*
     * Every value LITERAL is inert here: emit its verbatim `src` as a bare string,
     * except an escaped Less quote, whose value semantics intentionally unquote it.
     * CORRECTION 5 — return `literal(node.src)` (a BARE STRING), never the node
     * object: an AST literal node must not leak into the `EvalValue = ValueGroup | string`
     * lane (a downstream `v.type==='Color'` would misread it as a value object).
     */
    case 'Keyword':
    case 'Color':
    case 'Any':
    case 'Comment':

    /*
     * A selector CAPTURE `*[…]` reaching a plain VALUE position (never its intended
     * use — it belongs in a selector interpolation) emits its verbatim `src`.
     */
    case 'SelectorCapture':
      return literal(node.type === 'Comment' ? node.text : node.src);
    case 'Dimension':
      /*
       * Typed materialization owns Less's numeric spelling canonicalization
       * (`.3s` → `0.3s`) without a post-render CSS rewrite.
       */
      return e.ev ? dimensionFromFields(node.number, node.unit, node.src) : literal(node.src);
    case 'Quoted':
      return literal(node.escaped ? node.value : node.src);
    case 'Url':
      return mapMaybe(evalValue(node.value, frame, e), (value) => {
        /*
         * Quoting is syntax, not a URL-path inference problem. Preserve it
         * structurally while giving the owning plugin only the target bytes.
         */
        if (node.value.type === 'Quoted') {
          const target = e.context?.transformUrl(node.value.value, true) ?? node.value.value;

          /*
           * Less `~"…"` / `~'…'` is an escaped string value: inside a URL it
           * deliberately strips both the escape marker and its quote wrapper.
           * Keep that distinction on the existing typed Quoted node rather
           * than reconstructing or classifying its source bytes.
           */
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
    case 'Lookup': {
      /*
       * All four old reference kinds land here. `kind` is the discriminator that
       * used to be the node TYPE — `entry` was `DeclarationReference`, `prop` was
       * `PropertyReference`, `var` was `VariableReference`, and a `var` whose
       * `name` is a NODE is what `VarIndirect` (`@@x`) used to be.
       */
      if (node.kind === 'entry') {
        return literal(node.raw);
      }
      if (node.kind === 'var') {
        return mapMaybe(lookupName(node, frame, e), (nm) => {
          const hit = resolveVarRef(frame, nm, node.scope, e);
          if (!hit) {
            if (hasExcludedVarRef(frame, nm, node.scope, e)) {
              recursiveReference(node, `@${nm}`, 'Variable', e);
            }
            return unresolvedRef(node, nm, e);
          }
          return withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e));
        });
      }

      /*
       * A `$name` property accessor resolves the winning declaration and folds
       * its value. Its declaration-level `!important` is carried through the
       * caller's existing importance sink, so `$color` of `color: red !important`
       * yields `red !important` only at a declaration emission site.
       * A miss is a Less semantic error. `functionMode` applies only after a
       * registered function has actually been invoked and failed.
       */
      const propName = typeof node.name === 'string' ? node.name : '';
      const hit = resolvePropRef(frame, propName, e);
      if (!hit) {
        if (hasExcludedPropRef(frame, propName, e)) {
          recursiveReference(node, `$${propName}`, 'Property', e);
        }
        unresolvedSymbol(node, `$${propName}`, e);
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
          withExcluded(e, member.node.value, () => evalValueSlot(member.node.value, member.frame, e)));
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
    case 'Important':
      /*
       * [important] Less `importantScope`: the importance rides on this wrapper, NOT
       * the emitted bytes — signal the enclosing declaration (via the sink) and emit
       * the inner value with no inline `!important` (`@v: @c !important` → `#888`, the
       * declaration adds one `!important`). Absent a sink (importance-irrelevant
       * position), the inner value emits unchanged.
       */
      if (e.importantSink) {
        e.importantSink.hit = true;
      } else if (e.mergeImportant !== undefined) {
        e.mergeImportant = true;
      }
      return evalValueSlot(node.value, frame, e);
    case 'Sequence': {
      /*
       * Inside `calc(…)`, `/` is DIVISION (math), not a preserved slash separator:
       * a variable holding a preserved-division slash group (`@var: 50vh/2`) spliced
       * into calc must COMPUTE (`50vh / 2` → `25vh`) so an outer calc op keeps its
       * parens around the simplified operand (`calc(50% + (25vh - 20px))`). An inline
       * `50vh/2` written directly in calc already parses as an `Operation`; this makes
       * the variable-reference form fold identically.
       */
      const div = (e.calcDepth ?? 0) > 0 ? slashGroupToOperation(node) : null;
      if (div) {
        return evalValue(div, frame, e);
      }
      return joinSpacedBytes(node, frame, e);
    }
    case 'List': {
      /*
       * Emit each item's bytes joined by the canonical List separator fact. Source
       * spacing is canonical by default. When the parser retained an authored
       * newline/indent (or other output-bearing trivia) at an explicit List
       * boundary, replay that side-table run without adding a public `separators`
       * field to the semantic List shape. Inline comma spacing remains canonical
       * (`a,b` -> `a, b`); only a boundary containing a line break is replayed.
       */
      const items = node.value.map(it => evalValueSlot(it, frame, e));
      return combineAll(items, (vals) => {
        const glue = node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ';
        const authored = valueLayoutOf(node);

        /* [null] An elided item takes its separator with it (§4.3): dart-sass
         * emits `b: 1px, null, 2px` as `b: 1px, 2px`, with ONE comma. */
        let out = '';
        let empty = true;
        for (let index = 0; index < vals.length; index += 1) {
          const item = vals[index]!;
          if (!isLiteral(item) && isElided(item)) {
            continue;
          }
          if (!empty) {
            const separator = authored?.[index - 1];
            out += separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : glue;
          }
          out += emitValue(item);
          empty = false;
        }
        return empty && vals.length > 0 ? NULL : literal(out);
      });
    }
    case 'Block': {
      /*
       * Less `~(...)` retains its typed inner value for list operations but
       * escapes the delimiters at emission time.
       */
      if (node.escaped) {
        return evalValueSlot(node.value, frame, e);
      }
      const inner = evalValueSlot(node.value, frame, node.delimiter === 'paren'
        ? { ...e, parenFrames: pushParenFrame(e, true) }
        : e);

      /*
       * Transparent to computed bytes: a materialized (operated) inner strips the
       * paren (matching the legacy oracle); an un-forced literal keeps its parens.
       */
      return mapMaybe(inner, (v) => {
        if (isLiteral(v)) {
          if (node.delimiter === 'square' && !isLineNames(v)) {
            throw ERR.invalidLineNames({ node, ...callSiteLocation(node, e), meta: { bytes: v } });
          }
          const open = node.delimiter === 'square' ? '[' : '(';
          const close = node.delimiter === 'square' ? ']' : ')';
          return literal(`${open}${v}${close}`);
        }
        return node.delimiter === 'square' ? makeBlock(v, 'square', node.escaped) : v;
      });
    }
    case 'Expression':
      /*
       * A `$( … )` COMPUTATION BOUNDARY opens the math context but owns no output
       * delimiters — the `$(` and `)` are the marker, not a value's syntax. It stays
       * transparent even when the inner folds to bytes, which an authored group does
       * not (`$(foo)` -> `foo`, but `$((foo))` -> `(foo)`). `exprBoundary` marks the
       * position for a value-position `Condition` (§7.1).
       */
      return evalValueSlot(node.value, frame, { ...e, parenFrames: pushParenFrame(e, true), exprBoundary: true });
    case 'Condition':
      /*
       * [condition-grammar] Every construct that CONSUMES a condition — Less
       * `if`/`boolean`/`not`/`and`/`or`, Sass `if`, a guard — is lowered by its
       * own grammar into a guard tree (§4.5.3a), so a `Condition` reaching this value
       * lane is an UN-consumed condition — an ordinary/unknown call's arg that merely
       * happened to carry a top-level operator (e.g. a mis-parsed `url(…charset=utf-8…)`).
       * Emit it VERBATIM, exactly as it was spelled, rather than collapsing it to a bool.
       *
       * That premise holds for Less and Sass, where a comparison only ever appears
       * inside `boolean()`, `if()` or a guard. It is FALSE for `.jess`, which by
       * ledger P17 has no `boolean()` at all — so `$( … )` is exactly where a real
       * comparison lands, and "reached the value lane" cannot be the discriminator.
       * The `Expression` node marks that position (§7.1).
       */
      if (e.ev && e.exprBoundary) {
        return mapMaybe(withUnitErrors(node, e, () => evalGuard(node.guard, guardDeps(frame, e))), makeBool);
      }
      return literal(node.src);
    case 'Operation': {
      if (node.operator === 'and' || node.operator === 'or') {
        return evalLogicalOperation(node, frame, e);
      }
      if (!e.ev) {
        // Fallback: un-evaluated, variable-resolved source assembly (no math).
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], values =>
          literal(`${emitValue(values[0]!)} ${node.operator} ${emitValue(values[1]!)}`));
      }
      const mathMode = e.modes.mathMode ?? 'parens-division';

      /*
       * §4.6 — an operation AUTHORED inside a css-values-4 §10 math function
       * preserves its authorship: `calc($val / 2)` resolves the variable and
       * returns `calc(8px / 2)`, and `min(1em - 2px)` stays `min(1em - 2px)`
       * rather than collapsing to a dimensionally false `-1em`. `$( … )` is the
       * explicit opt-in to fold, which is why `calc($($val / 2))` still gives
       * `4px`.
       *
       * The flag is a parse-time POSITIONAL fact and NOT the whole rule. It
       * decides only that the fold is declined here; when it is absent,
       * `mathMode` decides whether math happens at all, and if it does,
       * `unitMode` decides whether a cross-unit pair folds, preserves as
       * `calc(…)`, or raises (§4.7). Three inputs, not one.
       *
       * This is the polarity AST v1 had (`OperationOptions.inCalc`, a
       * parse-time flag on the node, and an in-calc operation never operated).
       * v2 had it inverted: `calcDepth > 0` FORCED the operation and left
       * `value-operate` to decline.
       *
       * `calcDepth` survives BELOW the flag, and only there. The `.less` and
       * `.scss` grammars do not set `inMathFunction` yet — routing their math
       * names needs a per-dialect argument grammar, because in `.less` a `/`
       * inside a call is a list boundary rather than division — so for those
       * two dialects the ambient depth is still what marks a calc interior,
       * exactly as before. It is dominated by the flag, so a `.css`/`.jess`
       * operation never consults it.
       */
      const shouldOperate = !node.inMathFunction
        && ((e.calcDepth ?? 0) > 0
          || mathMode === 'always'
          || (e.parenFrames?.at(-1) ?? false)
          || (mathMode === 'parens-division' && node.operator !== '/'));
      if (!shouldOperate) {
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], (values) => {
          const bytes = `${emitValue(values[0]!)} ${node.operator} ${emitValue(values[1]!)}`;

          /*
           * An operation preserved because it was authored inside a math
           * function is ONE expression, not bytes to be re-sniffed. Handing
           * back a bare string sends it through `force`, which reads
           * `8px / 2` as a slash LIST — and a List is not a calc argument, so
           * `calc($val / 2)` came back as `8px / 2` with the wrapper dropped.
           * A Keyword is the same carrier `value-operate` already uses for a
           * preserved `calc(…)` sub-expression.
           */
          return node.inMathFunction ? makeKeyword(bytes) : literal(bytes);
        });
      }
      const ev = e.ev;

      // Operands are materialized TYPED (tag sourced from the parse), not re-sniffed.
      const l = evalTyped(node.left, frame, e);
      const r = evalTyped(node.right, frame, e);

      // Inside `calc(…)`, flag the modes so cross-unit math preserves (guard 3).
      const m: EvalModes = (e.calcDepth ?? 0) > 0 ? { ...e.modes, inCalc: true } : e.modes;
      return combineAll([l, r], (values) => {
        const lv = requireScalarValue(values[0]!, `operator ${node.operator}`);
        const rv = requireScalarValue(values[1]!, `operator ${node.operator}`);
        try {
          return rememberUnitOwner(ev.operate(node.operator, lv, rv, m), node);
        } catch (error) {
          throwUnitArithmetic(error, node, e);
        }
      });
    }
    case 'FunctionCall':
      return evalCall(node, frame, e, false);
    case 'IfValue':
      /* An unmatched chain (`$if` with no `$else`, or Less `if(@c, a)`) is empty
       * bytes, exactly what an absent value emits. */
      return mapMaybe(pickIfValue(node, frame, e), taken => taken === undefined
        ? literal('')
        : evalValueSlot(taken, frame, e));
    case 'Interpolation':
      return evalInterp(node, frame, e);
    case 'Reference':
      return evalReference(node, frame, e);
    case 'Range': {
      const values = [evalValue(node.start, frame, e), evalValue(node.end, frame, e)];
      if (node.step !== null) {
        values.push(evalValue(node.step, frame, e));
      }
      return combineAll(values, resolved => literal(`${emitValue(resolved[0]!)}${node.includeStart ? '' : '>'} to ${node.includeEnd ? '' : '<'}${emitValue(resolved[1]!)}${node.step === null ? '' : ` step ${emitValue(resolved[2]!)}`}`));
    }
    case 'AnonymousMixin':
      /*
       * An anonymous mixin reaching a value/arg position is not byte-serializable:
       * it can only be *called* (`@dr()`). less.js drops such an argument to an
       * ordinary function (`fn({…})` → `fn()`), so it folds to empty bytes here
       * rather than throwing. (Full `if()`/`isruleset()`/`isdefined()` DR handling —
       * which evaluates and can RETURN a detached ruleset — is the deferred
       * condition-grammar / FnCtx capability wave, not this path.)
       */
      return literal('');
    case 'Collection':
      return evalCollection(node, frame, e);
  }
}

/**
 * A {@link Collection} reaching a value/arg position — an SCSS map literal
 * (`$m: (a: 1, b: 2)`, lowered to a Collection at parse) passed to a function, or
 * the authorable Jess collection `$m: { a: 1; b: 2 }` — evaluates to the
 * value-domain map (`value-eval.ts` `Collection`). In declaration property-root
 * position, the same canonical node also represents SCSS nested-property
 * structure and is flattened before it reaches this value path.
 *
 * Producing a typed map (rather than the bytes it renders to) is what makes map
 * functions possible: a value-domain `Fn` receives the entries themselves. Its
 * `bytes` remain the CANONICAL Jess collection spelling `{ a: 1; b: 2 }` (`{}`
 * when empty), never the Sass paren-map syntax, which is SCSS *input* syntax the
 * parser lowers away — so every existing byte consumer is unmoved.
 *
 * Keys and values are evaluated as typed slots, so SCSS map keys keep the shape
 * they were authored with and nested maps stay maps rather than collapsing to
 * bytes.
 *
 * A `base` (the carrier's own value in the SCSS nested
 * property `font: 20px { … }`) is kept ahead of the block; that shape only reaches
 * here when the structural flatten did not run for it, and keeping it makes the
 * authored value visible instead of silently dropping it.
 */
function evalCollection(node: Collection, frame: Frame | null, e: EvalCtx): MaybePromise<Value> {
  const keys: Array<MaybePromise<ValueGroup>> = [];
  const values: Array<MaybePromise<ValueGroup>> = [];
  for (const entry of node.entries) {
    keys.push(evalTypedSlot(entry.key, frame, e));

    /*
     * A `@p: .mk-map()` binding is accessible/callable only and is not a value;
     * it folds to the same empty bytes every other binding read gives it.
     */
    values.push(isMixinCallValue(entry.value)
      ? force(e, literal(''))
      : evalTypedSlot(entry.value, frame, e));
  }
  if (node.base !== undefined) {
    values.push(evalTypedSlot(node.base, frame, e));
  }
  return combineAll([...keys, ...values], (resolved) => {
    const count = node.entries.length;
    const entries = node.entries.map((entry, index): ValueCollectionEntry => {
      const key = resolved[index]!;
      const value = resolved[count + index]!;
      return entry.important ? { key, value, important: true } : { key, value };
    });
    return makeCollection(entries, node.base === undefined ? undefined : resolved[count * 2]);
  });
}

/**
 * Resolve an interpolation template to bytes (literals + spliced refs).
 *
 * [null] The refs are folded TYPED and emitted here, rather than each being
 * folded straight to bytes: a template with no literal pieces whose every ref
 * elides is itself ABSENT, not empty bytes (§4.3, ledger M5). `.jess` reaches
 * this with `$( … )` — the grammar wraps the `Expression` computation boundary
 * in a single-ref `Interpolation`, so folding that ref to bytes here collapsed
 * `null` to `''` and the declaration emitted `k: ;` instead of dropping. This is
 * the same shape as the `List` and slot-array joins above, which already hand
 * back `NULL` when every member elided; the boundary is now transparent to
 * null-ness instead of a downstream re-check reconstructing it.
 *
 * A template WITH literal pieces is authored bytes around a splice (`"v${x}"`),
 * so it stays a literal: §4.3 measures `b: "v#{$x}"` as `b: "v"`, not a drop.
 */
function evalInterp(node: Interpolation, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  const pieces: Array<MaybePromise<EvalValue>> = [];
  for (const part of node.parts) {
    pieces.push('lit' in part ? part.lit : evalValue(part.ref, frame, e));
  }
  return combineAll(pieces, (values) => {
    let bytes = '';
    let elided = true;
    for (let index = 0; index < values.length; index += 1) {
      const part = node.parts[index]!;
      const value = values[index]!;
      if ('lit' in part) {
        elided = false;
        bytes += part.lit;
        continue;
      }
      if (isLiteral(value) || !isElided(value)) {
        elided = false;
      }

      /*
       * §4.7 — THE SAME BOUNDARY THE DECLARATION-VALUE PATH APPLIES (`evalBytes`).
       * Emitting a typed value to bytes IS consuming it, so this splice is a final
       * typed-value boundary in exactly the sense `validateFinalUnits` is written
       * over, and the `unitMode` ladder must answer here too: `strict` throws,
       * `loose`/`preserve` warn.
       *
       * UNLESS THE REF IS AN `Expression` — the `$( … )` computation boundary,
       * which DEMANDS an expressible result and consults no mode. See the note on
       * `demandExpressible` below.
       *
       * Without this the ladder was reachable only through a code path, not over a
       * construct (SEMANTIC-INVARIANTS 1), and one value printed different bytes in
       * different positions (invariant 2): `.scss` `k: 1px * 2px` threw under
       * `strict` and warned otherwise, while the `.jess` spelling of the very same
       * operation — `k: $(1px * 2px)`, which the grammar wraps in a single-ref
       * `Interpolation` — folded to bytes here and reached the boundary as an opaque
       * string, so it silently emitted `2px` in every mode. That is the ledger's
       * F7(b) hole, and §4.7's table is written in the `$( … )` spelling, so the
       * rung that throws had no reachable site at all.
       */
      /*
       * `unitMode` IS A LESS-COMPAT LEVER, AND `.jess` IS NOT ON THE LADDER.
       *
       * The scoping is carried by WHAT THE NODE SAYS, not by a dialect check: an
       * `Expression` ref IS the `$( … )` computation boundary (`nodes.ts` {@link
       * Expression}), which means "compute this and give me the value". When the
       * result has no CSS spelling there is no value to give, so the three rungs
       * have nothing to choose between — `loose`'s fabricated unit and
       * `preserve`'s `calc(…)` are both answers to a question the author did not
       * ask. It errors, and no mode is consulted.
       *
       * That statement mentions no dialect, yet it scopes `unitMode` out of
       * `.jess` EXACTLY, because `$( … )` is `.jess`'s ONLY arithmetic spelling
       * (ledger P13(d)) — the grammar makes bare `1px * 2px` a PARSE ERROR there,
       * so no `.jess` arithmetic can reach a boundary that would consult a mode.
       * `.less`/`.scss` are untouched: their grammars build `Expression` only
       * around a `condition(…)`, whose result is a Bool and never carries a unit.
       */
      if (!isLiteral(value)) {
        validateValueGroupUnits(value, e.modes, part.ref, e, part.ref.type === 'Expression');
      }
      const emitted = emitValue(value);
      bytes += part.unquote ? stripOuterQuotes(emitted) : emitted;
    }
    return elided && values.length > 0
      ? NULL
      : literal(resolveEmergentInterp(bytes, frame, e));
  });
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
 * clean `@{name}` whose variable resolves is replaced with its raw bytes; the
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
              out += stripOuterQuotes(emitValue(val));
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
 * A resolved map/namespace rules: its members split into Less's two DISJOINT
 * lookup namespaces — `byProp` (CSS declarations, read by a bare / `$name` key)
 * and `byVar` (`@var:` declarations, read by an `@name` key) — plus the ordered
 * member list for numeric-index access. The two maps never fall back to each other
 * (Less 4.x: `#ns[a]` errors when only `@a` exists).
 */
interface DeclMap {
  byVar: Map<string, DeclEntry>;
  byProp: Map<string, DeclEntry>;
  list: DeclEntry[];
  unified?: boolean;

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
  if (map.unified) {
    return map.byProp;
  }
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

    /*
     * Retain callable bindings as typed members so a later Reference Call step
     * can dispatch them; serialization still decides whether the final result
     * is renderable.
     */
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

/**
 * [loose-key] Value-equality rescan for a bracket key that no NAME matched.
 *
 * `byProp`/`byVar` are keyed by BYTE identity. That is the right O(1) fast path
 * and the wrong definition of "same key": `$foo['1px']` finds a `1px` member
 * today only by byte coincidence, and `$foo[1px]` against a `'1px'` member
 * misses outright (§1). Lookup is LOOSE — the same `=` the guards compare on —
 * so a quoted key and the value it spells name the same member.
 *
 * Fast path PLUS fallback, never a replacement: this is reached only after every
 * byte lookup has already missed, one step before the unresolved-symbol error,
 * so a hit still costs one map probe and a miss costs the scan it was going to
 * pay for with an error anyway. An O(n) scan cannot live on the hit path.
 *
 * The two namespaces stay DISJOINT (`#ns[a]` must not find `@a`): the rescan
 * walks the same map the byte lookup did, and only a `member` key sees both.
 */
function looseMemberLookup(
  map: DeclMap,
  key: string,
  kind: 'var' | 'prop' | 'member',
  e: EvalCtx
): DeclEntry | undefined {
  const ev = e.ev;
  if (!ev) {
    return undefined;
  }
  const wanted = ev.materialize(key);
  const scan = (candidates: Map<string, DeclEntry>): DeclEntry | undefined => {
    for (const [name, entry] of candidates) {
      if (name !== key && ev.compare('=', ev.materialize(name), wanted, e.modes)) {
        return entry;
      }
    }
    return undefined;
  };
  if (kind === 'member') {
    return scan(map.byProp) ?? (map.unified ? undefined : scan(map.byVar));
  }
  return scan(mapForKind(map, kind));
}

function resolveDeclarationMember(
  frame: Frame | null,
  name: string,
  e: EvalCtx
): DeclEntry | undefined {
  const prop = resolvePropRef(frame, name, e);
  const variable = resolveVarRef(frame, name, 'scoped', e);
  if (prop && variable) {
    throw new Error(`Ambiguous reference member: ${name}`);
  }
  if (prop) {
    return { name, value: prop.value, frame: prop.frame, important: prop.important };
  }
  return variable === undefined
    ? undefined
    : { name, value: variable.value, frame: variable.frame, important: false };
}

/** Collect a body's declarations into name→value maps (+ ordered list). */
function evalToDeclMap(statements: Statement[], frame: Frame | null, e: EvalCtx): DeclMap {
  recordMapPropertyTimeline(statements, frame);
  const byVar = new Map<string, DeclEntry>();
  const byProp = new Map<string, DeclEntry>();
  const list: DeclEntry[] = [];
  for (const s of statements) {
    /*
     * A map/namespace body member is either a CSS declaration (`text: white`,
     * read by property name / `$prop`, keyed in `byProp`) or a variable declaration
     * (`@color: blue`, read by `@var`, keyed in `byVar`). Each namespace is
     * source-order last-wins, mirroring Less's per-name last-declaration-wins.
     */
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

function recordCollectionPropertyTimeline(entries: readonly AstCollectionEntry[], frame: Frame | null, e: EvalCtx): void {
  if (!frame || frame.propertyTimeline !== undefined) {
    return;
  }
  for (const entry of entries) {
    const name = collectionEntryPropertyName(entry, frame, e);
    if (name !== null) {
      recordPropertyDeclaration(frame, decl(name, entry.value, entry.merge, entry.important), frame);
    }
  }
}

function collectionToDeclMap(node: Collection, frame: Frame | null, e: EvalCtx): DeclMap {
  recordCollectionPropertyTimeline(node.entries, frame, e);
  const byProp = new Map<string, DeclEntry>();
  const list: DeclEntry[] = [];
  for (const entry of node.entries) {
    const name = collectionEntryPropertyName(entry, frame, e);
    if (name === null) {
      continue;
    }
    const key = typeof name === 'string' ? name : evalBytesSync(name, frame, e);
    const mapped: DeclEntry = {
      name: key,
      value: entry.value,
      frame,
      important: entry.important
    };
    byProp.set(key, mapped);
    list.push(mapped);
  }
  return { byVar: new Map(), byProp, list, unified: true };
}

function recordMapPropertyTimeline(statements: readonly Statement[], frame: Frame | null): void {
  if (!frame || frame.propertyTimeline !== undefined) {
    return;
  }
  for (const statement of statements) {
    if (statement.type === 'Declaration') {
      recordPropertyDeclaration(frame, statement, frame);
    }
  }
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
  if (base.type === 'Collection') {
    return collectionToDeclMap(base, frame, e);
  }

  /*
   * A namespace / mixin-path base (`#ns.options`, `.alias`, `#library.add-one(1px)`)
   * is a `MixinCall`: dispatch it and treat its EMITTED members as the map. A plain
   * ruleset (`#ns1 {}`) dispatches as a zero-arg rule-mixin, so this one path serves
   * both namespace descents and single-segment ruleset/mixin bases.
   */
  if (base.type === 'MixinCall') {
    return frame ? declMapFromMixinCall(base, frame, e) : null;
  }

  /*
   * A `#namespace` / `.map` selector base → the union of matching rulesets' decls.
   * The base is an opaque selector fragment (`Any`) or a bare ident (`Keyword`).
   */
  if (base.type === 'Any' || base.type === 'Keyword') {
    const sel = base.src;
    for (let f = frame; f; f = f.parent) {
      const rules = f.rulesets !== undefined || f.statements ? frameRulesets(f)?.get(sel) : undefined;
      if (rules?.length) {
        const bodyFrame: Frame = {
          parent: f,
          mixins: null,
          declIndex: collectDeclIndex(rules.flatMap(r => r.rules)), cells: null, reassign: null
        };
        return evalToDeclMap(rules.flatMap(r => r.rules), bodyFrame, e);
      }
    }
    return null;
  }

  /*
   * Any other base resolves to a ruleset body through the shared resolver: a
   * direct value block (`AnonymousMixin` / `Collection`), a `@var` bound to one (or, transitively, to another
   * `@map[k]` accessor — the chained-accessor case `@scheme: @m[@k]; @scheme[@c]`),
   * or a `@map[k]` accessor whose matched member is a detached ruleset. Its body
   * decls (both `prop:` and `@var:` members, via `evalToDeclMap`) are the map.
   */
  const rs = resolveForRuleset(base, frame, e);
  if (rs) {
    const bodyFrame: Frame = {
      parent: rs.frame,
      mixins: collectMixins(rs.rules),
      declIndex: collectDeclIndex(rs.rules), cells: null, reassign: null
    };
    return evalToDeclMap(rs.rules, bodyFrame, e);
  }

  /*
   * A base `@var` bound to a mixin CALL (`@p: .mk-map(); @p[text]`): dispatch the
   * call and treat its EMITTED declarations as the map (the same reconstruction the
   * `each(.mixin(), …)` iterable uses — `forItemsFromMixinCall`).
   */
  if (base.type === 'Lookup' && base.kind === 'var' && frame) {
    const bound = lookupVar(frame, literalName(base));
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

  /*
   * Collect EVERY declaration (`forceLeading` → all decls to `collected`), discard
   * nested rules (they defer to `trailing`, which is never drained here).
   */
  const discard: Partition = {
    encounteredContainer: false,
    trailing: [],
    pending: [],
    emitBlock: noop
  };
  const varFrames: Frame[] = [];

  /*
   * A namespace/map base is resolved from a SYNCHRONOUS lookup, so the expansion
   * must have completed before its emitted members are read. Discarding an
   * awaitable expansion here would silently yield an EMPTY map — a wrong answer,
   * not a missing one.
   */
  settledExpansion(
    expandCall(call, null, null, frame, collected, noop, discard, em, false, true, varFrames),
    call,
    em
  );
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

/** The value yielded by a called value-lambda: the LAST top-level `result:`
 *  declaration in its body (the lowered form of an SCSS `@return`). A function
 *  has no early return — it is "a mixin whose final assignment to a property
 *  named `result` is its value" — so a later `result:` overrides an earlier one,
 *  exactly as a repeated declaration does everywhere else. A `result:` nested
 *  inside a `$if`/`@if`/`$for` branch is not surfaced here; only a top-level one
 *  yields. */
function lambdaResultValue(rules: Statement[]): ValueSlot | undefined {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const statement = rules[index]!;
    if (statement.type === 'Declaration' && statement.name === 'result') {
      return statement.value;
    }
  }
  return undefined;
}

/**
 * Invoke a value-position lambda ({@link AnonymousMixin} carrying `params`, e.g.
 * the lowered SCSS user `@function`) called as `$f(args)`. Binds args→params with
 * the SAME rules as a MixinDefinition call (positional/named/default/rest, via
 * {@link bindArgs}) — args resolve in the CALLER frame, param defaults in the
 * lambda's DEFINITION frame — then activates the body and returns the value of its
 * `result:` entry, evaluated later in the activation frame. Returns `null` when the
 * args cannot bind or the body yields no `result:` (caller falls back to `raw`).
 */
function invokeValueLambda(
  lambda: AnonymousMixin,
  args: CallArg[],
  defFrame: Frame | null,
  callerFrame: Frame | null,
  e: EvalCtx
): { value: ValueSlot; frame: Frame } | null {
  const syntheticDef: MixinDefinition = {
    type: 'MixinDefinition', name: '', params: lambda.params ?? [], rules: lambda.rules,

    /* a synthetic lambda wrapper carries no source position of its own */
    _s: NO_SPAN, _e: NO_SPAN, _bs: NO_SPAN, _be: NO_SPAN
  };
  const call: MixinCall = { type: 'MixinCall', name: '', args, path: [], important: false, content: null, _s: NO_SPAN, _e: NO_SPAN };
  const resolveCaller = makeResolver(callerFrame, e);
  const resolveDefault: DefaultResolver = (v, boundSoFar) => {
    const overlay: Frame = { parent: defFrame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    const b = evalBytes(v, overlay, e);
    if (isThenable(b)) {
      observeRejectedThenable(b);
      throw ERR.asyncInSyncPosition({
        node: v,
        ...callSiteLocation(v, e),
        meta: { where: 'lambda parameter default' }
      });
    }
    return b;
  };

  /*
   * A lambda is a first-class value: `$twice($inc, 1)` passes `$inc` BY REFERENCE
   * so the callee can call it, instead of byte-flattening the block to ''. This is
   * the same substitution a named mixin call already performs on its args.
   */
  const boundArgs = bindArgs(
    syntheticDef,
    callerFrame ? substituteClosureVarArgs(call, callerFrame) : call,
    resolveCaller,
    resolveDefault
  );
  if (isThenable(boundArgs)) {
    /*
     * TODO(maybe-promise-sync-islands): a value lambda is invoked from a
     * synchronous value position; binding its arguments cannot suspend yet.
     */
    observeRejectedThenable(boundArgs);
    throw ERR.asyncInSyncPosition({
      node: call,
      ...callSiteLocation(call, e),
      meta: { where: 'value-lambda argument binding' }
    });
  }
  const bindings = boundArgs;
  if (bindings === null) {
    throw ERR.arity({
      node: lambda,
      meta: { callee: 'function', expectedCount: syntheticDef.params.length, gotCount: args.length }
    });
  }
  const result = lambdaResultValue(lambda.rules);
  if (result === undefined) {
    throw ERR.invalidFunction({
      node: lambda,
      ...callSiteLocation(lambda, e),
      meta: { name: 'function', reason: 'its body assigns no `result:`, so the call has no value to yield' }
    });
  }
  const activation: Frame = {
    parent: defFrame,
    mixins: collectMixins(lambda.rules),
    declIndex: collectDeclIndex(lambda.rules, bindings),
    cells: cellsForParams(bindings),
    reassign: null,
    statements: lambda.rules,
    sourceOwner: defFrame ? sourceOwnerForBody(lambda.rules, defFrame, e) : null,
    ...(callerFrame && callerFrame !== defFrame ? { fallback: callerFrame } : {})
  };
  return { value: result, frame: activation };
}

function resolveReferenceResult(
  node: Reference,
  frame: Frame | null,
  e: EvalCtx
): { value: ValueSlot | MixinCall; frame: Frame | null; sourceOwner: object | null } | null {
  let value: ValueSlot | MixinCall = node.base;
  let valueFrame = frame;
  let sourceOwner = frame?.sourceOwner ?? null;
  if (!isValueSlotArray(value) && value.type === 'Lookup' && value.kind === 'var') {
    const resolved = resolveVarRef(valueFrame, value.name as string, value.scope, e);
    if (!resolved) {
      return null;
    }
    value = resolved.value;
    valueFrame = resolved.frame;
    sourceOwner = detachedBinding(valueFrame, value)?.sourceOwner
      ?? sourceOwnerForBody(!isValueSlotArray(value) && isValueBlock(value) ? valueBlockBody(value) : value, valueFrame, e);
  }
  for (const step of node.steps) {
    if (!isValueSlotArray(value) && value.type === 'Lookup' && value.kind === 'entry') {
      if (step.type !== 'LookupStep' || typeof step.name !== 'string') {
        return null;
      }
      const matched = resolveDeclarationMember(valueFrame, step.name, e);
      if (!matched) {
        unresolvedSymbol(node, step.name, e);
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
      continue;
    }
    if (step.type === 'Call') {
      if (isMixinCallValue(value)) {
        value = step.args.length === 0 ? value : { ...value, args: step.args };
        continue;
      }

      /*
       * A value bound to a callable lambda (`$f(args)`) — a param'd or paramless
       * `AnonymousMixin` that yields a `result:` — invokes: bind args→params, run
       * the body, yield `result:`. An `AnonymousMixin` WITHOUT a `result:` entry is
       * an ordinary detached ruleset (spliced elsewhere); leave it untouched so its
       * existing value-position behavior is preserved.
       * `$alias: $fn; $alias(1)` — a variable bound to another variable is still
       * the same callable. Follow the binding chain before deciding what a call
       * means, or the call silently becomes a no-op on the reference itself.
       */
      while (!isValueSlotArray(value)) {
        if (value.type === 'Lookup' && value.kind === 'var') {
          const aliased = resolveVarRef(valueFrame, value.name as string, value.scope, e);
          if (!aliased) {
            break;
          }
          value = aliased.value;
          valueFrame = aliased.frame;
          continue;
        }
        if (value.type === 'Reference') {
          const aliased = resolveReferenceResult(value, valueFrame, e);
          if (!aliased) {
            break;
          }
          value = aliased.value;
          valueFrame = aliased.frame;
          sourceOwner = aliased.sourceOwner ?? sourceOwner;
          continue;
        }
        break;
      }
      if (!isValueSlotArray(value) && value.type === 'AnonymousMixin'
        && (lambdaResultValue(value.rules) !== undefined || value.params !== undefined || step.args.length > 0)) {
        const invoked = invokeValueLambda(value, step.args, valueFrame, frame, e);
        if (invoked === null) {
          return null;
        }
        value = invoked.value;
        valueFrame = invoked.frame;
      }
      continue;
    }
    if (step.type === 'LookupStep' && typeof step.name !== 'string' && step.kind === 'index' && typeof step.name === 'number'
      && (isValueSlotArray(value) || (!isValueSlotArray(value) && (value.type === 'List' || value.type === 'Sequence')))) {
      const items = isValueSlotArray(value)
        ? value
        : value.type === 'List' ? value.value : value.parts;
      const index = step.name < 0
        ? items.length + step.name
        : step.indexBase === 0 ? step.name : step.name - 1;
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
    let missingSymbol = node.raw;

    /*
     * [loose-key] The KEY a value-equality rescan would use, captured by the
     * name-keyed branches only. See {@link looseMemberLookup} — this is the
     * fallback arm of a fast path, not a replacement for it.
     */
    let looseKey: string | undefined;
    let looseKind: 'var' | 'prop' | 'member' | undefined;
    if (step.type === 'LookupStep' && typeof step.name === 'string') {
      missingSymbol = step.name;
      looseKey = step.name;
      looseKind = 'member';
      const prop = map.byProp.get(step.name);
      const variable = map.unified ? undefined : map.byVar.get(step.name) ?? lookupVarMember(map, step.name, e);
      if (prop && variable) {
        throw new Error(`Ambiguous reference member: ${step.name}`);
      }
      matched = prop ?? variable;
    } else if (step.kind !== 'index' && typeof step.name !== 'number') {
      /*
       * `[@name]` names a variable member of the evaluated map/call result.
       * In particular, a mixin-call base must resolve `[@return]` from every
       * selected callee frame, rather than evaluating `@return` in the caller.
       * Other bracket keys remain dynamic value expressions in the current frame.
       */
      if (step.kind === 'var' && typeof step.name === 'object' && step.name.type === 'Lookup'
        && step.name.kind === 'var' && typeof step.name.name === 'string' && (
        value.type === 'MixinCall' || !resolveVarRef(valueFrame, step.name.name, step.name.scope, e)
      )) {
        const keyName = step.name.name;
        missingSymbol = `@${keyName}`;

        /*
         * A namespace/mixin-call accessor is a callee result: `#ns.m[@key]`
         * names that result's `@key` member even if the caller has an `@key`.
         * A detached map with no caller binding has the same member spelling;
         * only a bound caller key is a dynamic detached-map lookup.
         */
        matched = mapForKind(map, 'var').get(keyName) ?? lookupVarMember(map, keyName, e);
      } else if (step.kind === 'var' && typeof step.name === 'object' && step.name.type === 'Lookup'
        && step.name.kind === 'var' && typeof step.name.name === 'object') {
        /*
         * `[@@name]` is a map-variable indirection: evaluate only its first
         * lookup to obtain the member NAME, then read that named member from
         * this map/call result. Evaluating the VarIndirect value wholesale
         * would perform the second lookup in the caller and lose the map base.
         * `@@name` first resolves `@name` in the lexical accessor scope; only
         * its resulting bytes name a member of this map. The map owner can be a
         * root/detached closure while `@name` is an each/mixin-local binding.
         */
        const name = stripOuterQuotes(evalBytesSync(step.name.name, frame ?? valueFrame, e));
        missingSymbol = `@${name}`;
        matched = mapForKind(map, 'var').get(name) ?? lookupVarMember(map, name, e);
      } else if (step.kind === 'prop' && typeof step.name === 'object' && step.name.type === 'Lookup'
        && step.name.kind === 'prop' && typeof step.name.name === 'string') {
        const propKey = step.name.name;
        missingSymbol = `$${propKey}`;

        /*
         * In a map bracket, `$name` selects the property member named `name`.
         * It is not a `$name` read from the caller's declaration timeline.
         */
        matched = map.byProp.get(propKey);
      } else {
        const key = evalBytesSync(step.name as ValueNode, valueFrame, e);
        missingSymbol = step.kind === 'var'
          ? `@${key}`
          : step.kind === 'prop' ? `$${key}` : key;
        looseKey = key;
        looseKind = step.kind === 'member' ? 'member' : step.kind === 'prop' ? 'prop' : 'var';
        if (step.kind === 'member') {
          const prop = map.byProp.get(key);
          const variable = map.unified ? undefined : map.byVar.get(key) ?? lookupVarMember(map, key, e);
          if (prop && variable) {
            throw new Error(`Ambiguous reference member: ${key}`);
          }
          matched = prop ?? variable;
        } else {
          matched = mapForKind(map, step.kind === 'prop' ? 'prop' : 'var').get(key);
          if (!matched && step.kind === 'var') {
            matched = lookupVarMember(map, key, e);
          }
        }
        if (!matched && isIntegerString(key)) {
          const i = parseInt(key, 10);
          matched = map.list[i < 0 ? map.list.length + i : i - 1];
        }
      }
    } else {
      if (typeof step.name !== 'number') {
        return null;
      }
      const idx = step.name;
      const i = idx < 0 ? map.list.length + idx : idx - 1;
      matched = map.list[i] ?? (idx === -1 && map.list.length === 0 ? lastVarMember(map, e) : undefined);
      if (!matched) {
        return null;
      }
    }
    if (!matched && looseKey !== undefined && looseKind !== undefined) {
      matched = looseMemberLookup(map, looseKey, looseKind, e);
    }
    if (!matched) {
      unresolvedSymbol(node, missingSymbol, e);
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

function evalReference(node: Reference, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
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
 * inspect the BINDING (a value-block node) rather than materialize it.
 */
function resolveBindingNode(node: Binding, frame: Frame | null): Binding | undefined {
  let cur: Binding | undefined = node;
  const seen = new Set<Binding>();
  while (cur !== undefined && !isValueSlotArray(cur) && cur.type === 'Lookup' && cur.kind === 'var') {
    if (seen.has(cur)) {
      return undefined;
    } // cyclic
    seen.add(cur);
    cur = lookupVar(frame, literalName(cur));
  }
  return cur;
}

/**
 * `isdefined(@x)` / `isruleset(@x)`: detached-ruleset introspection that inspects
 * the BINDING without byte-materializing it (a value-block arg is not
 * value-serializable, and `isdefined` must swallow an unbound reference rather
 * than throw `@x is undefined`). Returns the `true`/`false` literal, or `undefined`
 * when `node` is not one of these calls (fall through to normal dispatch).
 */
function evalIntrospection(node: FunctionCall, frame: Frame | null): EvalValue | undefined {
  if (node.args.length !== 1) {
    return undefined;
  }
  const arg = node.args[0]!.value;
  if (node.name === 'isdefined') {
    /*
     * Defined iff the single argument resolves to a bound value. A non-`VariableReference`
     * argument (a literal / call) is inherently defined.
     */
    const bound = !isValueSlotArray(arg) && arg.type === 'Lookup' && arg.kind === 'var'
      ? resolveBindingNode(arg, frame)
      : arg;
    return literal(bound !== undefined ? 'true' : 'false');
  }
  if (node.name === 'isruleset') {
    const bound = resolveBindingNode(arg, frame);
    return literal(bound !== undefined && !isValueSlotArray(bound) && isValueBlock(bound)
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
function evalCalc(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  const ce: EvalCtx = { ...e, calcDepth: (e.calcDepth ?? 0) + 1 };
  return mapMaybe(evalTypedSlot(node.args[0]!.value, frame, ce), (v) => {
    if (!isValueGroupArray(v) && v.type === 'Keyword') {
      return calcInner(v.bytes) !== null ? v : makeKeyword(`calc(${v.bytes})`);
    }
    return v;
  });
}

/** CSS color constructors whose authored call is inert until a value consumer demands it. */
const DEFERRED_COLOR_CALLS = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
const DEFERRED_CSS_AUTHORED_CALLS = new Set(['linear-gradient']);

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
  const slot = node.args[0]!.value;
  return isValueSlotArray(slot) && slot.length >= 3;
}

function shouldPreserveCssAuthoredCall(node: FunctionCall, lessDocument: boolean): boolean {
  if (!lessDocument) {
    return false;
  }
  const lname = node.name.toLowerCase();
  return (DEFERRED_COLOR_CALLS.has(lname) && hasCssColorCallShape(node))
    || DEFERRED_CSS_AUTHORED_CALLS.has(lname);
}

/** Re-emit a call after resolving variable/interpolation bytes, without invoking its callable. */
function preserveCall(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  if (node.args.length === 0) {
    return literal(`${node.name}()`);
  }

  /*
   * A deferred call must retain literal spellings (`.5`, comma padding, hue
   * units) exactly. Disable typed literal canonicalization for this byte lane;
   * variable references still resolve through the same live frame walk.
   */
  const preserve = e.ev === null ? e : { ...e, ev: null };
  const items = node.args.map(a => evalValueSlot(a.value, frame, preserve));
  return combineAll(items, (vals) => {
    const authored = valueLayoutOf(node.args);
    const glue = node.modern ? ' ' : ', ';
    let inner = emitValue(vals[0]!);
    for (let index = 1; index < vals.length; index += 1) {
      const separator = authored?.[index - 1];

      /*
       * A deferred value-function is explicitly byte-faithful: replay every
       * parser-retained boundary, including ordinary spaces (`,` vs `, `).
       */
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

/**
 * The taken arm of a value-position `$if` chain (§4.5.3b), or `undefined` when
 * every guard is false and no `$else` arm was written.
 *
 * Guards are evaluated left-to-right and SHORT-CIRCUIT: only the selected arm's
 * value is ever evaluated, so the form is branch-lazy by construction rather
 * than by a special case in one built-in. The walk stays synchronous until a
 * guard actually needs to await.
 *
 * Every guard here arrives ALREADY LOWERED by the grammar that produced it
 * (§4.4.2) — `.less` compares against `true`, `.scss` excludes `false`/`null`,
 * `.jess` uses its own truth node. Core does not know, and must never learn,
 * which dialect the branch came from.
 */
function pickIfValue(node: IfValue, frame: Frame | null, e: EvalCtx): MaybePromise<ValueSlot | undefined> {
  const deps = guardDeps(frame, e);
  const step = (index: number): MaybePromise<ValueSlot | undefined> => {
    const branch = node.branches[index];
    if (branch === undefined) {
      return undefined;
    }
    const guard = branch.guard;
    if (guard === null) {
      return branch.value;
    }
    return mapMaybe(
      withUnitErrors(node, e, () => evalGuard(guard, deps)),
      taken => taken ? branch.value : step(index + 1)
    );
  };
  return step(0);
}

/**
 * Project one detached ruleset only for an opted-in legacy plugin call.  The
 * normal value evaluator deliberately keeps detached rulesets out of Value;
 * this is the one cold compatibility boundary that needs their declaration map.
 */
function pluginRawArgument(slot: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<PluginRawArgument> {
  if (isValueSlotArray(slot)) {
    return combineAll(slot.map(part => evalTypedSlot(part, frame, e)), values => values);
  }
  let binding: Binding = slot;
  let bindingFrame = frame;
  if (!isValueSlotArray(slot) && slot.type === 'Lookup' && slot.kind === 'var') {
    const hit = resolveVarRef(frame, literalName(slot), slot.scope, e);
    if (hit) {
      binding = hit.value;
      bindingFrame = hit.frame;
    }
  }
  return pluginDetachedProjection(binding, bindingFrame, e) ?? evalTypedSlot(slot, frame, e);
}

/**
 * The declaration-map projection of a value block, or `undefined` when the
 * binding is not block-like. Shared by argument projection and by the plugin
 * variable lookup, so a legacy plugin sees the same map shape either way.
 */
function pluginDetachedProjection(
  binding: Binding,
  bindingFrame: Frame | null,
  e: EvalCtx
): MaybePromise<PluginRawArgument> | undefined {
  const detached = resolveValueBlock(binding, bindingFrame, e);
  if (!detached) {
    return undefined;
  }
  const closure = detachedBinding(bindingFrame, detached);
  const definitionFrame = closure?.lexicalFrame ?? bindingFrame;
  const declarations: { declaration: Declaration; name: string }[] = [];
  for (const statement of valueBlockBody(detached)) {
    if (statement.type === 'Declaration' && typeof statement.name === 'string') {
      declarations.push({ declaration: statement, name: statement.name });
    }
  }
  const values = declarations.map(({ declaration }) => evalTypedSlot(declaration.value, definitionFrame, e));
  return combineAll(values, resolved => ({
    /*
     * The `DetachedRuleset` tag is the less.js-facing plugin transport name (external
     * Less plugins pattern-match `node.type === 'DetachedRuleset'`); it is NOT the AST
     * node and stays verbatim for compat.
     */
    type: 'DetachedRuleset' as const,
    rules: declarations.map(({ name }, index) => ({ name, value: resolved[index]! }))
  }));
}

/**
 * Resolve `@name` for a legacy plugin body against the LIVE frame chain at the
 * call site. Returns `null` for an unbound name (less.js's own answer) and for a
 * binding whose value is a mixin call, which has no value projection. This is
 * SYNCHRONOUS by contract: the plugin bridge reads scope inside a synchronous
 * function body, so a binding that would need to await cannot be served.
 */
function pluginVariableHit(name: string, frame: Frame | null, e: EvalCtx): PluginVariableHit | null {
  /*
   * A Less plugin names a variable WITH its sigil (`'@grid-breakpoints'`);
   * bindings are keyed without it.
   */
  const bare = name.startsWith('@') || name.startsWith('$') ? name.slice(1) : name;
  const hit = resolveVarRef(frame, bare, 'scoped', e)
    ?? resolveVarRef(frame, bare, 'live', e);
  if (!hit) {
    return null;
  }
  const projected = pluginDetachedProjection(hit.value, hit.frame, e);
  const resolved = projected ?? (isValueSlotArray(hit.value) || hit.value.type !== 'MixinCall'
    ? evalTypedSlot(hit.value, hit.frame, e)
    : undefined);
  if (resolved === undefined) {
    return null;
  }
  if (isThenable(resolved)) {
    observeRejectedThenable(resolved);
    return null;
  }
  return { value: resolved, important: false };
}

/**
 * The capability bundle handed to a legacy `@plugin` function. Unlike the
 * value-domain `FnCtx`, it is bound to this call's frame and source position so
 * the plugin can read scope, reach built-ins, and attribute its own logging.
 */
function pluginFnContext(node: FunctionCall, frame: Frame | null, e: EvalCtx): PluginCallCtx {
  const file = e.context?.sourceContext?.file;
  return {
    modes: e.modes,
    stringify: value => !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value),
    ...(e.io === undefined ? {} : { io: e.io }),
    lookupVariable: name => pluginVariableHit(name, frame, e),
    callFunction: (name, args) => {
      if (!e.ev) {
        return undefined;
      }
      const result = e.ev.call(name, makeList([...args], ','), e.modes, null, e.io);
      if (isThenable(result)) {
        observeRejectedThenable(result);
        return undefined;
      }
      return result;
    },
    currentFileInfo: {
      filename: file?.fullPath ?? '',
      entryPath: e.context?.entryFilePath ?? ''
    },
    log: record => reportPluginLog(node, record, e),
    markImportant: () => {
      if (e.importantSink) {
        e.importantSink.hit = true;
      } else if (e.mergeImportant !== undefined) {
        e.mergeImportant = true;
      }
    }
  };
}

/** Source position of a call node, for a diagnostic that points at the call site. */
function callSiteLocation(node: object, e: EvalCtx): {
  filePath?: string; source?: string; line?: number; column?: number;
} {
  const file = e.context?.sourceContext?.file;
  const source = file?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  const location = source === undefined || span === undefined ? undefined : lineColAt(source, span.start, file);
  return { filePath: file?.fullPath, source, line: location?.line, column: location?.column };
}

/**
 * Surface one `less.logger` record from a legacy plugin as a real diagnostic at
 * the call site. A plugin that reports a problem must not do so into a void.
 */
function reportPluginLog(node: FunctionCall, record: { level: string; message: string }, e: EvalCtx): void {
  if (record.level !== 'warn' && record.level !== 'error') {
    return;
  }
  e.context?.warnAtNode('plugin/log', 'plugin', node, {
    name: node.name,
    level: record.level,
    message: record.message
  });
}

function needsPluginRawArguments(args: readonly ValueSlot[], frame: Frame | null, e: EvalCtx): boolean {
  for (const arg of args) {
    if (isValueSlotArray(arg)) {
      return true;
    }
    let binding: Binding = arg;
    let bindingFrame = frame;
    if (arg.type === 'Lookup' && arg.kind === 'var') {
      const hit = resolveVarRef(frame, literalName(arg), arg.scope, e);
      if (hit) {
        binding = hit.value;
        bindingFrame = hit.frame;
      }
    }
    if (resolveValueBlock(binding, bindingFrame, e)) {
      return true;
    }
  }
  return false;
}

/**
 * [lambda-fn] A bare `f(args)` naming a var bound to a callable lambda (the
 * lowered SCSS user `@function`) IS an invoke of that binding, and shadows any
 * builtin of the same name. Resolution is the ordinary lexical walk, so a
 * function called outside the block that defined it simply does not resolve —
 * this returns `undefined` and the call falls through to normal dispatch,
 * emitting its authored bytes like any other unknown function.
 */
function evalLambdaCall(
  node: FunctionCall,
  frame: Frame | null,
  e: EvalCtx
): MaybePromise<EvalValue> | undefined {
  const hit = resolveVarRef(frame, node.name, 'live', e);
  if (!hit || isValueSlotArray(hit.value) || hit.value.type !== 'AnonymousMixin') {
    return undefined;
  }
  const lambda = hit.value;
  if (lambda.params === undefined && lambdaResultValue(lambda.rules) === undefined) {
    return undefined;
  }
  const invoked = invokeValueLambda(lambda, node.args, hit.frame, frame, e);
  return invoked === null ? undefined : evalValueSlot(invoked.value, invoked.frame, e);
}

function evalCall(
  node: FunctionCall,
  frame: Frame | null,
  e: EvalCtx,
  demanded = false
): MaybePromise<EvalValue> {
  /*
   * [lambda-fn] Checked before every other dispatch policy so a user `@function`
   * shadows builtins, CSS-authored-call preservation, and the introspection
   * forms alike — the same precedence the parse-time call-site rewrite had.
   * Gated on the render-local name set, so a document defining no user function
   * pays one `Set.has` and never walks a frame.
   */
  if (e.lambdaFunctionNames?.has(node.name)) {
    const invoked = evalLambdaCall(node, frame, e);
    if (invoked !== undefined) {
      return invoked;
    }
  }

  /*
   * [default-fn] `default()` inside a guard operand (`when (@x = default())`) folds to
   * the dispatch decision. Only when a `defaultFn` is in scope (a guard-operand typed
   * resolver); elsewhere `default()` is meaningless and falls through to emit verbatim.
   */
  if (e.defaultFn && node.args.length === 0 && node.name.toLowerCase() === 'default') {
    /*
     * `default()` in a comparison is a BOOLEAN, and an authored `true`/`false`
     * literal now materializes as one too, so `@x: false` still compares
     * structurally with `default()` when a non-default candidate already matched.
     */
    return makeBool(e.defaultFn());
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
    const items = node.args.map(a => evalValueSlot(a.value, frame, e));
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

  /*
   * CSS-shaped color constructors are optional CSS value calls in a bare value
   * slot. Preserve their authored bytes until a typed consumer (operation/
   * function argument) explicitly demands a value; this prevents an installed
   * native Less function from eagerly round-tripping and mangling the call
   * spelling. One-/two-slot calls are deliberately *not* deferred: Less owns
   * those overloads, and malformed forms must reach the call-level
   * functionMode policy instead of leaking authored invalid output.
   */
  const lessDocument = e.context?.sourceContext?.plugin?.supportedExtensions?.includes('.less') === true;
  if (!demanded && shouldPreserveCssAuthoredCall(node, lessDocument)) {
    return preserveCall(node, frame, e);
  }
  const ev = e.ev;

  /*
   * [plugin/P1] Only a call whose normalized name occurs in a registered-fn set
   * can require lexical resolution. CSS calls and built-ins bypass frame walking
   * entirely; a matching name is resolved once and passed directly to `ev.call`.
   */
  const selected = e.scopedFunctionNames?.has(lname)
    ? lookupScopedFn(frame, lname, e)
    : undefined;
  const rawInvoker = e.pluginHost?.invokeRawFunction;

  /*
   * A function registered by this document (`@plugin`/`@use`) is USER CODE, so it
   * always runs on the legacy seam: it needs raw arguments (a detached ruleset
   * survives as a declaration map) and the live-frame capabilities. `undefined`
   * from the host means "not mine", which falls back to ordinary dispatch.
   */
  if (selected && rawInvoker) {
    const raw = node.args.map(arg => pluginRawArgument(arg.value, frame, e));
    return combineAll(raw, (args) => {
      try {
        const result = rawInvoker(selected, args, pluginFnContext(node, frame, e));
        const settled = isThenable(result)
          ? result.catch((error: unknown) => pluginCallFailure(node, error, frame, e))
          : result;
        if (isThenable(settled)) {
          observeRejectedThenable(settled);
        }
        return mapMaybe(settled, value => value === undefined
          ? evalCall(node, frame, { ...e, pluginHost: undefined }, demanded)
          : value);
      } catch (error) {
        return pluginCallFailure(node, error, frame, e);
      }
    });
  }

  // Args are materialized TYPED (each arg's tag sourced from its parse node).
  const typed = node.args.map(a => evalTypedSlot(a.value, frame, e));
  return combineAll(typed, (vals) => {
    const ordered = orderKeywordArgs(node.args, vals, ev, node.name, selected);
    const args: ValueGroup = sep === ',' ? makeList(ordered, ',') : ordered;
    try {
      const result = ev.call(node.name, args, e.modes, null, e.io, selected);
      return isThenable(result)
        ? result.catch(error => invalidFunctionCall(node, error, e))
        : result;
    } catch (error) {
      return invalidFunctionCall(node, error, e);
    }
  });
}

/**
 * Place KEYWORD arguments at the positions their names DECLARE.
 *
 * A keyword argument (`fade(@c, @amount: 50%)`, `color.adjust($c, $lightness: -10%)`)
 * states a BINDING, not a position, and the only place that mapping exists is the
 * callee's own parameter list — so the order comes from the resolved function
 * ({@link ValueEvaluator.paramNames}), never from the call site.
 *
 * Returns `vals` UNCHANGED when nothing was named, so an ordinary positional
 * call pays one `name !== undefined` test per argument and allocates nothing.
 *
 * It also returns `vals` unchanged when the callee declares no parameter by that
 * name (or is unknown): the call then reaches dispatch with exactly its authored
 * argument vector and fails — or preserves — as an ordinary argument-shape
 * mismatch. Guessing a position for a name the definition never declared is the
 * silent wrong lowering this exists to prevent.
 */
function orderKeywordArgs<T>(
  args: readonly CallArg<ValueSlot>[],
  vals: T[],
  ev: ValueEvaluator,
  name: string,
  scopedFn: Fn | undefined
): T[] {
  let hasName = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.name !== undefined) {
      hasName = true;
      break;
    }
  }
  if (!hasName) {
    return vals;
  }

  const params = ev.paramNames(name, scopedFn);
  if (params === undefined) {
    return vals;
  }

  const slots = new Array<T | undefined>(params.length);
  const positional: T[] = [];
  for (let i = 0; i < args.length; i++) {
    const argName = args[i]!.name;
    if (argName === undefined) {
      positional.push(vals[i]!);
      continue;
    }
    const at = params.indexOf(argName);
    if (at === -1) {
      return vals;
    }
    slots[at] = vals[i]!;
  }

  /* Positional arguments keep their authored order and fill the slots the
   * keywords did not claim — Less and Sass both allow the two forms to mix. */
  const out: T[] = [];
  let next = 0;
  for (let at = 0; at < slots.length; at++) {
    const bound = slots[at];
    if (bound !== undefined) {
      out.push(bound);
    } else if (next < positional.length) {
      out.push(positional[next++]!);
    }
  }
  for (; next < positional.length; next++) {
    out.push(positional[next]!);
  }
  return out;
}

/**
 * A `@plugin`/`@use` function FAILED — it threw, or the sandbox could not run
 * it. That is a fault in user-supplied code, categorically different from a
 * built-in that merely declines an argument shape, and it must never be
 * swallowed into a verbatim re-emission with nothing said.
 *
   * In fail-fast mode it aborts with the function name, the underlying throw,
   * and the call site. Under `breakOnError: false`, `functionMode: 'error'`
   * records the same diagnostic as a collected error and preserves the call so
   * "keep compiling" never means "say nothing".
 */
function pluginCallFailure(
  node: FunctionCall,
  error: unknown,
  frame: Frame | null,
  e: EvalCtx
): MaybePromise<EvalValue> {
  if (error instanceof JessError) {
    throw error;
  }
  const reason = error instanceof JessError
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error);
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined;

  /*
   * `breakOnError` is the render-level "stop at the first real problem" switch,
   * and a plugin fault IS a real problem: it aborts unless the caller explicitly
   * opted into collecting failures instead (`breakOnError: false`).
   */
  if (e.context?.opts.breakOnError !== false) {
    throw ERR.pluginFunctionThrew({
      node,
      ...callSiteLocation(node, e),
      ...(stack === undefined ? {} : { note: stack }),
      meta: { name: node.name, reason }
    });
  }
  if (e.modes.functionMode === 'error') {
    const diagnostic = ERR.pluginFunctionThrew({
      node,
      ...callSiteLocation(node, e),
      ...(stack === undefined ? {} : { note: stack }),
      meta: { name: node.name, reason }
    });
    const collected = toDiagnostic(diagnostic);
    if ('errors' in collected) {
      e.context.errors.push(collected);
    } else {
      e.context.warn(collected);
    }
    return preserveCall(node, frame, e);
  }
  e.context?.warnAtNode('plugin/function-threw', 'plugin', node, {
    name: node.name,
    reason
  }, stack === undefined ? undefined : { note: stack });
  return preserveCall(node, frame, e);
}

function invalidFunctionCall(node: FunctionCall, error: unknown, e: EvalCtx): never {
  if (error instanceof JessError) {
    throw error;
  }
  const reason = error instanceof JessError
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error);
  throw ERR.invalidFunction({
    node,
    ...callSiteLocation(node, e),
    meta: { name: node.name, reason }
  });
}

/**
 * Emit a parser-owned {@link Sequence} without rediscovering its authored layout.
 * The default join is one space; an authored boundary run is replayed from the
 * `withValueLayout` side table, never from a field on the node.
 */
function joinSpacedBytes(node: Sequence, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  const authored = valueLayoutOf(node);
  const items = node.parts.map(part => evalValue(part, frame, e));
  return combineAll(items, (values) => {
    let out = emitValue(values[0]!);
    for (let index = 1; index < values.length; index++) {
      out += authored?.[index - 1] ?? ' ';
      out += emitValue(values[index]!);
    }
    return literal(out);
  });
}

/** Fold a value node and return its emitted bytes. */
function evalBytes(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  /*
   * [null] Captured SYNCHRONOUSLY: on the async lane the fold below resolves long
   * after the installing site restored `e.elideSink`, so reading it at resolution
   * time would report the wrong declaration's elision (or none).
   */
  const elideSink = e.elideSink;
  return mapMaybe(evalValueSlot(node, frame, e), (value) => {
    if (!isLiteral(value)) {
      validateValueGroupUnits(value, e.modes, Array.isArray(node) ? (node[0] ?? {}) : node, e, false);
      if (elideSink !== undefined && isElided(value)) {
        elideSink.elided = true;
      }
    }
    return emitValue(value);
  });
}

/**
 * Fold a value node to bytes for an INTERPOLATION splice. A spliced number gets the
 * SAME digits as a declaration value: one policy for every computed number, whatever
 * position it lands in. (This used to emit a computed dimension at full double
 * precision, so `@x: pi()` printed `3.14159265` in a value and `3.141592653589793`
 * spliced — a less.js eval-time implementation accident, not a CSS rule.)
 *
 * Still distinct from {@link evalBytes} in ONE way that is NOT precision and was NOT
 * decided here: it takes a `ValueNode` through `evalValue` rather than a `ValueSlot`
 * through `evalValueSlot`, so authored slot layout is not preserved. That is ledger
 * row F7(a), still OPEN, in docs/architecture/core/DESIGN-DECISIONS.md.
 *
 * F7(b) — the unit boundary — is CLOSED, but not here: {@link evalInterp} applies
 * `validateValueGroupUnits` at the splice, where a ref's typed value is emitted to
 * bytes. That is the position the hole lived in, since the `.jess` `$( … )`
 * computation boundary is a single-ref `Interpolation`. A ref that is NOT an
 * interpolation reaches this function as an already-folded value, so it carries no
 * unit multiset to validate.
 */
function evalBytesInterp(node: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  return mapMaybe(evalValue(node, frame, e), emitValue);
}

/** Bytes for a synchronous position (at-rule prelude); async there is out of scope. */
/**
 * Byte evaluation for the positions still confined to the synchronous lane —
 * chiefly the IMPORT REQUEST path (specifier, options, media tail), whose result
 * feeds path resolution and the extend preflight before any emission happens.
 *
 * TODO(maybe-promise-import-lane): move the import request path onto the
 * awaitable lane so `@import "@{computed}"` and a computed media tail work.
 * Tracked in docs/architecture/core/HANDOFF.md.
 */
function evalBytesSync(node: ValueSlot, frame: Frame | null, e: EvalCtx): string {
  const b = evalBytes(node, frame, e);
  if (isThenable(b)) {
    observeRejectedThenable(b);
    throw ERR.asyncInSyncPosition({
      node,
      ...callSiteLocation(node, e),
      meta: { where: 'import request / synchronous byte position' }
    });
  }
  return b;
}

/** As {@link evalBytesSync}, for the media tail of an import request. */
function evalQueryPreludeSync(node: ValueSlot, frame: Frame | null, e: EvalCtx): string {
  const value = evalQueryPrelude(node, frame, e);
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw ERR.asyncInSyncPosition({
      node,
      ...callSiteLocation(node, e),
      meta: { where: 'import request media tail' }
    });
  }
  return value;
}

/* ---------------------------------------------------- selector composition */

/**
 * [nesting] LEGACY cartesian `&` expansion, retained ONLY for the exotic
 * quoted-selector-interpolation parent that carried a top-level comma into a single
 * parent branch (`composeOne`/`composeHeader` route the normal multi-parent case
 * through `resolveComplexAmp`, which is position-aware and spec-faithful). Each `&`
 * is its own odometer digit with the LEFTMOST `&` most-significant.
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
  if (ref.type !== 'Lookup' || ref.kind !== 'var') {
    return null;
  }
  const hit = resolveVarRef(frame, literalName(ref), ref.scope, e);
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
function simpleGroupInterp(sim: SimpleToken, frame: Frame | null, e: EvalCtx): GroupInterp | null {
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
function loneGroupInterp(c: SelectorBranch, frame: Frame | null, e: EvalCtx): GroupInterp | null {
  if (c.type === 'RelativeSelector') {
    return null;
  }
  const terms = selectorBranchTerms(c);
  if (terms.length !== 1 || selectorBranchCombinators(c).length > 0) {
    return null;
  }
  const tokens = termTokens(terms[0]!);
  if (tokens.length !== 1) {
    return null;
  }
  return simpleGroupInterp(tokens[0]!, frame, e);
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
function expandSelectorBranch(c: SelectorBranch, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const g = loneGroupInterp(c, frame, e);
  if (g !== null) {
    return g.capture ? g.branches : [g.branches.join(', ')];
  }
  return mapMaybe(resolveSelectorBranch(c, frame, e), value => [value]);
}

/** Resolve one interpolated simple token's text in `frame`. Each interpolation ref
 *  part folds to its bytes, EXCEPT a group ref (a `*[…]` capture or `~'…'` comma
 *  string) embedded in a compoundSelector (`.d@{cap}&:hover`, `@{c}@{d}`) compacts to a
 *  single `:is(…)` group; a single-branch capture splices its lone branch bare. */
function resolveSimpleText(sim: SimpleToken, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  /*
   * A structured pseudo's STRUCTURE lives in `args`; serialize it to the inline
   * `:is(a, b)` form via the core-owned join. An INTERPOLATION-FREE argument is
   * frame-independent, so the memoised static `pseudoCanonical` path stands.
   *
   * An argument that carries interpolation is NOT static: its members are
   * ordinary selector branches one level down, and each resolves in the SAME
   * entering frame as the compound that contains the pseudo. Joining them
   * statically drops every interpolated member (`text: null` contributes `''`),
   * which is exactly how `:not(a#{$x})` emitted `:not(a)`.
   */
  if (sim.type === 'PseudoSelector') {
    const args = sim.args;
    if (args === null || !pseudoHasInterp(sim)) {
      return pseudoCanonical(sim);
    }
    return combineAll(
      args.selectors.map(branch => resolveSelectorBranch(branch, frame, e)),
      values => pseudoJoin(sim.name, values)
    );
  }
  const interp = sim.interp;
  if (interp === null) {
    return sim.text ?? '';
  }

  /*
   * Capture the entering frame once. A pending earlier slot must never cause a
   * later slot to observe a different loop/mixin placement.
   */
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
/**
 * A selector interpolation that can only be resolved by awaiting. Distinct from
 * an ordinary resolution failure because the extend pre-pass deliberately
 * SWALLOWS the latter (an interp that never resolves — a guarded rule that is
 * never emitted — correctly falls back to "no extend match"). An awaitable value
 * is not that: it is a real capability gap, and swallowing it produced malformed
 * CSS with no diagnostic at all.
 */
class AsyncSelectorInterp extends Error {
  /** The offending token, so the diagnostic can point at its `@{…}` reference. */
  readonly token: SimpleToken;

  constructor(token: SimpleToken) {
    super('selector interpolation resolved to an awaitable value');
    this.name = 'AsyncSelectorInterp';
    this.token = token;
  }
}

/**
 * Span-carrying nodes to attribute a selector-interp failure to, most specific
 * first. An interpolation reference carries the most precise source span, even
 * when its containing selector or rule also carries broader provenance; that
 * reference is the thing the author would have to change.
 */
function interpSpanCandidates(token: SimpleToken): object[] {
  const out: object[] = [];
  for (const part of token.interp?.parts ?? []) {
    if ('ref' in part) {
      out.push(part.ref);
    }
  }
  return out;
}

/**
 * The authored spelling of an interpolated token (`.@{e}`), rebuilt from its
 * template. The parser records no source span for a selector-interpolation
 * reference, so a line/column is often unavailable here; naming the selector
 * keeps the diagnostic actionable regardless.
 */
function interpTokenSpelling(token: SimpleToken): string {
  let out = '';
  for (const part of token.interp?.parts ?? []) {
    if ('lit' in part) {
      out += part.lit;
      continue;
    }
    const ref = part.ref;
    out += !isValueSlotArray(ref) && ref.type === 'Lookup' && ref.kind === 'var' ? `@{${ref.name}}` : '@{…}';
  }
  return out;
}

function resolveSimpleTextSync(sim: SimpleToken, frame: Frame | null, e: EvalCtx): string {
  const value = resolveSimpleText(sim, frame, e);
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw new AsyncSelectorInterp(sim);
  }
  return value;
}

function resolveCompound(c: CompoundSelector, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (!compoundHasInterp(c)) {
    return compoundCanonical(c);
  }
  const parts = c.value.map(sim => resolveSimpleText(sim, frame, e));
  return combineAll(parts, values => values.join(''));
}

function resolveSelectorTerm(term: SelectorTerm, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (term.type === 'CompoundSelector') {
    return resolveCompound(term, frame, e);
  }
  return selectorTermHasInterp(term) ? resolveSimpleText(term, frame, e) : selectorTermCanonical(term);
}

/** The concrete canonical string of a (possibly interpolated) complex, in
 * the entering frame. Static selectors keep the cached `canonical()` fast path. */
function resolveSelectorBranch(c: SelectorBranch, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (!selectorBranchHasInterp(c)) {
    return selectorBranchCanonical(c);
  }
  const terms = selectorBranchTerms(c);
  const combinators = selectorBranchCombinators(c);
  return combineAll(terms.map(term => resolveSelectorTerm(term, frame, e)), (values) => {
    const start = c.type === 'RelativeSelector' ? 1 : 0;
    let out = c.type === 'RelativeSelector'
      ? renderCombinator(combinators[0]!).trimStart() + values[0]!
      : values[0]!;
    for (let i = start; i < combinators.length; i++) {
      const valueIndex = c.type === 'RelativeSelector' ? i : i + 1;
      out += renderCombinator(combinators[i]!) + values[valueIndex]!;
    }
    return out;
  });
}

/** Synchronous-only selector consumers (mixin-key indexing and nested-mode
 * header probes) retain their existing contract. Public emitted selectors use
 * the MaybePromise path above. */
function resolveSelectorBranchSync(c: SelectorBranch, frame: Frame | null, e: EvalCtx): string {
  const value = resolveSelectorBranch(c, frame, e);
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw ERR.asyncInSyncPosition({
      node: c,
      ...callSiteLocation(c, e),
      meta: { where: 'mixin-index selector name (an interpolated selector used as a mixin key)' }
    });
  }
  return value;
}

/** [nesting] The `&` SUBJECT-slot substitution over MULTIPLE parents: the parent
 *  list wraps once in `:is(a, b, …)`; a single parent substitutes bare. Only a bare
 *  LEADING `&` (the compound's subject) uses this — a name-merged `&` distributes. */
function ampSub(parents: string[]): string {
  return parents.length === 1 ? parents[0]! : `:is(${parents.join(', ')})`;
}

/** [nesting] One `&`-bearing token resolved against `parents`, position-aware.
 *  A list-accepting pseudo (`:is`/`:where`/`:not`/`:has`/`:matches`) whose args
 *  reference `&` recurses so the `&` becomes the BARE parent list inside the pseudo
 *  (`:not(&)` over `.a, .b` → `:not(.a, .b)`, not the De-Morgan-wrong
 *  `:not(.a), :not(.b)`). A bare LEADING `&` (`first`, the compound SUBJECT — `&`,
 *  `&.mod`, `& + &`) wraps in `:is(parents)`, which keeps the subject even for a
 *  complex parent (`:is(.foo .bar).mod` ≡ `.foo .bar.mod`). Every OTHER `&` — a
 *  fused append (`&__el`) or a `&` merged after a preceding name (`.qux&`,
 *  `.fruit-&`) — is a name concatenation and DISTRIBUTES per parent (a group cannot
 *  splice into a name; `:is(.foo .bar)` would also relocate the subject). Returns
 *  one variant per distribution — the branch-multiplying case. */
function resolveTokenAmp(sim: SimpleToken, parents: string[], sub: string, first: boolean, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  if (sim.type === 'PseudoSelector' && sim.args !== null && selectorListHasAmpersand(sim.args)) {
    return mapMaybe(
      resolveSelectorListAmp(sim.args, parents, frame, e),
      branches => [pseudoJoin(sim.name, branches)]
    );
  }
  return mapMaybe(resolveSimpleText(sim, frame, e), (text) => {
    if (!text.includes('&')) {
      return [text];
    }
    if (first && text === '&') {
      return [sub];
    }
    return parents.map(p => text.split('&').join(p));
  });
}

/** [nesting] One compound resolved against `parents`, its tokens concatenated;
 *  a distributing `&` (append/merge) multiplies its variants (cartesian). */
function resolveCompoundAmp(cmp: CompoundSelector, parents: string[], sub: string, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const tokens = cmp.value.map((sim, i) => resolveTokenAmp(sim, parents, sub, i === 0, frame, e));
  return combineAll(tokens, (lists) => {
    let acc = [''];
    for (const variants of lists) {
      const next: string[] = [];
      for (const head of acc) {
        for (const v of variants) {
          next.push(head + v);
        }
      }
      acc = next;
    }
    return acc;
  });
}

function resolveTermAmp(term: SelectorTerm, parents: string[], sub: string, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  return term.type === 'CompoundSelector'
    ? resolveCompoundAmp(term, parents, sub, frame, e)
    : resolveTokenAmp(term, parents, sub, true, frame, e);
}

/** [nesting] Resolve one `&`-bearing complex against MULTIPLE `parents` with
 *  position-aware substitution — the spec-faithful CSS-Nesting parent resolution
 *  that replaces the old context-blind cartesian odometer. A whole selector branch
 *  that is a bare `&` expands to the parent list itself (branch-multiplying); every
 *  interior `&` resolves by role in `resolveCompoundAmp`. */
function resolveSelectorBranchAmp(c: SelectorBranch, parents: string[], frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const terms = selectorBranchTerms(c);
  const combinators = selectorBranchCombinators(c);
  if (c.type !== 'RelativeSelector' && terms.length === 1 && combinators.length === 0) {
    if (termIsBareAmp(terms[0]!)) {
      return parents.slice();
    }
  }
  const sub = ampSub(parents);
  return combineAll(terms.map(term => resolveTermAmp(term, parents, sub, frame, e)), (variants) => {
    const start = c.type === 'RelativeSelector' ? 1 : 0;
    const lead = c.type === 'RelativeSelector'
      ? renderCombinator(combinators[0]!).trimStart()
      : '';
    let acc = variants[0]!.map(v => lead + v);
    for (let i = start; i < combinators.length; i++) {
      const comb = renderCombinator(combinators[i]!);
      const valueIndex = c.type === 'RelativeSelector' ? i : i + 1;
      const next: string[] = [];
      for (const head of acc) {
        for (const t of variants[valueIndex]!) {
          next.push(head + comb + t);
        }
      }
      acc = next;
    }
    return acc;
  });
}

/** [nesting] Resolve a selector list against `parents`, flattening each complex's
 *  branch variants. Reused for a list-accepting pseudo's args. */
function resolveSelectorListAmp(list: SelectorList, parents: string[], frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  return combineAll(list.selectors.map(c => resolveSelectorBranchAmp(c, parents, frame, e)), values => values.flat());
}

/** Compose ONE child complex over ALL `parents`. A MULTI-parent `&`-bearing child
 * resolves each `&` by structural position (`resolveComplexAmp`); `&`-less children
 * take an implicit descendant prefix, one branch per parent. A SINGLE parent — the
 * common BEM/`&:hover` nesting — keeps the fast `joinAmpersand` string splice (byte-
 * identical to the structural walk for one parent), which also carries the legacy
 * quoted-comma-parent path plus its non-leading-`&` rejection (`.fruit-&`). */
function composeOne(parents: string[], child: SelectorBranch, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  if (!selectorBranchHasAmpersand(child)) {
    return mapMaybe(resolveSelectorBranch(child, frame, e), text => parents.map(p => p + ' ' + text));
  }
  if (parents.length >= 2 && !parents.some(hasTopLevelComma)) {
    return resolveSelectorBranchAmp(child, parents, frame, e);
  }
  return mapMaybe(resolveSelectorBranch(child, frame, e), (text) => {
    if (parents.some(hasTopLevelComma) && !text.startsWith('&')) {
      throw ERR.commaListInterpolation({
        node: child,
        ...callSiteLocation(child, e),
        meta: { selector: text }
      });
    }
    return joinAmpersand(text, parents);
  });
}

function compose(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const parts = child.selectors.map(c => composeOne(parents, c, frame, e));
  return combineAll(parts, values => values.flat());
}

function composeSync(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const value = compose(parents, child, frame, e);
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw ERR.asyncInSyncPosition({
      node: child,
      ...callSiteLocation(child, e),
      meta: { where: 'nested selector composition' }
    });
  }
  return value;
}

/**
 * [nesting] The EMITTED-header branches for `child` under `parents`. An `&`-less
 * child under MULTIPLE parents compacts to a single `:is(p0, p1, …) child` prefix
 * (alpha v5 header form); an `&`-bearing child resolves each `&` by structural
 * position (`resolveComplexAmp`). Only called with `parents.length >= 2` (callers
 * use `compose` for the rest).
 */
function composeHeader(parents: string[], child: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const isPrefix = `:is(${parents.join(', ')}) `;
  const parts = child.selectors.map((c) => {
    if (!selectorBranchHasAmpersand(c)) {
      return mapMaybe(resolveSelectorBranch(c, frame, e), canon => [isPrefix + canon]);
    }
    if (parents.some(hasTopLevelComma)) {
      return mapMaybe(resolveSelectorBranch(c, frame, e), (canon) => {
        if (!canon.startsWith('&')) {
          throw ERR.commaListInterpolation({
            node: c,
            ...callSiteLocation(c, e),
            meta: { selector: canon }
          });
        }
        return joinAmpersand(canon, parents);
      });
    }
    return resolveSelectorBranchAmp(c, parents, frame, e);
  });
  return combineAll(parts, values => values.flat());
}

/** True if ANY branch of the list references `&` (routes the rule to the cartesian
 * `&`-substitution header instead of the compact `&`-less join). */
function selectorListHasAmpersand(list: SelectorList): boolean {
  for (const c of list.selectors) {
    if (selectorBranchHasAmpersand(c)) {
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

/** [nesting] A branch that opens with a real combinator (`> .col`) is a RELATIVE
 * selector. `:is()` takes a `<forgiving-selector-list>` of COMPLEX selectors, so a
 * relative branch is invalid there and every browser drops it — the compacted group
 * then matches nothing. Such a branch must join the ancestor directly. The namespace
 * pipe (`|h1`) is part of the compound, not a combinator, so it stays groupable. */
function leadsWithCombinator(c: SelectorBranch): boolean {
  const comb = c.type === 'RelativeSelector' ? c.value[0] : undefined;
  return comb !== undefined && comb !== ' ' && comb !== '|';
}

/** [nesting] Join opaque ancestor `A` with an all-`&`-less child list, prefix
 * factored: `A` is emitted ONCE and the multi-branch child list wraps in a single
 * `:is(...)` (never cartesian-distributed, never repeated inside the `:is()`).
 * `#…#deux` + `#fourth,#five,#six` → `#…#deux :is(#fourth, #five, #six)`; a single
 * child joins plainly (`A child`, honouring its leading combinator).
 *
 * A branch that LEADS WITH A COMBINATOR cannot enter the group ({@link
 * leadsWithCombinator}); it is emitted as its own header branch with the combinator
 * hoisted out — `.no-gutters` + `> .col, > [class*="col-"]` becomes
 * `.no-gutters > .col, .no-gutters > [class*="col-"]`, the CSS-Nesting desugaring.
 * Descendant branches keep the compaction, so a MIXED list splits by shape:
 * `.nav-fill` + `> .nav-link, .nav-item` → `.nav-fill > .nav-link, .nav-fill .nav-item`.
 * Consecutive descendant branches stay one group, preserving authored order. */
function opaqueJoin(a: string, child: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const canons = child.selectors.map(c => resolveSelectorBranch(c, frame, e));
  return combineAll(canons, (values) => {
    if (values.length === 1) {
      return [a + ' ' + values[0]!];
    }
    if (!child.selectors.some(leadsWithCombinator)) {
      return [a + ' :is(' + values.join(', ') + ')'];
    }
    const out: string[] = [];
    let run: string[] = [];
    const flushRun = (): void => {
      if (run.length === 1) {
        out.push(a + ' ' + run[0]!);
      } else if (run.length > 1) {
        out.push(a + ' :is(' + run.join(', ') + ')');
      }
      run = [];
    };
    for (let i = 0; i < values.length; i++) {
      if (leadsWithCombinator(child.selectors[i]!)) {
        flushRun();
        out.push(a + ' ' + values[i]!);
      } else {
        run.push(values[i]!);
      }
    }
    flushRun();
    return out;
  });
}

function ownStrings(list: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  return combineAll(list.selectors.map(c => expandSelectorBranch(c, frame, e)), values => values.flat());
}

function ownStringsSync(list: SelectorList, frame: Frame | null, e: EvalCtx): string[] {
  const value = ownStrings(list, frame, e);
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw ERR.asyncInSyncPosition({
      node: list,
      ...callSiteLocation(list, e),
      meta: { where: 'nested selector header' }
    });
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
    parts.push(mapMaybe(resolveSelectorBranch(c, frame, e), value => [selectorBranchHasAmpersand(c) ? value.split('&').join('').trim() : value]));
  }
  return combineAll(parts, values => values.flat());
}

/* ------------------------------------------------------------- emit engine */

interface Emit extends EvalCtx {
  chunks: string[];
  off: number;
  positions: Position[] | null;

  /*
   * typed value evaluator + configured modes (from EvalCtx: `ev`, `modes`).
   * async patches: a leaf whose value forced an async built-in reserves a
   * placeholder chunk index; the promise resolves the bytes after the sync walk.
   */
  pending: Array<{ i: number; p: Promise<string> }>;

  /*
   * [null] Declarations whose value deferred to an async slot AND may still turn
   * out to elide (§4.3). A sync elision rolls `chunks` straight back; an async one
   * cannot, because the chunk range is already fixed, so the range is recorded
   * here and blanked once every pending slot has settled.
   */
  drops: Array<{ from: number; to: number; sink: { elided: boolean } }>;

  /*
   * [atrule] current block-nesting depth (0 = top level). At-rule bodies raise it
   * so declarations/selectors inside a block indent one level deeper.
   */
  depth: number;

  /*
   * [nested/R0] false => preserve authored nesting (Less v5 default); true =>
   * flatten to composed selector strings (4.x / collapseNesting:true).
   */
  collapse: boolean;

  /*
   * [extend] per-rule extend overrides, or null when the document has no
   * `:extend()` (zero-cost gate: emit is byte-identical to the no-extend path).
   */
  extends: ExtendResults | null;

  /*
   * [extend] set while emitting a hoisted (flattened) nested subtree via the flat
   * path, so headers use the compacted nested-hoist form. Never set in flat mode.
   */
  hoistMode: boolean;

  /*
   * [adjacent-merge] the most recently CLOSED rule block, or null. v5 merges
   * consecutive same-selector SIBLING rulesets nested under a common parent into
   * one block (e.g. `P { &-2 {a} &-2 {b} }` → `P-2 { a; b }`). The next block
   * merges into this one when ALL hold: (1) same `parentKey` — the identical parent-
   * expansion the two rulesets are children of (a fresh composed-selector array per
   * parent expansion; `null` for top-level source rules, which NEVER merge even when
   * adjacent+identical — cf. repeated top-level `.whitespace`); (2) byte-identical
   * `header` at the same `depth`; (3) nothing emitted since it closed (`endChunks`
   * still the chunk-stream tail — a strict-adjacency guard). On a match the prior
   * block's `}` is rewound and this body appended inside it (source order, no cross-
   * block dedup). ONE preallocated record, mutated per block flush (no per-block
   * allocation); its seed `parentKey: null` matches nothing (merge needs pk !== null).
   */
  lastBlock: { parentKey: object | null; header: string; depth: number; endChunks: number };

  /*
   * [recursion-backstop] current NESTED mixin-expansion depth (0 at the top of a
   * document walk). `expandCall` bumps it around each expansion and raises a clean
   * `RangeError` once it reaches `MAX_MIXIN_DEPTH` — catching a bad-guard runaway
   * before a native stack overflow. Threaded through `scratchEmit`.
   */
  mixinDepth: number;
  loadedImports: Set<string> | null;

  /** A `(multiple)` import makes its transitive imports multiple too. */
  multipleImportDepth: number;

  /** A `(reference)` import contributes facts but suppresses its direct output. */
  referenceImportDepth: number;

  /** The render-owned Context import capability, retained for nested placement. */
  importDocument?: SerializeOptions['importDocument'];

  /** Canonical documents already loaded by the extend planner, consumed once by emission. */
  plannedImportDocuments: WeakMap<StyleImport, PlannedImportDocument> | null;

  /** Caller-owned prepared import plans remain reusable across renders. */
  preparedImportsOwnedByCaller: boolean;

  /**
   * Planner-issued identity tokens for each concrete `$for`/`each()` iteration.
   * The token is selected by the execution index and placed on that iteration's
   * lexical frame; it is intentionally not stored on the immutable AST.
   */
  plannedForExtendPlacements: WeakMap<For, readonly object[]> | null;

  /** Root CSS-terminal imports already written in the required document prelude. */
  hoistedCssImports: Set<AtRuleStatement> | null;

  /** Block-comment trivia runs already replayed during this render. */
  emittedBlockTrivia: EmittedTrivia;
}

/**
 * A throwaway {@link Emit} over an {@link EvalCtx}, for a capture-only expansion (a
 * `@p: .mk-map()` binding read as an accessor base — {@link declMapFromMixinCall}).
 * Its chunk/patch state is discarded; it shares the eval seam (`ev`/`modes`) and
 * the `excluded` cycle-guard set with the live context. */
/**
 * Push one paren frame. `true` where a parenthesis opens a math context,
 * `false` where a call argument list closes it.
 */
function pushParenFrame(e: EvalCtx, enabled: boolean): readonly boolean[] {
  const frames = e.parenFrames;
  return frames === undefined ? [enabled] : [...frames, enabled];
}

function scratchEmit(e: EvalCtx): Emit {
  return {
    ev: e.ev,
    modes: e.modes,
    trivia: e.trivia,
    excluded: e.excluded,
    propNames: e.propNames,
    optional: e.optional,
    calcDepth: e.calcDepth,
    scopedFunctionNames: e.scopedFunctionNames, // [plugin/P1] preserve the registered-name gate
    lambdaFunctionNames: e.lambdaFunctionNames, // [lambda-fn] preserve the user-`@function` gate
    fnScopeVersion: e.fnScopeVersion,
    pluginHost: e.pluginHost, // [plugin/P2] preserve the injected plugin runtime
    io: e.io, // [io] preserve the file-read capability
    chunks: [],
    off: 0,
    positions: null,
    pending: [],
    drops: [],
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
    preparedImportsOwnedByCaller: false,
    plannedForExtendPlacements: null,
    hoistedCssImports: null,
    emittedBlockTrivia: new EmittedTrivia()
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
  /*
   * [important] Install a per-declaration importance sink (Less `importantScope`):
   * an `Important`-wrapped variable reference resolved while folding this value sets
   * `hit`, so the declaration hoists a single `!important` even without its own.
   */
  const sink = { hit: false };
  const prevSink = e.importantSink;
  e.importantSink = sink;
  const b = evalBytes(node, frame, e);
  e.importantSink = prevSink;
  const finish = (s: string): string => {
    /*
     * [whitespace] `firstOnNewLine` folds the value's first line into a leading
     * (indented) continuation, so a value authored on its own line after `:`
     * re-emits with that layout (multi-line `grid-template-areas`).
     */
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

/**
 * Columnar block-comment facts for ONE document's trivia map.
 *
 * `commentRuns()` hands back source-ordered runs, but every emit-time question
 * ("does this run carry a comment?", "what text?") used to be answered by
 * re-scanning the run's source bytes with `indexOf` and allocating a fresh
 * `string[]`. The scan result is a property of the document, not of the
 * statement being emitted, so it is computed ONCE here and addressed by index
 * afterwards: emptiness becomes an integer compare, and text becomes a single
 * `slice` taken at the moment of output.
 *
 * Comments are stored CSR-style — the comments of run `i` occupy
 * `[commentAt[i], commentAt[i + 1])` in `commentStart`/`commentEnd`.
 */
interface CommentTable {
  readonly runs: readonly Trivia[];
  readonly runStart: Int32Array;
  readonly runEnd: Int32Array;
  readonly commentAt: Int32Array;
  readonly commentStart: Int32Array;
  readonly commentEnd: Int32Array;

  /** Hoisted once; `undefined` only when the document has no comment runs. */
  readonly src: string | undefined;

  /**
   * Ownership slot for each position: the FIRST index holding that same run
   * object. `commentRuns()` may list one cached run object at several
   * positions (9 such repeats occur in `tests-unit/comments/comments.less`
   * alone), and the guard this replaces deduped on object identity. Keying
   * the emitted-bits by the canonical slot rather than the raw position is
   * what keeps identity semantics exact — indexing by position would let the
   * second occurrence re-emit a comment the first already owned.
   */
  readonly canonical: Int32Array;
}

const commentTables = new WeakMap<TriviaMap, CommentTable>();

function buildCommentTable(trivia: TriviaMap): CommentTable {
  const runs = trivia.commentRuns();
  const count = runs.length;
  const runStart = new Int32Array(count);
  const runEnd = new Int32Array(count);
  const commentAt = new Int32Array(count + 1);
  const canonical = new Int32Array(count);
  const firstIndex = new Map<Trivia, number>();
  const starts: number[] = [];
  const ends: number[] = [];

  for (let i = 0; i < count; i++) {
    const run = runs[i]!;
    runStart[i] = run.start;
    runEnd[i] = run.end;
    commentAt[i] = starts.length;

    const seen = firstIndex.get(run);
    if (seen === undefined) {
      firstIndex.set(run, i);
      canonical[i] = i;
    } else {
      canonical[i] = seen;
    }

    /*
     * The one and only byte scan. Parseman labels a run as comment-BEARING but
     * does not publish the bounds of each comment inside it, so those bounds
     * are recovered here — once per document, never once per statement.
     */
    const src = run.src;
    let pos = run.start;
    while (pos < run.end) {
      const open = src.indexOf('/*', pos);
      if (open < 0 || open >= run.end) {
        break;
      }
      const close = src.indexOf('*/', open + 2);
      if (close < 0 || close + 2 > run.end) {
        break;
      }
      starts.push(open);
      ends.push(close + 2);
      pos = close + 2;
    }
  }
  commentAt[count] = starts.length;

  return {
    runs,
    runStart,
    runEnd,
    commentAt,
    commentStart: new Int32Array(starts),
    commentEnd: new Int32Array(ends),
    canonical,
    src: runs[0]?.src
  };
}

function commentTableOf(trivia: TriviaMap): CommentTable {
  let table = commentTables.get(trivia);
  if (table === undefined) {
    table = buildCommentTable(trivia);
    commentTables.set(trivia, table);
  }
  return table;
}

/** True when run `i` carries at least one block comment — an integer compare. */
function runHasBlockComment(table: CommentTable, i: number): boolean {
  return table.commentAt[i]! < table.commentAt[i + 1]!;
}

/**
 * First run index whose `start` is >= `offset`, by binary search over the
 * source-ordered run bounds.
 *
 * A forward-only cursor is NOT sound here: emit revisits earlier source
 * offsets (mixin expansion replays a definition body, and deferred imports
 * emit out of source order), which was measured at 231 backward windows on
 * `benchmark.less` alone. The search is therefore the primary seek, and any
 * cursor may only ever be a hint that is validated against it.
 */
function firstRunAtOrAfter(table: CommentTable, offset: number): number {
  let low = 0;
  let high = table.runStart.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table.runStart[middle]! < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Per-render ownership guard, replacing `Set<Trivia>` identity hashing with one
 * bit per run. Semantics are UNCHANGED: a bit is keyed by a run's index in its
 * own document table, which is exactly as discriminating as the run object it
 * replaces (runs are cached per source position, so identity and index agree).
 * Runs are NOT flattened to per-comment bits — overlapping runs exist (25 pairs
 * across the Less corpus), and the containment marking at
 * {@link declarationLeadingBlockCommentText} depends on whole-run ownership.
 */
class EmittedTrivia {
  private readonly bits = new Map<CommentTable, Uint8Array>();

  /** Read-only: never allocates. An absent bitset means nothing is owned yet. */
  hasIndex(table: CommentTable, i: number): boolean {
    if (i < 0) {
      return false;
    }
    const owned = this.bits.get(table);
    return owned?.[table.canonical[i]!] === 1;
  }

  addIndex(table: CommentTable, i: number): void {
    if (i < 0) {
      return;
    }
    let owned = this.bits.get(table);
    if (owned === undefined) {
      owned = new Uint8Array(table.runs.length);
      this.bits.set(table, owned);
    }
    owned[table.canonical[i]!] = 1;
  }
}

function inlineBlockCommentText(run: Trivia, trimLeadingWhitespace = false): string {
  let out = '';
  let pos = run.start;
  let first = true;
  while (pos < run.end) {
    const start = run.src.indexOf('/*', pos);
    if (start < 0 || start >= run.end) {
      break;
    }
    const end = run.src.indexOf('*/', start + 2);
    if (end < 0 || end + 2 > run.end) {
      break;
    }

    let textStart = start;
    while (textStart > pos) {
      const char = run.src.charCodeAt(textStart - 1);
      if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
        break;
      }
      textStart--;
    }
    if (first && trimLeadingWhitespace) {
      textStart = start;
    }

    let textEnd = end + 2;
    while (textEnd < run.end) {
      const char = run.src.charCodeAt(textEnd);
      if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
        break;
      }
      textEnd++;
    }

    out += run.src.slice(textStart, textEnd);
    pos = textEnd;
    first = false;
  }
  return out;
}

/* Reads the inline span slots directly: these run per statement per render, so
 * they must not materialize an `{ start, end }` object to discard one half. */
function statementStartOf(node: Statement): number | undefined {
  if (node.type === 'VariableDeclaration') {
    return undefined;
  }
  const start = node.type === 'Ruleset' ? sourceStartOf(node.selector) : sourceStartOf(node);
  return start === NO_SPAN ? undefined : start;
}

function statementEndOf(node: Statement): number | undefined {
  if (node.type === 'VariableDeclaration') {
    return undefined;
  }
  const end = sourceEndOf(node);
  if (node.type === 'Ruleset') {
    if (end !== NO_SPAN) {
      return end;
    }
    const bodyEnd = bodyEndOf(node);
    return bodyEnd === NO_SPAN ? undefined : bodyEnd + 1;
  }
  return end === NO_SPAN ? undefined : end;
}

interface ReplaySpan {
  readonly start: number;
  readonly end: number;
}

function isReplaySpan(span: ReplaySpan | undefined): span is ReplaySpan {
  return span !== undefined;
}

function emitBlockCommentTriviaBetween(
  e: Emit,
  start: number | undefined,
  end: number | undefined,
  indent: string,
  excludedSpans: readonly ReplaySpan[] = []
): number {
  const trivia = e.trivia;
  if (trivia === undefined || start === undefined || end === undefined) {
    return 0;
  }
  const table = commentTableOf(trivia);
  const src = table.src;
  if (src === undefined) {
    return 0;
  }
  let emitted = 0;

  /*
   * Seek straight to the window instead of skipping the whole prefix. The old
   * walk started at run 0 on every call and `continue`d past everything before
   * `start`; on `benchmark.less` that was 357,447 of 366,778 iterations spent
   * re-skipping already-passed runs.
   */
  for (let i = firstRunAtOrAfter(table, start); i < table.runs.length; i++) {
    const runStart = table.runStart[i]!;
    if (runStart > end) {
      break;
    }
    const runEnd = table.runEnd[i]!;
    if (runEnd > end || e.emittedBlockTrivia.hasIndex(table, i)) {
      continue;
    }

    /*
     * `excludedSpans` is the root replay's statement list. It is bounded and
     * small (556 span tests across the entire Less corpus, 0 on benchmark.less),
     * so the linear scan stays as-is rather than growing an index for it.
     */
    if (excludedSpans.some(span => runStart >= span.start && runEnd <= span.end)) {
      continue;
    }
    const from = table.commentAt[i]!;
    const to = table.commentAt[i + 1]!;
    if (from === to) {
      continue;
    }
    e.emittedBlockTrivia.addIndex(table, i);
    for (let c = from; c < to; c++) {
      put(e, indent);
      put(e, src.slice(table.commentStart[c]!, table.commentEnd[c]!));
      put(e, '\n');
      emitted++;
    }
  }
  return emitted;
}

/** Index of the comment-bearing run starting at one exact offset, or -1. */
function commentRunStartingAt(table: CommentTable, offset: number): number {
  const at = firstRunAtOrAfter(table, offset);
  return at < table.runs.length && table.runStart[at] === offset ? at : -1;
}

function emitInlineBlockCommentTriviaAfter(node: Statement, e: Emit): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }
  const table = commentTableOf(trivia);
  const source = table.src;
  if (source === undefined) {
    return;
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return;
  }
  const span = { start: spanStart, end: sourceEndOf(node) };

  /* This path only emits comments. A general trivia-boundary lookup forces a
   * legacy Parseman root map for all whitespace gaps; comment runs are already
   * sparse and source ordered. */
  const trailing = commentRunStartingAt(table, span.end);
  if (trailing >= 0 && !e.emittedBlockTrivia.hasIndex(table, trailing) && runHasBlockComment(table, trailing)) {
    e.emittedBlockTrivia.addIndex(table, trailing);
    put(e, inlineBlockCommentText(table.runs[trailing]!));
    return;
  }
  for (let i = firstRunAtOrAfter(table, span.start); i < table.runs.length; i++) {
    if (table.runStart[i]! > span.end) {
      break;
    }
    const runEnd = table.runEnd[i]!;
    if (runEnd > span.end || e.emittedBlockTrivia.hasIndex(table, i) || !runHasBlockComment(table, i)) {
      continue;
    }
    let index = runEnd;
    while (index < span.end) {
      const char = source.charCodeAt(index);
      if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
        break;
      }
      index++;
    }
    if (index !== span.end) {
      continue;
    }
    e.emittedBlockTrivia.addIndex(table, i);
    put(e, inlineBlockCommentText(table.runs[i]!));
    return;
  }
  let end = span.end;
  while (end > span.start) {
    const char = source.charCodeAt(end - 1);
    if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
      break;
    }
    end--;
  }
  if (source.slice(end - 2, end) !== '*/') {
    return;
  }
  const open = lastIndexInSourceRange(source, '/*', span.start, end);
  if (open < 0) {
    return;
  }
  let start = open;
  while (start > span.start) {
    const char = source.charCodeAt(start - 1);
    if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
      break;
    }
    start--;
  }
  put(e, source.slice(start, end));
}

/** Find one literal only inside the AST-owned source range; never scan a file prefix/suffix. */
function firstIndexInSourceRange(source: string, needle: string, start: number, end: number): number {
  const limit = end - needle.length;
  for (let index = start; index <= limit; index++) {
    if (source.startsWith(needle, index)) {
      return index;
    }
  }
  return -1;
}

/** Reverse counterpart to {@link firstIndexInSourceRange}, bounded to the same owner span. */
function lastIndexInSourceRange(source: string, needle: string, start: number, end: number): number {
  for (let index = end - needle.length; index >= start; index--) {
    if (source.startsWith(needle, index)) {
      return index;
    }
  }
  return -1;
}

function firstDeclarationColon(source: string, span: AstSourceSpan): number | null {
  let index = span.start;
  while (index < span.end) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0 || close + 2 > span.end) {
        return null;
      }
      index = close + 2;
      continue;
    }
    if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 || newline > span.end ? span.end : newline + 1;
      continue;
    }
    if (char === '"' || char === '\'') {
      const quote = char;
      index++;
      while (index < span.end) {
        const inner = source[index]!;
        index += inner === '\\' ? 2 : 1;
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    if (char === ':') {
      return index;
    }
    index++;
  }
  return null;
}

function declarationHeadTriviaText(node: Declaration, e: Emit): string {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return '';
  }
  const source = triviaSource(trivia);
  if (source === undefined) {
    return '';
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return '';
  }
  const span = { start: spanStart, end: sourceEndOf(node) };
  const colon = firstDeclarationColon(source, span);
  if (colon === null) {
    return '';
  }
  let text = '';
  let cursor = span.start;
  const table = commentTableOf(trivia);
  const runs = table.runs;
  for (let index = firstRunAtOrAfter(table, span.start); index < runs.length; index++) {
    const runStart = table.runStart[index]!;
    if (runStart < cursor) {
      continue;
    }
    if (runStart >= colon) {
      break;
    }
    if (table.runEnd[index]! > colon || runs[index]!.src !== source || !runHasBlockComment(table, index)) {
      continue;
    }

    /*
     * Runs may overlap and share a start offset; the widest one that still ends
     * before the colon owns the text, and every run it contains is marked so the
     * same comment cannot be replayed through another path.
     */
    let widest = index;
    let probeIndex = index + 1;
    while (probeIndex < runs.length && table.runStart[probeIndex] === runStart) {
      if (table.runEnd[probeIndex]! <= colon
        && runs[probeIndex]!.src === source
        && runHasBlockComment(table, probeIndex)
        && table.runEnd[probeIndex]! > table.runEnd[widest]!) {
        widest = probeIndex;
      }
      probeIndex++;
    }
    const widestStart = table.runStart[widest]!;
    const widestEnd = table.runEnd[widest]!;
    for (let contained = firstRunAtOrAfter(table, widestStart);
      contained < runs.length && table.runStart[contained]! <= widestEnd;
      contained++) {
      if (table.runEnd[contained]! <= widestEnd) {
        e.emittedBlockTrivia.addIndex(table, contained);
      }
    }
    text += source.slice(widestStart, widestEnd);
    cursor = widestEnd;
  }
  return text;
}

function cursorAfterLiteralWithTrivia(source: string, start: number, end: number, lit: string): number | null {
  let cursor = start;
  for (let i = 0; i < lit.length; i += 1) {
    while (source.startsWith('/*', cursor)) {
      const close = source.indexOf('*/', cursor + 2);
      if (close < 0 || close + 2 > end) {
        return null;
      }
      cursor = close + 2;
    }
    if (cursor >= end || source[cursor] !== lit[i]) {
      return null;
    }
    cursor += 1;
  }
  return cursor;
}

function markCustomValueBlockTrivia(source: string, span: AstSourceSpan, e: Emit): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }
  const table = commentTableOf(trivia);
  for (let i = firstRunAtOrAfter(table, span.start); i < table.runs.length; i++) {
    if (table.runStart[i]! > span.end) {
      break;
    }
    if (table.runs[i]!.src === source && table.runEnd[i]! <= span.end && runHasBlockComment(table, i)) {
      e.emittedBlockTrivia.addIndex(table, i);
    }
  }
}

function customPropertyValueWithTrivia(value: ValueSlot, frame: Frame | null, e: Emit): MaybePromise<string> | null {
  if (isValueSlotArray(value)) {
    return null;
  }
  const trivia = e.trivia;
  if (trivia === undefined) {
    return null;
  }
  const spanStart = sourceStartOf(value);
  if (spanStart === NO_SPAN) {
    return null;
  }
  const span = { start: spanStart, end: sourceEndOf(value) };
  let source: string | undefined;
  let sawComment = false;
  const valueTable = commentTableOf(trivia);
  for (let i = firstRunAtOrAfter(valueTable, span.start); i < valueTable.runs.length; i++) {
    const run = valueTable.runs[i]!;
    if (valueTable.runStart[i]! > span.end) {
      break;
    }
    if (valueTable.runEnd[i]! > span.end || !runHasBlockComment(valueTable, i)) {
      continue;
    }
    source = run.src;
    sawComment = true;
  }
  if (!sawComment || source === undefined) {
    return null;
  }
  if (value.type === 'Any') {
    markCustomValueBlockTrivia(source, span, e);
    return source.slice(span.start, span.end);
  }
  if (value.type !== 'Interpolation') {
    return null;
  }

  const pieces: Array<MaybePromise<string>> = [];
  let cursor = span.start;
  let chunkStart = span.start;
  for (const part of value.parts) {
    if ('lit' in part) {
      const nextCursor = cursorAfterLiteralWithTrivia(source, cursor, span.end, part.lit);
      if (nextCursor === null) {
        return null;
      }
      cursor = nextCursor;
      continue;
    }
    const variableOpen = source.indexOf('@{', cursor);
    const propertyOpen = source.indexOf('${', cursor);
    const open = variableOpen < 0
      ? propertyOpen
      : propertyOpen < 0
        ? variableOpen
        : Math.min(variableOpen, propertyOpen);
    if (open < cursor || open >= span.end) {
      return null;
    }
    const close = source.indexOf('}', open + 2);
    if (close < 0 || close >= span.end) {
      return null;
    }
    pieces.push(source.slice(chunkStart, open));
    pieces.push(resolveRefBytes(part, frame, e));
    cursor = close + 1;
    chunkStart = cursor;
  }
  pieces.push(source.slice(chunkStart, span.end));
  markCustomValueBlockTrivia(source, span, e);
  return combineAll(pieces, values => values.join(''));
}

function markSilentStatementBlockCommentTrivia(node: Statement, e: Emit): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return;
  }
  const span = { start: spanStart, end: sourceEndOf(node) };
  const table = commentTableOf(trivia);
  for (let i = firstRunAtOrAfter(table, span.start); i < table.runs.length; i++) {
    if (table.runStart[i]! > span.end) {
      break;
    }
    if (table.runEnd[i]! <= span.end && runHasBlockComment(table, i)) {
      e.emittedBlockTrivia.addIndex(table, i);
    }
  }
}

/* The start offset alone, with no object built: this runs per statement inside
 * an at-rule body, and every caller that only needs the start must not pay for
 * a `{ start, end }` the base version got for free from the retained side table. */
function bodyStartForTriviaReplay(owner: object, e: Emit): number {
  const bodyStart = bodyStartOf(owner);
  if (bodyStart !== NO_SPAN) {
    return bodyStart;
  }
  return bodySpanForTriviaReplay(owner, e)?.start ?? NO_SPAN;
}

function bodySpanForTriviaReplay(owner: object, e: Emit): ReplaySpan | undefined {
  const bodyStart = bodyStartOf(owner);
  if (bodyStart !== NO_SPAN) {
    return { start: bodyStart, end: bodyEndOf(owner) };
  }
  const trivia = e.trivia;
  const spanStart = sourceStartOf(owner);
  const source = trivia === undefined ? undefined : commentTableOf(trivia).src;
  if (spanStart === NO_SPAN || source === undefined) {
    return undefined;
  }
  const spanEnd = sourceEndOf(owner);
  const open = firstIndexInSourceRange(source, '{', spanStart, spanEnd);
  const close = lastIndexInSourceRange(source, '}', spanStart, spanEnd);
  if (open < 0 || close <= open) {
    return undefined;
  }
  return { start: open + 1, end: close };
}

function emitBodyBlockCommentTrivia(owner: object, e: Emit, indent: string): number {
  const body = bodySpanForTriviaReplay(owner, e);
  return emitBlockCommentTriviaBetween(e, body?.start, body?.end, indent);
}

function bodyBlockCommentTexts(owner: object, e: Emit): string[] {
  const trivia = e.trivia;
  const body = bodySpanForTriviaReplay(owner, e);
  if (trivia === undefined || body === undefined) {
    return [];
  }
  const out: string[] = [];
  const table = commentTableOf(trivia);
  const src = table.src;
  if (src === undefined) {
    return out;
  }
  for (let i = firstRunAtOrAfter(table, body.start); i < table.runs.length; i++) {
    if (table.runStart[i]! > body.end) {
      break;
    }
    if (table.runEnd[i]! > body.end) {
      continue;
    }
    for (let c = table.commentAt[i]!; c < table.commentAt[i + 1]!; c++) {
      out.push(src.slice(table.commentStart[c]!, table.commentEnd[c]!));
    }
  }
  return out;
}

function emitBodyBlockCommentTriviaBefore(owner: object, before: object, e: Emit, indent: string, after: number): number {
  const bodyStart = bodyStartForTriviaReplay(owner, e);
  const beforeStart = sourceStartOf(before);
  return emitBlockCommentTriviaBetween(
    e,
    Math.max(bodyStart === NO_SPAN ? after : bodyStart, after),
    beforeStart === NO_SPAN ? undefined : beforeStart,
    indent
  );
}

function emitLeadingDocumentBlockComments(e: Emit, indent = ''): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }

  /* `commentRuns()` is already source ordered. Going through a boundary lookup
   * at offset zero makes legacy Parseman materialize every root whitespace gap
   * merely to discover that a stylesheet begins with authored content. */
  const table = commentTableOf(trivia);
  const src = table.src;
  if (src === undefined || table.runStart[0] !== 0) {
    return;
  }
  if (e.emittedBlockTrivia.hasIndex(table, 0) || !runHasBlockComment(table, 0)) {
    return;
  }
  e.emittedBlockTrivia.addIndex(table, 0);
  for (let c = table.commentAt[0]!; c < table.commentAt[1]!; c++) {
    put(e, indent);
    put(e, src.slice(table.commentStart[c]!, table.commentEnd[c]!));
    put(e, '\n');
  }
}

function triviaSource(trivia: TriviaMap | undefined): string | undefined {
  const commentSource = trivia === undefined ? undefined : commentTableOf(trivia).src;
  if (commentSource !== undefined) {
    return commentSource;
  }
  const firstEntry = trivia?.entries('after').next();
  return firstEntry?.done === false ? firstEntry.value[1].src : undefined;
}

function isTriviaByte(char: number): boolean {
  return char === 32 || char === 9 || char === 10 || char === 13 || char === 12;
}

function emittedTriviaRunForRange(e: Emit, start: number, end: number): Trivia | undefined {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return undefined;
  }

  /*
   * PRE-EXISTING PREFIX SCAN, not converted. This wants the FIRST run enclosing
   * the range, so it must walk every run before `start` — the `break` below is a
   * termination condition, NOT a cost bound: the cost is O(runs before `start`),
   * and both callers sit inside `emitTopLevelBlockCommentsBetween`'s per-comment
   * loop, making that path O(comments x runs). The rewind argument that forces a
   * binary search in `emitBlockCommentTriviaBetween` does NOT apply here — that
   * caller's index is strictly monotonic, so a local cursor threaded through
   * both helpers would make this O(1) amortized. Left for a follow-up because it
   * is a caller-side change, not this lane's one-function scope.
   */
  const table = commentTableOf(trivia);
  for (let i = 0; i < table.runs.length; i++) {
    if (table.runStart[i]! <= start && table.runEnd[i]! >= end) {
      return e.emittedBlockTrivia.hasIndex(table, i) ? table.runs[i] : undefined;
    }
    if (table.runStart[i]! > start) {
      break;
    }
  }
  return undefined;
}

function markTriviaRunForRange(e: Emit, start: number, end: number): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }
  const table = commentTableOf(trivia);
  for (let i = 0; i < table.runs.length; i++) {
    if (table.runStart[i]! <= start && table.runEnd[i]! >= end
      && table.commentAt[i + 1]! - table.commentAt[i]! === 1) {
      e.emittedBlockTrivia.addIndex(table, i);
      return;
    }
    if (table.runStart[i]! > start) {
      return;
    }
  }
}

function emitTopLevelBlockCommentsBetween(
  e: Emit,
  start: number,
  end: number,
  indent: string
): number {
  const source = triviaSource(e.trivia);
  if (source === undefined) {
    return 0;
  }
  let emitted = 0;
  let index = Math.max(0, start);
  const limit = Math.min(end, source.length);
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let canEmitTopLevelComment = true;
  while (index < limit) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 ? limit : newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0 || close + 2 > limit) {
        break;
      }
      const commentEnd = close + 2;
      if (
        canEmitTopLevelComment
        && parens === 0
        && brackets === 0
        && braces === 0
        && emittedTriviaRunForRange(e, index, commentEnd) === undefined
      ) {
        put(e, indent);
        put(e, source.slice(index, commentEnd));
        put(e, '\n');
        markTriviaRunForRange(e, index, commentEnd);
        emitted++;
      }
      index = commentEnd;
      continue;
    }
    if (char === '"' || char === '\'') {
      const quote = char;
      index++;
      while (index < limit) {
        const inner = source[index]!;
        index += inner === '\\' ? 2 : 1;
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    switch (char) {
      case '(':
        if (braces === 0 && brackets === 0 && parens === 0) {
          canEmitTopLevelComment = false;
        }
        parens++;
        break;
      case ')':
        parens = Math.max(0, parens - 1);
        break;
      case '[':
        if (braces === 0 && brackets === 0 && parens === 0) {
          canEmitTopLevelComment = false;
        }
        brackets++;
        break;
      case ']':
        brackets = Math.max(0, brackets - 1);
        break;
      case '{':
        if (braces === 0 && brackets === 0 && parens === 0) {
          canEmitTopLevelComment = false;
        }
        braces++;
        break;
      case '}':
        braces = Math.max(0, braces - 1);
        if (braces === 0 && brackets === 0 && parens === 0) {
          canEmitTopLevelComment = true;
        }
        break;
      case ';':
        if (braces === 0 && brackets === 0 && parens === 0) {
          canEmitTopLevelComment = true;
        }
        break;
      default:
        if (!isTriviaByte(char.charCodeAt(0)) && braces === 0 && brackets === 0 && parens === 0) {
          canEmitTopLevelComment = false;
        }
        break;
    }
    index++;
  }
  return emitted;
}

function withDocumentTrivia<T>(e: Emit, document: Stylesheet, run: () => MaybePromise<T>): MaybePromise<T> {
  const previous = e.trivia;
  const next = triviaMapOf(document);
  if (next === undefined) {
    return run();
  }
  e.trivia = next;
  try {
    const result = run();
    if (isThenable(result)) {
      return result.finally(() => {
        e.trivia = previous;
      });
    }
    e.trivia = previous;
    return result;
  } catch (error) {
    e.trivia = previous;
    throw error;
  }
}

function authoredStatementWithTrivia(node: AtRuleStatement, e: Emit): string | null {
  return authoredSliceWithTrivia(node, e);
}

function authoredSliceWithTrivia(node: object, e: Emit): string | null {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return null;
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return null;
  }
  const spanEnd = sourceEndOf(node);
  return spanContainsCommentRun(trivia, spanStart, spanEnd)
    ? commentTableOf(trivia).src!.slice(spanStart, spanEnd).trim()
    : null;
}

/** True when some comment run sits wholly inside `[start, end]`. */
function spanContainsCommentRun(trivia: TriviaMap, start: number, end: number): boolean {
  const table = commentTableOf(trivia);
  for (let i = firstRunAtOrAfter(table, start); i < table.runs.length; i++) {
    if (table.runStart[i]! > end) {
      return false;
    }
    if (table.runEnd[i]! <= end) {
      return true;
    }
  }
  return false;
}

function firstBlockOpen(source: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    const char = source[index]!;
    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      index = close < 0 ? end : close + 2;
      continue;
    }
    if (char === '"' || char === '\'') {
      const quote = char;
      index++;
      while (index < end) {
        const inner = source[index]!;
        index += inner === '\\' ? 2 : 1;
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    if (char === '{') {
      return index;
    }
    index++;
  }
  return -1;
}

function keyframesPreludeWithTrivia(node: AtRuleBlock, e: Emit): string | null {
  if (!node.name.toLowerCase().includes('keyframes')) {
    return null;
  }
  const trivia = e.trivia;
  const span = sourceSpanOf(node);
  if (trivia === undefined || span === undefined) {
    return null;
  }

  if (!spanContainsCommentRun(trivia, span.start, span.end)) {
    return null;
  }
  const source = commentTableOf(trivia).src!;

  const open = firstBlockOpen(source, span.start, span.end);
  if (open < 0) {
    return null;
  }
  if (!spanContainsCommentRun(trivia, span.start, open)) {
    return null;
  }

  const header = source.slice(span.start, open).trim();
  if (!header.toLowerCase().startsWith(node.name.toLowerCase())) {
    return null;
  }
  const prelude = header.slice(node.name.length).trim();
  return prelude.includes('/*') ? prelude : null;
}

function authoredSelectorHeaderWithTrivia(node: SelectorList, rendered: readonly string[], e: Emit): string | null {
  if (selectorListHasAmpersand(node)) {
    return null;
  }
  for (const selector of node.selectors) {
    if (selectorBranchHasInterp(selector)) {
      return null;
    }
  }
  if (rendered.length !== node.selectors.length) {
    return null;
  }
  const trivia = e.trivia;
  if (trivia === undefined) {
    return null;
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return null;
  }
  const span = { start: spanStart, end: sourceEndOf(node) };
  const branchSpans = node.selectors.map(sourceSpanOf);
  if (branchSpans.some(branch => branch === undefined)) {
    return null;
  }

  let sawComment = false;
  let header = rendered[0] ?? '';
  for (let index = 1; index < rendered.length; index++) {
    const previous = branchSpans[index - 1]!;
    const current = branchSpans[index]!;
    const table = commentTableOf(trivia);
    const gapStart = Math.max(previous.end, span.start);
    const gapEnd = Math.min(current.start, span.end);
    const first = firstRunAtOrAfter(table, gapStart);
    const source = spanContainsCommentRun(trivia, gapStart, gapEnd) ? table.src : undefined;
    const comma = source === undefined ? -1 : source.indexOf(',', previous.end);
    let beforeCommaComments = '';
    let afterCommaComments = '';
    for (let i = first; i < table.runs.length && table.runStart[i]! <= gapEnd; i++) {
      if (table.runEnd[i]! <= gapEnd) {
        if (comma >= 0 && table.runEnd[i]! <= comma) {
          beforeCommaComments += inlineBlockCommentText(table.runs[i]!);
        } else {
          afterCommaComments += inlineBlockCommentText(table.runs[i]!, true);
        }
      }
    }
    if (beforeCommaComments !== '' || afterCommaComments !== '') {
      sawComment = true;
      header += beforeCommaComments;
    }
    header += ',\n';
    header += afterCommaComments;
    header += rendered[index]!;
  }
  return sawComment ? header : null;
}

function hasBodyBlockCommentTrivia(owner: object, e: Emit): boolean {
  const trivia = e.trivia;
  const body = bodySpanForTriviaReplay(owner, e);
  if (trivia === undefined || body === undefined) {
    return false;
  }
  const table = commentTableOf(trivia);
  for (let i = firstRunAtOrAfter(table, body.start); i < table.runs.length; i++) {
    if (table.runStart[i]! > body.end) {
      break;
    }
    if (table.runEnd[i]! <= body.end && runHasBlockComment(table, i)) {
      return true;
    }
  }
  return false;
}

/** A grouped leaf (declaration/comment) plus the frame its values resolve in.
 * `important` is a call-level `!important` override propagated from a
 * `.m() !important` placement onto every declaration the body emits. */
interface Leaf {
  node: Statement;
  frame: Frame;
  important?: boolean;
  leadingBlockComments?: readonly string[];

  /** Produced by the core `$apply` expansion; its repeated output stays visible. */
  fromApply?: true;
}

const pendingLeafBlockComments = new WeakMap<Leaf[], string[]>();

function hasPendingLeafBlockComments(group: Leaf[]): boolean {
  return (pendingLeafBlockComments.get(group)?.length ?? 0) !== 0;
}

function takePendingLeafBlockComments(group: Leaf[]): readonly string[] {
  const pending = pendingLeafBlockComments.get(group);
  if (pending === undefined) {
    return [];
  }
  pendingLeafBlockComments.delete(group);
  return pending;
}

function queueLeafBlockComments(group: Leaf[], comments: readonly string[]): void {
  if (comments.length === 0) {
    return;
  }
  const pending = pendingLeafBlockComments.get(group);
  if (pending === undefined) {
    pendingLeafBlockComments.set(group, [...comments]);
  } else {
    pending.push(...comments);
  }
}

function attachPendingLeafBlockComments(group: Leaf[], leaf: Leaf): Leaf {
  const pending = pendingLeafBlockComments.get(group);
  if (pending === undefined || pending.length === 0) {
    return leaf;
  }
  pendingLeafBlockComments.delete(group);
  return { ...leaf, leadingBlockComments: pending };
}

/** The resolved property name of a declaration (interp names resolve sync). */
function declName(node: Declaration, frame: Frame | null, e: EvalCtx): string {
  return typeof node.name === 'string' ? node.name : evalBytesSync(node.name, frame, e);
}

/**
 * The extend pre-pass resolves selector interpolation SYNCHRONOUSLY, in place,
 * before the extend planner reads it. That pass deliberately tolerates an interp
 * it cannot resolve. It must not tolerate one that merely needs awaiting: doing
 * so left `.@{async}` with no text at all, which emitted a rule with an EMPTY
 * leading selector (`,\n.a { … }`) and silently dropped the `:extend()` — wrong
 * CSS, no error, no warning. Reported here like every other position that cannot
 * yet await, until the pre-pass itself moves onto the MaybePromise lane.
 *
 * TODO(maybe-promise-extend-prepass): give the extend pre-pass an awaitable lane
 * so an interpolated selector built from an async value can participate in
 * extend. Tracked in docs/architecture/core/HANDOFF.md.
 */
function rejectAsyncSelectorInterp(
  error: unknown,
  where: string,
  nodes: readonly object[],
  e: EvalCtx
): void {
  if (!(error instanceof AsyncSelectorInterp)) {
    return;
  }

  /*
   * Point at the most specific node that actually carries a source span: the
   * selector if the parser recorded one, else the rule. A diagnostic that lands
   * on 1:1 is worse than useless — it sends the reader to the top of the file.
   */
  const detail = `${where} "${interpTokenSpelling(error.token)}"`;
  for (const node of [...interpSpanCandidates(error.token), ...nodes]) {
    const location = callSiteLocation(node, e);
    if (location.line !== undefined) {
      throw ERR.asyncInSyncPosition({ node, ...location, meta: { where: detail } });
    }
  }
  throw ERR.asyncInSyncPosition({ node: nodes[0] ?? {}, meta: { where: detail } });
}

/**
 * [extend/selector-interp] Resolve a compound's interpolated simple tokens in place, in
 * `frame`, replacing each `@{…}` token with the static resolved text — the SAME
 * per-simple resolution {@link resolveCompound} performs at emit, so the mutated
 * compound serializes byte-identically. Static (`&`, `.a`) simple tokens are untouched.
 * The lazy `_hasInterp` / `_canon` memos are cleared so the fast static path recomputes.
 */
function resolveCompoundInterpInPlace(comp: CompoundSelector, frame: Frame | null, e: EvalCtx): void {
  if (!compoundHasInterp(comp)) {
    return;
  }

  /*
   * Resolve EVERY interpolated simple before mutating any of them. A partial
   * mutation (simple 0 replaced, simple 1 throwing) would leave the compound in a
   * state that is neither the authored selector nor the resolved one, and the
   * caller's recovery path would then serialize that corruption.
   */
  const resolved: Array<{ index: number; text: string }> = [];
  const pseudos: PseudoSelector[] = [];
  for (let i = 0; i < comp.value.length; i++) {
    const sim = comp.value[i]!;
    if (sim.type === 'PseudoSelector' && sim.args !== null) {
      if (pseudoHasInterp(sim)) {
        probePseudoInterp(sim, frame, e);
        pseudos.push(sim);
      }
      continue;
    }
    if (sim.interp !== null) {
      resolved.push({ index: i, text: resolveSimpleTextSync(sim, frame, e) });
    }
  }
  for (const { index, text } of resolved) {
    comp.value[index] = simpleSelector(text);
  }
  for (const p of pseudos) {
    resolvePseudoInterpInPlace(p, frame, e);
  }
  comp._hasInterp = false;
  comp._canon = undefined;
}

/**
 * [extend/selector-interp] Resolve every interpolated leaf under a structured
 * pseudo WITHOUT mutating anything, so a member that cannot resolve throws
 * BEFORE the first write. {@link resolveSelectorBranchInterpInPlace} rewrites as
 * it walks, so `:not(.#{$ok}, .#{$broken})` would otherwise leave branch one
 * rewritten and branch two authored — exactly the half-state the staging
 * comment above forbids, and the state the pre-pass's "leave the selector
 * verbatim" recovery would then serialize.
 */
function probePseudoInterp(p: PseudoSelector, frame: Frame | null, e: EvalCtx): void {
  const args = p.args;
  if (args === null) {
    return;
  }
  for (const branch of args.selectors) {
    for (const term of selectorBranchTerms(branch)) {
      for (const sim of termTokens(term)) {
        if (sim.type === 'PseudoSelector') {
          probePseudoInterp(sim, frame, e);
          continue;
        }
        if (sim.interp !== null) {
          resolveSimpleTextSync(sim, frame, e);
        }
      }
    }
  }
}

/**
 * [extend/selector-interp] Resolve a structured pseudo's interpolated ARGUMENT
 * members in place. The pseudo itself stays a `PseudoSelector` — collapsing it
 * to a flat `SimpleSelector` would discard `crossable`, and the extend IR forks
 * a crossable `:is(…)` into a structured graft off exactly that field. Only the
 * members below it are rewritten, so the token keeps its structure and loses its
 * frame dependence.
 */
function resolvePseudoInterpInPlace(p: PseudoSelector, frame: Frame | null, e: EvalCtx): void {
  const args = p.args;
  if (args === null || !pseudoHasInterp(p)) {
    return;
  }
  for (let i = 0; i < args.selectors.length; i++) {
    args.selectors[i] = resolveSelectorBranchInterpInPlace(args.selectors[i]!, frame, e);
  }
  p._hasInterp = false;
}

function resolveSelectorTermInterpInPlace(term: SelectorTerm, frame: Frame | null, e: EvalCtx): SelectorTerm {
  if (term.type === 'CompoundSelector') {
    resolveCompoundInterpInPlace(term, frame, e);
    return term;
  }
  if (term.type === 'PseudoSelector' && term.args !== null) {
    if (pseudoHasInterp(term)) {
      probePseudoInterp(term, frame, e);
      resolvePseudoInterpInPlace(term, frame, e);
    }
    return term;
  }
  return term.interp !== null ? simpleSelector(resolveSimpleTextSync(term, frame, e)) : term;
}

function resolveSelectorBranchInterpInPlace(c: SelectorBranch, frame: Frame | null, e: EvalCtx): SelectorBranch {
  if (!selectorBranchHasInterp(c)) {
    return c;
  }
  if (c.type !== 'ComplexSelector' && c.type !== 'RelativeSelector') {
    return resolveSelectorTermInterpInPlace(c, frame, e);
  }
  const hasLiteralAmpersand = selectorBranchHasAmpersand(c);
  const start = c.type === 'RelativeSelector' ? 1 : 0;
  const resolvedTerms: Array<{ index: number; term: SelectorTerm }> = [];
  for (let index = start; index < c.value.length; index += 1) {
    const term = c.value[index];
    if (term !== undefined && typeof term !== 'string') {
      resolvedTerms.push({ index, term: resolveSelectorTermInterpInPlace(term, frame, e) });
    }
  }
  for (const { index, term } of resolvedTerms) {
    c.value[index] = term;
  }
  c._hasInterp = false;
  c._hasAmp = hasLiteralAmpersand;
  c._canon = undefined;
  return c;
}

/**
 * [extend/selector-interp] The extend engine ({@link computeExtends}) reads each rule
 * selector's IR BEFORE the frame walk, so a `@{…}` token (`[data=@{attr-data}]`,
 * `.@{n}`) is unresolved (`text: null` → `''`) at match/emit time — the interp rule
 * neither matches an `:extend()` target nor emits its concrete header. This pre-pass
 * resolves each interp selector to its static text in the SAME lexical frame emit
 * would use (a rule's own selector resolves in its PARENT frame), so both the matcher
 * and the nested-plan header see the concrete selector. It mirrors the extend planner's
 * walk EXACTLY (Ruleset + AtRuleBlock only; never a MixinDefinition body — those resolve per call
 * frame, not lexically, and the planner skips them too), so no rule is resolved that the
 * planner would not also see. A resolution throw (an unresolvable interp on a guarded /
 * never-emitted rule) leaves the selector untouched — identical to the pre-pass being
 * absent, never worse than baseline.
 */
function resolveSelectorInterpForExtend(statements: Statement[], frame: Frame, e: EvalCtx): void {
  for (const st of statements) {
    /*
     * The extend planner reads selectors before the normal frame walk.  Replay
     * declaration activation in this cold prepass so live references observe
     * exactly the declarations that have appeared so far; do not substitute a
     * scoped lookup when the live cell has not been activated.
     */
    if (st.type === 'VariableDeclaration') {
      activateVariableDeclaration(st, frame, e);
    } else if (st.type === 'Declaration') {
      /*
       * Selector interpolation is planned before ordinary body emission. Keep a
       * prepass-local property timeline so `$["name"]` observes declarations
       * already encountered in its containing rule, just as normal rendering
       * will, without a text reparse or CST dependency.
       */
      recordPropertyDeclaration(frame, st, frame);
    } else if (st.type === 'Ruleset') {
      const list = st.selector;
      for (let index = 0; index < list.selectors.length; index++) {
        const c = list.selectors[index]!;
        if (!selectorBranchHasInterp(c)) {
          continue;
        }
        try {
          list.selectors[index] = resolveSelectorBranchInterpInPlace(c, frame, e);
        } catch (error) {
          /*
           * An AWAITABLE interp is a capability gap, not an unresolvable branch:
           * report it. Anything else (e.g. a guarded rule never emitted) leaves the
           * selector verbatim — the extend engine falls back to the baseline (no
           * match), never regresses.
           */
          rejectAsyncSelectorInterp(error, 'extend pre-pass rule selector', [c, list, st], e);
        }
      }

      /*
       * The same planner reads extend targets before matching. Resolve their
       * typed selector interpolation in this existing cold pass and lexical
       * frame, alongside rule selectors; no selector text recovery or second
       * traversal is introduced.
       */
      for (const inst of st.extendInstructions ?? []) {
        for (let index = 0; index < inst.target.selectors.length; index++) {
          const c = inst.target.selectors[index]!;
          if (!selectorBranchHasInterp(c)) {
            continue;
          }
          try {
            inst.target.selectors[index] = resolveSelectorBranchInterpInPlace(c, frame, e);
          } catch (error) {
            /*
             * As above: an awaitable target is reported; a genuinely unresolvable
             * one is preserved and the planner keeps its no-match behavior.
             */
            rejectAsyncSelectorInterp(error, 'extend pre-pass :extend() target', [c, inst.target, st], e);
          }
        }
      }
      const childFrame: Frame = {
        parent: frame,
        mixins: collectMixins(st.rules),
        declIndex: collectDeclIndex(st.rules), cells: null, reassign: null,
        statements: st.rules
      };
      resolveSelectorInterpForExtend(st.rules, childFrame, e);
    } else if (st.type === 'AtRuleBlock') {
      /*
       * Mirror the planner: an at-rule block does not open a new subject scope for
       * the selector run — recurse with the same frame.
       */
      resolveSelectorInterpForExtend(st.rules, frame, e);
    }
  }
}

/** Build extend IR from selector structure in the current render frame. Unlike the
 * old static prepass this never rewrites selector nodes: loop bodies are shared
 * canonical AST and can resolve differently on every iteration. */
function resolvedExtendBranch(node: SelectorBranch, frame: Frame, e: EvalCtx): MaybePromise<Branch> {
  const compound = (part: CompoundSelector): MaybePromise<Branch['segments'][number]['compound']> =>
    combineAll(part.value.map(simple => resolveSimpleText(simple, frame, e)), texts => ({
      value: texts.map(text => ({ t: 'text' as const, text }))
    }));
  const term = (part: SelectorTerm): MaybePromise<Branch['segments'][number]['compound']> =>
    part.type === 'CompoundSelector'
      ? compound(part)
      : mapMaybe(resolveSimpleText(part, frame, e), text => ({ value: [{ t: 'text' as const, text }] }));
  const terms = selectorBranchTerms(node);
  const combinators = selectorBranchCombinators(node);
  const parts = terms.map(part => term(part));
  return combineAll(parts, (compounds) => {
    const start = node.type === 'RelativeSelector' ? 1 : 0;
    const segments: Branch['segments'] = [{ combinator: node.type === 'RelativeSelector' ? combinators[0]! : ' ', compound: compounds[0]! }];
    for (let index = start; index < combinators.length; index++) {
      const valueIndex = node.type === 'RelativeSelector' ? index : index + 1;
      segments.push({ combinator: combinators[index]!, compound: compounds[valueIndex]! });
    }
    return mkBranch(segments);
  });
}

function resolvedExtendLevel(node: SelectorList, frame: Frame, e: EvalCtx): MaybePromise<Level> {
  return combineAll(node.selectors.map(selector => resolvedExtendBranch(selector, frame, e)), branches => branches);
}

function bodyMayPlanExtend(statements: readonly Statement[]): boolean {
  /*
   * Imported component bodies can be deeply nested. This admission scan must be
   * stack-safe and allocation-light: one explicit typed-statement cursor, no
   * selector IR and no recursive descent.
   */
  recordAstExtendProfile?.('astExtend.preflight.bodyAdmissions');
  const pending: Statement[] = [...statements];
  while (pending.length) {
    const statement = pending.pop()!;
    if (statement.type === 'Ruleset') {
      if (statement.extendInstructions?.length) {
        recordAstExtendProfile?.('astExtend.preflight.bodyFeatureBearing');
        return true;
      }
      for (const child of statement.rules) {
        pending.push(child);
      }
    } else if (statement.type === 'AtRuleBlock') {
      for (const child of statement.rules) {
        pending.push(child);
      }
    } else if (statement.type === 'For') {
      /*
       * `$for`/`each()` bodies are the one dynamic placement form that must
       * admit imported extend planning even before their iterable is evaluated.
       */
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
      if (statement.type === 'Ruleset') {
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
                parent: frame, mixins: collectMixins(statement.rules),
                declIndex: collectDeclIndex(statement.rules), cells: null, reassign: null,
                statements: statement.rules,
                ...(frame.extendPlacement ? { extendPlacement: frame.extendPlacement } : {})
              };
              const nested = collectPlacedExtendFacts(statement.rules, childFrame, e, overlay, rulePath, scope, subject, hidden, referenceBoundary);
              return isThenable(nested) ? nested.then(() => run(index + 1)) : run(index + 1);
            }

            /*
             * `resolvedExtendLevel` is one selector-list level. An inline
             * `:extend()` still lives at this rule's full ancestor path, just
             * like the static planner's `[...path, levelFromSelectorList(...)]`.
             * Keep the planner's `Level[]` contract here: passing a bare Level
             * makes composePath treat its first Branch as a Level.
             */
            const resolvedExtender = instruction.subject
              ? mapMaybe(resolvedExtendLevel(instruction.subject, frame, e), level => [...path, level])
              : rulePath;
            return mapMaybe(resolvedExtender, extenderPath => mapMaybe(resolvedExtendLevel(instruction.target, frame, e), (targets) => {
              for (const target of targets) {
                overlay.instructions.push({
                  target, partial: instruction.partial, extenderPath,
                  scope, order: overlay.instructions.length, extenderHidden: hidden || statement.reference === true,
                  referenceBoundary
                });
                recordAstExtendProfile?.('astExtend.preflight.overlayInstructions');
              }
              return addInstructions(instructionIndex + 1);
            }));
          };
          return addInstructions(0);
        };
        const placed = mapMaybe(own, addRule);
        return placed;
      }
      if (statement.type === 'AtRuleBlock') {
        const nested = collectPlacedExtendFacts(statement.rules, frame, e, overlay, path, scope, parent, hidden, referenceBoundary);
        if (isThenable(nested)) {
          return nested.then(() => run(index + 1));
        }
        continue;
      }
      if (statement.type === 'For' && bodyMayPlanExtend(statement.rules)) {
        return mapMaybe(forItems(statement.iterable, frame, e), (items) => {
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
        });
      }
    }
  };
  return run(0);
}

/** Build an extend-only document view for `(reference)` imports.  This is
 * deliberately separate from emission: it loads through the existing Context
 * capability, keeps import-once identity locally, activates only variables in
 * source order, and contributes the same parsed Ruleset identities solely to
 * extend planning. The render walk still owns source-order emission; this is
 * the one intentional pre-render planner view, never a reparse or tree bridge. */
type ExtendPlannerInput = {
  root: Stylesheet;
  hiddenRules: ReadonlySet<Ruleset>;
  referenceBoundaries: ReadonlyMap<Ruleset, object>;
  overlay: PlanOverlay;
};

function planImportedExtends(
  root: Stylesheet,
  frame: Frame,
  e: Emit,
  importDocument: SerializeOptions['importDocument'] | undefined,
  deferUnreadyImports = false
): MaybePromise<ExtendPlannerInput> {
  recordAstExtendProfile?.('astExtend.preflight.calls');

  /*
   * A Context-owned import route is already MaybePromise at the document boundary,
   * so it may discover an imported-only extend. Direct AST consumers preserve the
   * historical synchronous no-extend import path.
   * A Context alone must not promote a document with neither imports nor
   * extends into the async planner path. The Context remains available to
   * synchronous callable-body ownership, while actual import/extend facts opt
   * into planning.
   */
  if (e.context?.options.processImports === false
    || !importDocument
    || (!documentHasExtend(root) && !root.rules.some(child => child.type === 'StyleImport'))) {
    recordAstExtendProfile?.('astExtend.preflight.noFeatureBypasses');
    return { root, hiddenRules: new Set(), referenceBoundaries: new Map(), overlay: { subjects: [], instructions: [] } };
  }
  const seen = new Set<string>();
  const overlay: { subjects: PlanSubject[]; instructions: PlanInstruction[] } = { subjects: [], instructions: [] };
  const visit = async (statements: readonly Statement[], scope: Frame): Promise<void> => {
    const deferred: StyleImport[] = [];
    const visitImport = async (st: StyleImport): Promise<void> => {
      recordAstExtendProfile?.('astExtend.preflight.importsVisited');
      const options = importRequestOptions(st.options);
      const specifier = importSpecifier(st, scope, e);
      if (importHasOption(options, 'inline')) {
        return;
      }
      recordAstExtendProfile?.('astExtend.preflight.importsLoadable');
      const request: ImportDocumentRequest = { node: st, specifier, options };
      const prepared = e.plannedImportDocuments?.get(st);
      const loaded = prepared === undefined ? await importDocument(request) : prepared.loaded;
      if (prepared === undefined) {
        e.plannedImportDocuments?.set(st, { request, loaded });
      }
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
      rememberImportedCallableBodies(loaded.document, loaded.document.rules, e.context);

      /*
       * Match the importer: a loaded document is a lexical splice and publishes
       * its direct facts into the importing frame before its body is walked.
       */
      for (const child of loaded.document.rules) {
        if (child.type === 'MixinDefinition') {
          publishImportedMixinDefinition(scope, child);
        }
        if (child.type === 'VariableDeclaration') {
          publishImportedVariableDeclaration(scope, child);
        }
        if (child.type === 'Ruleset') {
          publishImportedRuleset(scope, child);

          /*
           * A plain imported ruleset is also a zero-argument Less mixin. Its
           * canonical Ruleset remains the namespace fact; publish only its
           * synthesized callable fact for bare `.name()` lookup.
           */
          publishOrderedMixins(scope, await orderedMixinsForStatements([child], scope, e), scope);
        }
      }
      const childFrame: Frame = { parent: scope, mixins: collectMixins(loaded.document.rules), declIndex: collectDeclIndex(loaded.document.rules), cells: null, reassign: null, statements: loaded.document.rules };

      /*
       * Ordinary imports must not pay selector-IR/planning cost. The typed body
       * itself is the admission fact: it includes static Ruleset extends and the
       * possible `$for`/`each()` loop bodies whose concrete placements the
       * planner must still preflight.
       * A reference import contributes hidden Ruleset subjects even when the imported
       * document contains no own `:extend()`: a visible extender in the importing
       * document may still target one of those rules. Ordinary imports retain the
       * feature-bearing admission gate and avoid planner work when no extend facts
       * can participate.
       */
      if (bodyMayPlanExtend(loaded.document.rules) || importHasOption(options, 'reference')) {
        recordAstExtendProfile?.('astExtend.preflight.importsFeatureBearing');
        const referenceBoundary = importHasOption(options, 'reference') ? {} : null;
        const placed = collectPlacedExtendFacts(loaded.document.rules, childFrame, e, overlay, [], [], null, referenceBoundary !== null, referenceBoundary);
        if (isThenable(placed)) {
          await placed;
        }
      }
      const collect = async (): Promise<void> => {
        await visit(loaded.document!.rules, childFrame);
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
      } else if (st.type === 'StyleImport') {
        try {
          await visitImport(st);
        } catch (error) {
          if (!(error instanceof ImportPathNotReady)) {
            throw error;
          }
          deferred.push(st);
        }
      } else if (st.type === 'AtRuleBlock') {
        await visit(st.rules, scope);
      }
    }
    for (const pending of deferred) {
      try {
        await visitImport(pending);
      } catch (error) {
        if (error instanceof ImportPathNotReady) {
          if (deferUnreadyImports) {
            return;
          }
          throw error.cause;
        }
        throw error;
      }
    }
  };
  return visit(root.rules, frame).then(() => ({
    root, hiddenRules: new Set(), referenceBoundaries: new Map(), overlay
  }));
}

export type PrepareStaticImportsOptions = Pick<
  SerializeOptions,
  'context' | 'evaluator' | 'modes' | 'trivia' | 'optional' | 'collapseNesting' | 'importDocument' | 'pluginHost' | 'io'
>;

export function prepareStaticImports(root: Stylesheet, options?: PrepareStaticImportsOptions): MaybePromise<PreparedImports> {
  const pluginHost = options?.pluginHost;
  const importDocument = options?.importDocument ?? (options?.context ? importThroughContext(options.context) : undefined);
  const rootFns = globalScopedFns(pluginHost);
  const documents = new WeakMap<StyleImport, PlannedImportDocument>();
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: null,
    ev: options?.evaluator ?? options?.context?.evaluator ?? null,
    modes: options?.modes ?? options?.context?.options ?? DEFAULT_MODES,
    trivia: options?.trivia ?? triviaMapOf(root) ?? options?.context?.opts.trivia,
    context: options?.context,
    excluded: new Set(),
    propNames: new Set(),
    optional: options?.optional ?? false,
    pending: [],
    drops: [],
    depth: 0,
    collapse: options?.collapseNesting !== false,
    extends: null,
    hoistMode: false,
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1 },
    mixinDepth: 0,
    loadedImports: null,
    multipleImportDepth: 0,
    referenceImportDepth: 0,
    importDocument,
    plannedImportDocuments: documents,
    preparedImportsOwnedByCaller: false,
    plannedForExtendPlacements: null,
    hoistedCssImports: null,
    emittedBlockTrivia: new EmittedTrivia(),
    scopedFunctionNames: scopedFunctionNames(rootFns),
    lambdaFunctionNames: new Set(),
    fnScopeVersion: 0,
    pluginHost,
    io: options?.io
  };
  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.rules),
    declIndex: collectDeclIndex(root.rules),
    cells: null,
    reassign: null,
    statements: root.rules,
    fns: rootFns,
    sourceOwner: e.context?.currentSourceOwner?.() ?? null
  };
  if (rootFns) {
    rootFrame.fnScope = rootFrame;
    rootFrame.fnScopeVersion = e.fnScopeVersion;
  }
  const plannerRootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.rules),
    declIndex: collectDeclIndex(root.rules),
    cells: null,
    reassign: null,
    statements: root.rules,
    fns: rootFns
  };
  if (rootFns) {
    plannerRootFrame.fnScope = plannerRootFrame;
    plannerRootFrame.fnScopeVersion = e.fnScopeVersion;
  }
  const prepare = prepareBodyPlugins(root.rules, rootFrame, e);
  const plan = (): MaybePromise<PreparedImports> => {
    if (!importDocument) {
      return { documents };
    }
    const planned = planImportedExtends(root, plannerRootFrame, e, importDocument, true);
    return mapMaybe(planned, () => ({ documents }));
  };
  return mapMaybe(prepare, plan);
}

export function serialize(root: Stylesheet, options?: SerializeOptions): SerializeReturn {
  const pluginHost = options?.pluginHost;
  const importDocument = options?.importDocument ?? (options?.context ? importThroughContext(options.context) : undefined);
  const rootFns = globalScopedFns(pluginHost);
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: options?.trackPositions ? [] : null,
    ev: options?.evaluator ?? options?.context?.evaluator ?? null, // typed value evaluator
    modes: options?.modes ?? options?.context?.options ?? DEFAULT_MODES,
    trivia: options?.trivia ?? triviaMapOf(root) ?? options?.context?.opts.trivia,
    context: options?.context,
    excluded: new Set(), // [resolver] per-declaration cycle guard
    propNames: new Set(), // [property-interp] interpolated-name re-entrancy guard
    optional: options?.optional ?? false, // [resolver] strict (default) vs optional miss
    pending: [], // async patches
    drops: [], // [null] declarations that may still elide on the async lane
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
    plannedImportDocuments: options?.preparedImports?.documents ?? (importDocument ? new WeakMap() : null),
    preparedImportsOwnedByCaller: options?.preparedImports !== undefined,
    plannedForExtendPlacements: null,
    hoistedCssImports: null,
    emittedBlockTrivia: new EmittedTrivia(),
    scopedFunctionNames: scopedFunctionNames(rootFns), // absent idle ⇒ fn-dispatch walk skipped
    lambdaFunctionNames: new Set(), // [lambda-fn] empty idle ⇒ user-`@function` lookup skipped
    fnScopeVersion: 0,
    pluginHost, // [plugin/P2] injected plugin runtime for scope-local `@plugin`
    io: options?.io // [io] per-render file-read capability for the IO built-ins
  };
  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.rules),
    declIndex: collectDeclIndex(root.rules), cells: null, reassign: null,
    statements: root.rules,
    fns: rootFns, // [plugin/P1] root-global scoped fns (null today)
    sourceOwner: e.context?.currentSourceOwner?.() ?? null
  };
  if (rootFns) {
    rootFrame.fnScope = rootFrame;
    rootFrame.fnScopeVersion = e.fnScopeVersion;
  }
  const continueRender = (planned: ExtendPlannerInput): SerializeReturn => {
    const plannedRoot = planned.root;

    /*
     * [extend/selector-interp] Resolve interpolated selectors to static text BEFORE the
     * extend planner reads their IR — only when the document actually has an `:extend()`
     * (the planner's own gate), so a non-extend document is byte- and cost-identical.
     */
    if (documentHasExtend(plannedRoot)) {
      resolveSelectorInterpForExtend(plannedRoot.rules, rootFrame, e);
    }
    e.extends = computeExtends(plannedRoot, planned.hiddenRules, planned.referenceBoundaries, planned.overlay); // [extend] null when no `:extend()` anywhere
    const start = e.off;

    /*
     * [charset] Hoist the first document-level `@charset` ahead of all body
     * content; inline occurrences are dropped during the walk (dedupe).
     */
    emitHoistedCharset(root.rules, rootFrame, e);

    /*
     * A caller-provided import handler owns terminal-import decisions itself. The
     * public Context route has no such driver callback, so it uses this direct
     * root-output rule while retaining Context loading for non-terminal imports.
     */
    if (!options?.importDocument) {
      emitHoistedCssImports(root.rules, rootFrame, e);
    }
    emitLeadingDocumentBlockComments(e);
    const emitted = emitDocumentStatements(root.rules, rootFrame, e, importDocument);
    const finalize = (): SerializeResult => {
      /* [null] A declaration whose async value resolved to `null` is dropped here —
       * blanked rather than spliced, because a pending slot addresses BY INDEX. */
      for (const drop of e.drops) {
        if (drop.sink.elided) {
          for (let i = drop.from; i < drop.to; i++) {
            e.chunks[i] = '';
          }
        }
      }
      return e.positions ? { css: e.chunks.join(''), positions: e.positions } : { css: e.chunks.join('') };
    };
    const finish = (): SerializeReturn => {
      if (e.positions) {
        e.positions.push({ node: root, type: root.type, start, end: e.off });
      }

      // lift to async ONLY if a genuinely-async built-in reserved a placeholder.
      if (e.pending.length > 0) {
        return Promise.all(e.pending.map(x => x.p.then((b) => {
          e.chunks[x.i] = b;
        }))).then(finalize);
      }
      return finalize();
    };
    return mapMaybe(emitted, finish);
  };

  /*
   * The reference-import planner owns an isolated lexical frame: planning must
   * never publish variables/mixins/rules into the later render frame.
   */
  const plannerRootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.rules),
    declIndex: collectDeclIndex(root.rules), cells: null, reassign: null,
    statements: root.rules,
    fns: rootFns
  };
  if (rootFns) {
    plannerRootFrame.fnScope = plannerRootFrame;
    plannerRootFrame.fnScopeVersion = e.fnScopeVersion;
  }
  const prepare = prepareBodyPlugins(root.rules, rootFrame, e);
  const plan = (): SerializeReturn => {
    const planned = planImportedExtends(root, plannerRootFrame, e, importDocument);
    return isThenable(planned) ? planned.then(continueRender) : continueRender(planned);
  };
  return mapMaybe(prepare, plan);
}

/** Emit a source document at the current source-order position without creating a wrapper node. */
function emitDocumentStatements(
  rules: readonly Statement[],
  frame: Frame,
  e: Emit,
  importDocument?: SerializeOptions['importDocument'],
  imported = false
): MaybePromise<void> {
  /*
   * A referenced document is a fact-only placement: route it through the
   * statement dispatcher so rules/at-rules can be suppressed while declarations,
   * mixin definitions, and nested imports still establish lookup facts.
   */
  const hasDynamicImportTarget = rules.some(child => child.type === 'StyleImport'
    && child.target.type !== 'Quoted'
    && !(child.target.type === 'Url' && child.target.value.type === 'Quoted'));
  if (!e.collapse && e.referenceImportDepth === 0 && !hasDynamicImportTarget) {
    /*
     * Keep the nested emitter's merge behavior for contiguous authored runs,
     * but make a root import an ordered barrier between those runs. Nested
     * import placement remains a separate parity slice; this is the public
     * Less root-import seam.
     */
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
    for (const child of rules) {
      if (child.type === 'AtRuleStatement' && e.hoistedCssImports?.has(child)) {
        continue;
      }
      if (child.type !== 'StyleImport') {
        batch.push(child);
        continue;
      }
      flushBatch();
      const emit = () => emitStyleImport(child, frame, e, importDocument);
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

  /*
   * Less permits an import path to depend on declarations introduced by a later
   * sibling import. Keep the original typed import node pending, continue this
   * lexical body, then make exactly one final attempt after those imports have
   * published their facts. No path text is recovered or parsed again.
   */
  const deferredImports: StyleImport[] = [];
  const delayedStatements: Statement[] = [];
  let documentTriviaCursor = 0;
  let documentTriviaSuppressedByDefinition = false;
  const emitBeforeDocumentStatement = (child: Statement): void => {
    if (documentTriviaSuppressedByDefinition) {
      documentTriviaCursor = statementStartOf(child) ?? documentTriviaCursor;
      documentTriviaSuppressedByDefinition = false;
      return;
    }
    emitBlockCommentTriviaBetween(e, documentTriviaCursor, statementStartOf(child), '');
  };
  const markAfterDocumentStatement = (child: Statement): void => {
    documentTriviaCursor = statementEndOf(child) ?? documentTriviaCursor;
  };
  const run = (child: Statement, allowDefer: boolean): MaybePromise<void> => {
    try {
      return emit(child);
    } catch (error) {
      if (allowDefer && child.type === 'StyleImport' && error instanceof ImportPathNotReady) {
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
      case 'Ruleset':
        /*
         * A reference-imported rule is normally output-hidden, but an extend
         * plan may contribute a visible branch from the importing document.
         * Let the existing visibility projection decide that case; do not
         * publish or otherwise render reference rules unconditionally.
         */
        if (e.referenceImportDepth === 0 || e.extends?.hiddenByRule.get(child)?.some(hidden => !hidden) === true) {
          emitBeforeDocumentStatement(child);
          const emitted = flatten(child, null, null, frame, e);
          markAfterDocumentStatement(child);
          return emitted;
        }
        break;
      case 'MixinDefinition':
        if (imported) {
          /*
           * `emitStyleImport` already published this definition in the import's
           * source-order callable stream. Keep its existing ordinary-call
           * publication, but do not record the same source statement twice.
           */
          publishImportedMixinDefinition(frame, child, false);
        } else {
          publishSelectedMixinDefinition(frame, child);
        }
        documentTriviaSuppressedByDefinition = true;
        break;
      case 'VariableDeclaration':
        activateVariableDeclaration(child, frame, e);
        markSilentStatementBlockCommentTrivia(child, e);
        if (!isValueSlotArray(child.value) && 'type' in child.value && isValueBlock(child.value)) {
          documentTriviaSuppressedByDefinition = true;
        }
        break;
      case 'MixinCall': {
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => {
          if (group.length) {
            return mapMaybe(flushBlock([], group, e), () => {
              group.length = 0;
            });
          }
        };
        return mapMaybe(expandCall(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'Apply': {
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => {
          if (group.length) {
            return mapMaybe(flushBlock([], group, e), () => {
              group.length = 0;
            });
          }
        };
        return mapMaybe(expandApply(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'Reference': {
        // A final call step can splice a detached ruleset at document level.
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => {
          if (group.length) {
            return mapMaybe(flushBlock([], group, e), () => {
              group.length = 0;
            });
          }
        };
        return mapMaybe(expandReferenceCall(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'For': {
        // a top-level `each(...)` loop — its body emits at the document level.
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => {
          if (group.length) {
            return mapMaybe(flushBlock([], group, e), () => {
              group.length = 0;
            });
          }
        };
        return mapMaybe(expandFor(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'If': {
        const body = selectIfBodyForRender(child, frame, e);
        if (!body) {
          break;
        }
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => {
          if (group.length) {
            return mapMaybe(flushBlock([], group, e), () => {
              group.length = 0;
            });
          }
        };
        return mapMaybe(walkBody(body, null, null, frame, group, flush, null, e), flush);
      }
      case 'While': {
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => {
          if (group.length) {
            return mapMaybe(flushBlock([], group, e), () => {
              group.length = 0;
            });
          }
        };
        return mapMaybe(
          runWhile(child, frame, e, rules => walkBody(rules, null, null, frame, group, flush, null, e)),
          flush
        );
      }
      case 'Declaration':
      case 'Comment':
        if (e.referenceImportDepth === 0) {
          emitBeforeDocumentStatement(child);
          emitLeaf({ node: child, frame }, e, true);
          markAfterDocumentStatement(child);
        }
        break;

      // [atrule] top-level at-rules
      case 'AtRuleBlock':
        if (e.referenceImportDepth === 0) {
          emitBeforeDocumentStatement(child);
          const emitted = emitAtRuleBlock(child, frame, e);
          markAfterDocumentStatement(child);
          return emitted;
        }
        break;
      case 'AtRuleStatement':
        if (e.referenceImportDepth === 0 && !e.hoistedCssImports?.has(child)) {
          emitBeforeDocumentStatement(child);
          emitAtRuleStatement(child, frame, e);
          markAfterDocumentStatement(child);
        }
        break;
      case 'Plugin':
        /*
         * Plugin is a lexical, non-emitting statement. Frame preparation has
         * already registered its functions before this dispatch.
         */
        break;
      case 'StyleImport':
        emitBeforeDocumentStatement(child);
        {
          const emitted = emitStyleImport(child, frame, e, importDocument);
          markAfterDocumentStatement(child);
          return emitted;
        }
      case 'ModuleImport':
        emitBeforeDocumentStatement(child);
        emitModuleImport(child, frame, e);
        markAfterDocumentStatement(child);
        break;
      case 'OpaqueAtRuleBlock':
        emitBeforeDocumentStatement(child);
        emitOpaqueAtRuleBlock(child, e);
        markAfterDocumentStatement(child);
        break;

      // a bare value-position call statement (`e('/* … */');`): evaluate + emit.
      case 'FunctionCall':
        emitBeforeDocumentStatement(child);
        {
          const emitted = emitCallStatement(child, frame, e);
          if (isThenable(emitted)) {
            return emitted.then(() => {
              markAfterDocumentStatement(child);
            });
          }
        }
        markAfterDocumentStatement(child);
        break;
    }
  };
  for (const child of rules) {
    /*
     * Once an import target is waiting on a later provider, keep ordinary output
     * behind the retry. Later imports (and live declaration activation) still
     * run now, so they can satisfy that target in the same lexical frame.
     */
    if (deferredImports.length > 0 && child.type !== 'StyleImport' && child.type !== 'VariableDeclaration') {
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
  const emitTrailingDocumentTrivia = (): void => {
    if (e.referenceImportDepth === 0) {
      emitTopLevelBlockCommentsBetween(e, documentTriviaCursor, Number.MAX_SAFE_INTEGER, '');
    }
  };
  const finish = (): MaybePromise<void> => {
    const retried = retry();
    const delayed = isThenable(retried) ? retried.then(emitDelayed) : emitDelayed();
    return isThenable(delayed)
      ? delayed.then(() => {
          emitTrailingDocumentTrivia();
        })
      : emitTrailingDocumentTrivia();
  };
  return pending ? pending.then(finish) : finish();
}

/**
 * The three positions still confined to the SYNCHRONOUS lane, each behind an
 * explicit, positioned failure rather than a silent wrong answer.
 *
 * TODO(maybe-promise-sync-islands): move these onto the MaybePromise lane.
 *   1. namespace-descent index building (`findPathInScope`) — its result is
 *      memoized on `frame.orderedMixins`, and a memo cannot hold a promise
 *      without every reader becoming awaitable;
 *   2. `$if` arm selection (`selectedIfBody`) — one of its callers is a
 *      synchronous at-rule body walk;
 *   3. value-position `$if` arm resolution (`pickIfBranch`) — reached from the
 *      synchronous `resolveValueBlock`.
 * These ARE reachable by ordinary code: any function call may resolve
 * asynchronously, so this is a real limitation, not merely a legacy-plugin one.
 * Tracked in docs/architecture/core/HANDOFF.md.
 */
function settledGuard<T>(value: MaybePromise<T>, where: string, node: object, e: EvalCtx): T {
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw ERR.asyncInSyncPosition({ node, ...callSiteLocation(node, e), meta: { where } });
  }
  return value;
}

/**
 * [guards] Whether a rule's `when (...)` guard passes in the scope where the rule
 * is defined (`frame`). An unguarded rule always emits; a CSS ruleset guard never
 * uses `default()` (that is a mixin-dispatch decision), so `isDefault` is `false`.
 */
function ruleGuardPasses(rule: Ruleset, frame: Frame, e: EvalCtx): MaybePromise<boolean> {
  if (!rule.guard) {
    return true;
  }
  if (rule.selector.selectors.length > 1) {
    throw ERR.guardedSelectorList({
      node: rule,
      ...callSiteLocation(rule.selector, e),
      meta: { count: rule.selector.selectors.length }
    });
  }
  if (guardUsesDefault(rule.guard)) {
    throw ERR.invalidFunction({
      node: rule,
      ...callSiteLocation(rule.selector, e),
      meta: {
        name: 'default',
        reason: 'default() is only allowed in parametric mixin guards'
      }
    });
  }
  return withUnitErrors(rule, e, () => evalGuard(rule.guard!, {
    resolveTyped: makeTypedResolver(frame, e),
    ev: e.ev,
    modes: e.modes,
    isDefault: () => false
  }));
}

/**
 * Select a Jess `$if` arm in authored order without activating it. Jess control
 * flow shares its containing frame, but extend analysis may inspect a selected
 * arm without publishing declaration state.
 */
function selectedIfBody(node: If, frame: Frame, e: Emit): Statement[] | null {
  for (const branch of node.branches) {
    if (branch.guard !== null && !settledGuard(withUnitErrors(node, e, () => evalGuard(branch.guard!, guardDeps(frame, e))), '$if arm selection', node, e)) {
      continue;
    }
    return branch.rules;
  }
  return null;
}

/**
 * The `$while` termination guarantee. A condition the body never moves would
 * otherwise hang the compiler with no output and no message; stopping with a
 * positioned error names the loop instead.
 */
const MAX_WHILE_ITERATIONS = 10_000;

/** The empty selection a `$while` presents when no `$if` arm has been chosen yet. */
const EMPTY_SELECTED_IF_BODIES: ReadonlyMap<If, Statement[]> = new Map();

/**
 * Drive a `$while`: re-evaluate the condition in the CONTAINING frame before
 * every iteration, and walk the body through the caller's own emitter.
 *
 * The frame is the caller's on purpose — a control block is not a scope, so the
 * body's declarations publish into the containing frame, and that is precisely
 * what lets the next condition read the counter the last iteration wrote. This
 * is the same frame discipline `$if` uses; `$for` differs only because its
 * bindings are per-iteration.
 *
 * The synchronous path stays a LOOP, not recursion: a bounded 10 000 iterations
 * of sync body emission would otherwise be 10 000 stack frames.
 */
function runWhile(
  node: While,
  frame: Frame,
  e: Emit,
  emitBody: (rules: Statement[]) => MaybePromise<void>
): MaybePromise<void> {
  /*
   * Publish the body's declarations into this frame's index BEFORE the first
   * condition runs. `$if` gets the same index through `selectIfBodyForRender`;
   * a `$while` has no arm to select, so it registers its one body directly.
   */
  frame.selectedDeclIndex = collectSelectedDeclIndex(
    frame.statements ?? [],
    frame.selectedIfBodies ?? EMPTY_SELECTED_IF_BODIES,
    frame.declIndex
  );
  const step = (start: number): MaybePromise<void> => {
    for (let i = start; i < MAX_WHILE_ITERATIONS; i++) {
      if (!settledGuard(withUnitErrors(node, e, () => evalGuard(node.guard, guardDeps(frame, e))), '$while condition', node, e)) {
        return;
      }
      const emitted = emitBody(node.rules);
      if (isThenable(emitted)) {
        return emitted.then(() => step(i + 1));
      }
    }
    throw ERR.loopIterationLimit({
      node,
      ...callSiteLocation(node, e),
      meta: { limit: MAX_WHILE_ITERATIONS }
    });
  };
  return step(0);
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
function isSelfComposed(rule: Ruleset, parent: string[], frame: Frame, e: Emit): boolean {
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

  /*
   * Dynamic plan facts exist only for looped placements. The lexical walk is
   * therefore off the ordinary static path and is bounded by the current nested
   * render-frame chain—not a tree walk or a rediscovery of source nodes.
   */
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

/**
 * Drop every placeholder branch from a composed header; `null` when that leaves
 * nothing, which is how a placeholder rule emits no output of its own.
 *
 * This runs on the FLAT composed header rather than on the authored selector
 * list on purpose: after extend folds an extender in, the header is longer than
 * the authored list, and the extender branch is exactly the one that must
 * survive. Filtering by text keeps that alignment free.
 */
function withoutPlaceholders(header: string[]): string[] | null {
  let hit = false;
  for (let i = 0; i < header.length; i++) {
    if (branchTextIsPlaceholder(header[i]!)) {
      hit = true;
      break;
    }
  }
  if (!hit) {
    return header;
  }
  const vis = header.filter(branch => !branchTextIsPlaceholder(branch));
  return vis.length > 0 ? vis : null;
}

function visibleHeader(rule: Ruleset, header: string[], frame: Frame, e: Emit): string[] | null {
  const ext = extendProjection(frame, e);
  const mask = ext?.hiddenByRule.get(rule);
  if (mask?.length === header.length) {
    const vis = header.filter((_, i) => mask[i] !== true);
    return vis.length > 0 ? withoutPlaceholders(vis) : null;
  }
  if (rule.reference === true && ext?.flatByRule.has(rule) !== true) {
    return null;
  }
  return withoutPlaceholders(header);
}

function flatten(
  rule: Ruleset,
  parent: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  imp = false,
  expandBubbledSelectorList = false
): MaybePromise<void> {
  // [guards] a guarded ruleset emits its block only when the guard is true.
  return mapMaybe(ruleGuardPasses(rule, frame, e), (passes) => {
    if (!passes) {
      return;
    }
    const rawComposed =
      parent === null ? rootStrings(rule.selector, frame, e) : compose(parent, rule.selector, frame, e);
    return mapMaybe(rawComposed, rawComposed =>
      flattenResolved(rule, parent, ancestor, frame, e, imp, rawComposed, expandBubbledSelectorList));
  });
}

/** Continue a flatten after its selector interpolation has resolved. Keeping this
 * separate preserves the static selector fast path: `mapMaybe` invokes it inline
 * when the selector has no async slot. */
function flattenResolved(
  rule: Ruleset,
  parent: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  imp: boolean,
  rawComposed: string[],
  expandBubbledSelectorList: boolean
): MaybePromise<void> {
  /*
   * [nesting] `rawComposed` is the fully-cartesian parent-list carried into nested
   * `&` composition (each `&` substitutes over every parent branch). The EMITTED
   * header + the OPAQUE ancestor carried into `&`-less children diverge from it:
   * - top level (no parent): header is the own selector list.
   * - a rule with ANY `&` branch keeps the cartesian `&`-substitution header
   * (the `selectors`-fixture cartesian form) — unchanged.
   * - an all-`&`-less nested rule COMPACT-joins: the accumulated ancestor `A` is
   * emitted ONCE and its multi-branch child list wraps in a single `:is(...)`
   * (`#…#deux :is(#fourth, #five, #six)`), never cartesian-distributed.
   * `childAncestor` is the single opaque unit deeper `&`-less levels concatenate
   * onto (a multi-branch header collapses to `:is(...)`).
   */
  let headerComposed: MaybePromise<string[]>;
  let childAncestor: string;

  /*
   * [nesting] At a ROOT context `rootStrings` resolves a parentless `&` to EMPTY.
   * An empty branch is not a selector: it must not prefix a nested rule with a bare
   * descendant space, and when NO branch survives (`& when (…) { … }`, `& { … }`)
   * the block is a transparent root group whose children compose as ROOT rules.
   * `null` here is what makes them take the `rootStrings` path rather than compose
   * against `''`. Only the CHILD context is filtered — the rule's own header keeps
   * every branch `rootStrings` produced.
   */
  let childComposed: string[] | null = rawComposed;
  if (parent === null) {
    headerComposed = rawComposed;
    if (rawComposed.some(s => s === '')) {
      const kept = rawComposed.filter(s => s !== '');
      childComposed = kept.length > 0 ? kept : null;
    }
    childAncestor = childComposed === null ? '' : wrapIsList(childComposed);
  } else if (selectorListHasAmpersand(rule.selector)) {
    headerComposed = parent.length < 2 ? rawComposed : composeHeader(parent, rule.selector, frame, e);

    /*
     * `headerComposed` can be pending only for an interpolated selector. The
     * raw composed list is already the correct parent context for children.
     */
    childAncestor = wrapIsList(rawComposed);
  } else if (expandBubbledSelectorList) {
    headerComposed = rawComposed;
    childAncestor = wrapIsList(rawComposed);
  } else {
    headerComposed = opaqueJoin(ancestor ?? wrapIsList(parent), rule.selector, frame, e);
    childAncestor = rawComposed[0] ?? '';
  }
  return mapMaybe(headerComposed, headerComposed =>
    flattenWithHeader(
      rule,
      parent,
      frame,
      e,
      imp,
      childComposed,
      headerComposed,
      childAncestor,
      expandBubbledSelectorList
    ));
}

function flattenWithHeader(
  rule: Ruleset,
  parent: string[] | null,
  frame: Frame,
  e: Emit,
  imp: boolean,

  /*
   * [nesting] the parent context this rule's BODY composes against — `rawComposed`,
   * minus the empty branches a root parentless `&` resolves to (`null` when the rule
   * is a transparent root group, so its children compose as root rules).
   */
  childComposed: string[] | null,
  headerComposed: string[],
  childAncestor: string,
  expandBubbledSelectorList: boolean
): MaybePromise<void> {
  /*
   * [extend] the rule's HEADER uses its fully-extended composed branches;
   * children still compose against the RAW composed selector and extend
   * independently (the composed model needs no parent-child override). Absent an
   * extend override the header is byte-identical to the no-extend serializer.
   */
  const projection = extendProjection(frame, e);
  const header0 = e.hoistMode
    ? projection?.hoistHeader.get(rule) ?? projection?.flatByRule.get(rule) ?? headerComposed
    : projection?.flatByRule.get(rule) ?? headerComposed;

  /*
   * [import:reference] drop the header branches that originate ONLY from hidden
   * `(reference)` rules; a rule left with no visible branch emits nothing (its body
   * still emits when the rule is pulled in as a mixin — a separate expansion path).
   */
  const header = visibleHeader(rule, header0, frame, e);
  if (header === null) {
    return;
  }
  const priorPlacement = frame.rulePlacements?.get(rule);
  const childFrame: Frame = priorPlacement?.parent === frame
    ? priorPlacement
    : {
        parent: frame,
        mixins: collectMixins(rule.rules),
        declIndex: collectDeclIndex(rule.rules), cells: null, reassign: null,
        statements: rule.rules,
        sourceOwner: sourceOwnerForBody(rule.rules, frame, e)
      };

  /*
   * Keep the exact render placement: imports within this Ruleset publish into its
   * child frame and become visible to a later namespace descent through Ruleset.
   */
  (frame.rulePlacements ??= new Map()).set(rule, childFrame);
  const group: Leaf[] = [];
  const flush = (): MaybePromise<void> => {
    if (group.length || hasPendingLeafBlockComments(group)) {
      /*
       * [adjacent-merge] `parent` (the parent expansion this rule was composed
       * against) keys sibling merges: two nested rulesets with the same parent ref
       * and header merge; top-level rules (`parent === null`) never do.
       */
      return mapMaybe(flushBlock(header, group, e, rule.selector, parent, rule), () => {
        group.length = 0;
      });
    }
  };

  /*
   * [partition] A collapsed child is a cascade boundary: direct parent leaves on
   * either side must remain separate blocks in authored order. `trailing` holds
   * that ordered stream; it must never regroup a later parent declaration ahead
   * of an emitted child merely to make the selector output smaller.
   */
  const emitBlock = (leaves: Leaf[]): MaybePromise<void> => {
    if (leaves.length || hasPendingLeafBlockComments(leaves)) {
      return flushBlock(header, leaves, e, rule.selector, parent, rule);
    }
  };
  const partition: Partition = {
    encounteredContainer: false,
    trailing: [],
    pending: [],
    emitBlock
  };
  const finish = (): MaybePromise<void> => {
    const runTrailing = (index: number): MaybePromise<void> => {
      for (let i = index; i < partition.trailing.length; i++) {
        const emitted = partition.trailing[i]!();
        if (isThenable(emitted)) {
          return emitted.then(() => runTrailing(i + 1));
        }
      }
    };
    if (!partition.encounteredContainer) {
      if (group.length === 0 && !hasPendingLeafBlockComments(group) && hasBodyBlockCommentTrivia(rule, e)) {
        return flushBlock(header, [], e, rule.selector, parent, rule);
      }
      return flush();
    }
    queueLeadingGroup(group, partition);
    flushPending(partition);
    return runTrailing(0);
  };
  const executeBody = () => mapMaybe(
    prepareBodyPlugins(rule.rules, childFrame, e),
    () => walkBody(
      rule.rules,
      childComposed,
      childComposed === null ? null : childAncestor,
      childFrame,
      group,
      flush,
      partition,
      e,
      imp,
      false,
      childFrame,
      false,
      expandBubbledSelectorList
    )
  );

  /*
   * A Ruleset can be rendered from an imported document before it is later called
   * as a ruleset-mixin. Its canonical body owns the imported document's source
   * identity in both placements, so nested `(inline)` imports resolve from that
   * document rather than the caller/root document.
   */
  return mapMaybe(withSourceOwner(e, childFrame.sourceOwner, executeBody), finish);
}

/** [partition] Queue the direct leaves preceding a collapsed child as one parent block. */
function queueLeadingGroup(group: Leaf[], p: Partition): void {
  if (group.length || hasPendingLeafBlockComments(group)) {
    const batch = group.splice(0, group.length);
    const trailing = takePendingLeafBlockComments(group);
    if (trailing.length > 0) {
      pendingLeafBlockComments.set(batch, [...trailing]);
    }
    p.lastLeadingGroup = batch;
    p.trailing.push(() => p.emitBlock(batch));
  }
}

/** [partition] Move any buffered post-child leaf run into `trailing` as one block. */
function flushPending(p: Partition): void {
  if (p.pending.length) {
    const batch = p.pending;
    p.pending = [];
    p.trailing.push(() => p.emitBlock(batch));
  }
}

/** [partition] Buffer every ordinary leaf after an emitted collapsed child. */
function addLeaf(
  group: Leaf[],
  partition: Partition | null,
  leaf: Leaf,
  _forceLeading: boolean,
  e: Emit,
  bodyTrivia?: BodyTriviaReplay
): void {
  queueBodyTriviaBefore(bodyTrivia, leaf.node, group, e);
  const next = attachPendingLeafBlockComments(group, leaf);
  if (partition && partition.encounteredContainer) {
    partition.pending.push(next);
  } else {
    group.push(next);
  }
}

/** Sparse body-comment cursor used only while replaying a callable body. */
interface BodyTriviaReplay {
  readonly table: CommentTable;
  readonly end: number;
  index: number;
}

function bodyTriviaReplay(owner: object, e: Emit): BodyTriviaReplay | undefined {
  const body = bodySpanForTriviaReplay(owner, e);
  const trivia = e.trivia;
  if (body === undefined || trivia === undefined) {
    return undefined;
  }
  const table = commentTableOf(trivia);
  if (table.runs.length === 0) {
    return undefined;
  }
  const low = firstRunAtOrAfter(table, body.start);
  return low < table.runs.length && table.runStart[low]! < body.end
    ? { table, end: body.end, index: low }
    : undefined;
}

function queueBodyTriviaBefore(
  replay: BodyTriviaReplay | undefined,
  before: Statement,
  group: Leaf[],
  e: Emit
): void {
  const end = statementStartOf(before);
  if (replay === undefined || end === undefined) {
    return;
  }
  const comments: string[] = [];
  const table = replay.table;
  while (replay.index < table.runs.length) {
    const i = replay.index;
    if (table.runStart[i]! >= end || table.runStart[i]! >= replay.end) {
      break;
    }
    replay.index++;
    if (table.runEnd[i]! <= replay.end && !e.emittedBlockTrivia.hasIndex(table, i)) {
      pushRunComments(table, i, comments, e);
    }
  }
  queueLeafBlockComments(group, comments);
}

/** Append run `i`'s comment texts and take ownership, if it carries any. */
function pushRunComments(table: CommentTable, i: number, into: string[], e: Emit): void {
  const from = table.commentAt[i]!;
  const to = table.commentAt[i + 1]!;
  if (from === to) {
    return;
  }
  const src = table.src!;
  e.emittedBlockTrivia.addIndex(table, i);
  for (let c = from; c < to; c++) {
    into.push(src.slice(table.commentStart[c]!, table.commentEnd[c]!));
  }
}

function queueBodyTriviaTail(
  replay: BodyTriviaReplay | undefined,
  group: Leaf[],
  partition: Partition | null,
  e: Emit
): void {
  if (replay === undefined) {
    return;
  }
  const comments: string[] = [];
  const table = replay.table;
  while (replay.index < table.runs.length) {
    const i = replay.index;
    if (table.runStart[i]! >= replay.end) {
      break;
    }
    replay.index++;
    if (table.runEnd[i]! <= replay.end && !e.emittedBlockTrivia.hasIndex(table, i)) {
      pushRunComments(table, i, comments, e);
    }
  }
  const target = partition?.encounteredContainer === true && partition.lastLeadingGroup !== undefined
    ? partition.lastLeadingGroup
    : group;
  queueLeafBlockComments(target, comments);
}

/**
 * [partition] Deferred-container ordering for a flattened Ruleset. Ordinary direct
 * leaves after any collapsed child enter `pending` and emit in a later parent
 * block. This preserves CSS cascade order: no declaration may cross a collapsed
 * nested rule to coalesce selector output. Passing `null` (top level, at-rule
 * bodies) keeps every rule inline in source order.
 */
interface Partition {
  encounteredContainer: boolean;

  /** Ordered deferred containers plus existing trailing-leaf blocks. */
  trailing: Array<() => MaybePromise<void>>;

  /** Buffered trailing declarations awaiting the next boundary (a run → one block). */
  pending: Leaf[];

  /** Emit a run of leaves as ONE block reusing this ruleset's header + merge key. */
  emitBlock: (leaves: Leaf[]) => MaybePromise<void>;

  /** The direct run that immediately precedes the next collapsed child. */
  lastLeadingGroup?: Leaf[];
}

/**
 * Walk a body, expanding mixin calls inline against the shared canonical body.
 * `forceLeading` remains threaded for call expansion compatibility, but it never
 * overrides a collapsed-child boundary: authored declaration order determines CSS
 * cascade order for every direct or expanded body.
 */
function walkBody(
  statements: Statement[],
  composed: string[] | null,
  ancestor: string | null, // [nesting] opaque accumulated ancestor for `&`-less child joins
  frame: Frame,
  group: Leaf[],
  flush: () => MaybePromise<void>,
  partition: Partition | null,
  e: Emit,
  imp = false, // call-level !important override
  forceLeading = false,
  propertyScope: Frame = frame, // Less `$property` visibility owner
  applyExpansion = false,
  expandBubbledSelectorList = false,
  bodyTrivia?: BodyTriviaReplay
): MaybePromise<void> {
  for (let index = 0; index < statements.length; index++) {
    const node = statements[index]!;
    if (node.type !== 'Declaration' && node.type !== 'Comment') {
      queueBodyTriviaBefore(bodyTrivia, node, group, e);
    }
    switch (node.type) {
      case 'Declaration': {
        /*
         * Property accessors see declarations in the order evaluation splices
         * them into the enclosing ruleset. A mixin body retains its call frame for
         * value evaluation but publishes this declaration into `propertyScope`.
         */
        const pushDeclLeaf = (declaration: Declaration): void => {
          recordPropertyDeclaration(propertyScope, declaration, frame);

          /*
           * Every collapsed child is a source-order/cascade boundary. A declaration
           * after it belongs to a later parent block, never the leading block.
           */
          addLeaf(group, partition, {
            node: declaration,
            frame,
            ...(imp ? { important: true } : {}),
            ...(applyExpansion ? { fromApply: true } : {})
          }, forceLeading, e, bodyTrivia);
        };

        /*
         * [nested-property] A property-root `{ … }` block expands to hyphenated
         * declarations. Shared with the nested emitter — see
         * {@link nestedPropertyDeclarations}.
         */
        const parts = nestedPropertyDeclarations(node, frame, e);
        if (parts !== null) {
          for (const part of parts) {
            pushDeclLeaf(part);
          }
          break;
        }
        pushDeclLeaf(node);
        break;
      }
      case 'Comment':
        /*
         * [partition] A comment keeps its authored position relative to nested
         * rules: before the first → leading block; after → its own trailing run.
         */
        addLeaf(group, partition, {
          node,
          frame,
          ...(imp ? { important: true } : {})
        }, forceLeading, e, bodyTrivia);
        break;
      case 'Ruleset': {
        /*
         * a null `composed` (top-level mixin/detached call) keeps nested
         * rules at the top level (own-strings), not composed against `[]`.
         */
        const rule = node;
        const rFrame = frame;
        const rComposed = composed;
        const rAncestor = ancestor;

        /*
         * [guards/&-merge] A nested rule whose selector composes to EXACTLY the
         * enclosing block's selector (a bare `&`, e.g. `& when (@c) { … }`) is not
         * a separate rule: its (guard-passing) body flows into THIS block, in place,
         * rather than opening a duplicate same-selector block. This yields the v5
         * single-block output (`.x { width; color; height }`) for `.x { width; &
         * when(c){color} & when(c){height} }`.
         */
        if (composed !== null && isSelfComposed(rule, composed, frame, e)) {
          const rComposedSelf = composed;
          const emitSelf = (passes: boolean): MaybePromise<void> => {
            if (!passes) {
              return;
            }
            const selfFrame: Frame = {
              parent: frame,
              mixins: collectMixins(rule.rules),
              declIndex: collectDeclIndex(rule.rules), cells: null, reassign: null,
              statements: rule.rules
            };
            return walkBody(
              rule.rules,
              rComposedSelf,
              ancestor,
              selfFrame,
              group,
              flush,
              partition,
              e,
              imp,
              forceLeading,
              propertyScope,
              applyExpansion,
              expandBubbledSelectorList
            );
          };
          const passes = ruleGuardPasses(rule, frame, e);
          const emitted = mapMaybe(passes, emitSelf);
          if (isThenable(emitted)) {
            return emitted.then(() => walkBody(
              statements.slice(index + 1), rComposedSelf, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope, applyExpansion, expandBubbledSelectorList
            ));
          }
          break;
        }

        /*
         * [partition] Queue the leading parent block before this collapsed child.
         * Without a partition (top level / at-rule body) it flushes and emits
         * inline in source order.
         */
        if (partition) {
          queueLeadingGroup(group, partition);
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => flatten(rule, rComposed, rAncestor, rFrame, e, imp, expandBubbledSelectorList));
        } else {
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => mapMaybe(
              flatten(rule, rComposed, rAncestor, rFrame, e, imp, expandBubbledSelectorList),
              () => walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group, flush,
                partition, e, imp, forceLeading, propertyScope, applyExpansion, expandBubbledSelectorList
              )
            ));
          }
          const emitted = flatten(rule, rComposed, rAncestor, rFrame, e, imp, expandBubbledSelectorList);
          if (isThenable(emitted)) {
            return emitted.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope, applyExpansion, expandBubbledSelectorList
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
          const emitted = walkBody(body, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
          if (isThenable(emitted)) {
            return emitted.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group, flush,
              partition, e, imp, forceLeading, propertyScope, applyExpansion
            ));
          }
        }
        break;
      }
      case 'While': {
        const emitted = runWhile(node, frame, e, rules => walkBody(
          rules, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion
        ));
        if (isThenable(emitted)) {
          return emitted.then(() => walkBody(
            statements.slice(index + 1), composed, ancestor, frame, group, flush,
            partition, e, imp, forceLeading, propertyScope, applyExpansion
          ));
        }
        break;
      }

      /*
       * [atrule-bubbling] an at-rule nested inside a ruleset body PROJECTS to this
       * block level (flat mode already emits everything at `e.depth`), carrying the
       * enclosing composed selector as its body context so a bubbleable at-rule
       * wraps the ruleset's selector inside. The decl group flushes first so the
       * at-rule sits after the ruleset's own block, matching Less's bubbling order.
       */
      case 'AtRuleBlock': {
        /*
         * [atrule-nested] `@starting-style` / unknown at-rules stay INSIDE this
         * block (no bubble): buffer with the decl group so they emit in source
         * order within the parent ruleset. Everything else bubbles out — a bubbling
         * at-rule is a container, so (partitioned) it defers to `trailing` after the
         * leading block, matching the legacy flatten order.
         */
        if (staysNested(node.name)) {
          addLeaf(group, partition, { node, frame }, forceLeading, e, bodyTrivia);
          break;
        }
        const atNode = node;
        const atFrame = frame;
        const atComposed = composed;
        if (partition) {
          queueLeadingGroup(group, partition);
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitAtRuleBlock(atNode, atFrame, e, atComposed));
        } else {
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => mapMaybe(
              emitAtRuleBlock(node, frame, e, composed),
              () => walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group, flush,
                partition, e, imp, forceLeading, propertyScope
              )
            ));
          }
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
        /*
         * A leaf only exists inside a SELECTOR context: the group it joins is
         * flushed as `<selector> { … }`. In a root-level control-flow body
         * (`@if true { @import "a.css"; }`) there is no selector, and flushing
         * the group would invent an anonymous ` { … }` wrapper around the
         * statement. Emit it at the current cursor instead — where a plain CSS
         * `@import` at root belongs.
         */
        if (staysNested(node.name) && composed !== null && composed.length > 0) {
          addLeaf(group, partition, { node, frame }, forceLeading, e, bodyTrivia);
          break;
        }
        const atNode = node;
        if (partition) {
          queueLeadingGroup(group, partition);
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitAtRuleStatement(atNode, frame, e));
        } else {
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              emitAtRuleStatement(node, frame, e);
              return walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group, flush,
                partition, e, imp, forceLeading, propertyScope, applyExpansion
              );
            });
          }
          emitAtRuleStatement(node, frame, e);
        }
        break;
      }
      case 'Plugin':
        break;
      case 'StyleImport': {
        /*
         * A CSS import recorded inside a canonical Ruleset is a rule-body
         * statement, not a bubbling container. Keep it in the authored leaf
         * group so it emits inside that rule (and inside any mixin/control-flow
         * body expanded there). Root and at-rule-body imports retain their
         * existing direct emission paths below.
         *
         * `(inline)` is raw-byte IO rather than a parsed document, but it is
         * still an asynchronous Context operation. It cannot be buffered as a
         * Leaf: leaf emission has no continuation slot, so the read would be
         * abandoned and an otherwise empty Ruleset would render without its
         * splice. Both Context-backed import forms run at this body cursor.
         */
        if (e.importDocument !== undefined) {
          /*
           * A Context-loaded import publishes lookup facts into this exact rule
           * placement. Its continuation must complete before a later sibling
           * statement dispatches (notably `#Namespace > .mixin()`); keeping it
           * as a buffered leaf discarded that MaybePromise.
           */
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => mapMaybe(
              emitStyleImport(node, frame, e, e.importDocument),
              () => walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group,
                flush, partition, e, imp, forceLeading, propertyScope
              )
            ));
          }
          const imported = emitStyleImport(node, frame, e, e.importDocument);
          if (isThenable(imported)) {
            return imported.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group,
              flush, partition, e, imp, forceLeading, propertyScope
            ));
          }
        } else if (partition !== null && composed !== null) {
          addLeaf(group, partition, { node, frame }, forceLeading, e, bodyTrivia);
        } else {
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => mapMaybe(
              emitStyleImport(node, frame, e, e.importDocument),
              () => walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group,
                flush, partition, e, imp, forceLeading, propertyScope
              )
            ));
          }

          /*
           * `(inline)` is intentionally not a document parse, but it is still
           * asynchronous Context IO. Keep this body cursor alive so a deferred
           * callable's document scope survives the raw-byte read.
           */
          const imported = emitStyleImport(node, frame, e, e.importDocument);
          if (isThenable(imported)) {
            return imported.then(() => walkBody(
              statements.slice(index + 1), composed, ancestor, frame, group,
              flush, partition, e, imp, forceLeading, propertyScope
            ));
          }
        }
        break;
      }
      case 'ModuleImport': {
        const importNode = node;
        if (partition) {
          queueLeadingGroup(group, partition);
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitModuleImport(importNode, frame, e));
        } else {
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              emitModuleImport(node, frame, e);
              return walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group, flush,
                partition, e, imp, forceLeading, propertyScope, applyExpansion
              );
            });
          }
          emitModuleImport(node, frame, e);
        }
        break;
      }
      case 'OpaqueAtRuleBlock': {
        const opaqueNode = node;
        if (partition) {
          queueLeadingGroup(group, partition);
          flushPending(partition);
          partition.encounteredContainer = true;
          partition.trailing.push(() => emitOpaqueAtRuleBlock(opaqueNode, e));
        } else {
          const flushed = flush();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              emitOpaqueAtRuleBlock(node, e);
              return walkBody(
                statements.slice(index + 1), composed, ancestor, frame, group, flush,
                partition, e, imp, forceLeading, propertyScope, applyExpansion
              );
            });
          }
          emitOpaqueAtRuleBlock(node, e);
        }
        break;
      }

      /*
       * a bare value-position call statement (`e('/* … *\/');`): flush the pending
       * decl group first so it emits at its authored position, then the line.
       */
      case 'FunctionCall': {
        addLeaf(group, partition, { node, frame }, forceLeading, e, bodyTrivia);
        break;
      }
      case 'MixinDefinition':
        publishSelectedMixinDefinition(frame, node);
        break;
      case 'VariableDeclaration':
        activateVariableDeclaration(node, frame, e);
        markSilentStatementBlockCommentTrivia(node, e);
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
  flush: () => MaybePromise<void>,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  imp = false,
  forceLeading = false, // [partition] inherited leading-hoist context
  captureFrames?: Frame[], // [namespace-accessor] collect each callee's callFrame
  propertyScope: Frame = frame, // caller scope receiving spliced declarations
  applyExpansion = false
): MaybePromise<void> {
  /*
   * A namespaced/compound call (`#ns .a .b()`, `.jo.ki()`, `.amp.support()`)
   * resolves by ELEMENT-VALUE descent through the scope's own rulesets (Less
   * `Ruleset.find` / `Selector.mixinElements`): combinators and `&` are ignored,
   * a compound run can span a descendant-nested definition, and the name resolves
   * ONLY inside the matched namespace body — it does NOT fall through to same-name
   * defs in the enclosing/root scope. A bare `.m()` still walks the scope chain
   * accumulating same-name overloads.
   * Explicit `MixinDefinition`s AND paren-less/plain rulesets callable as zero-arg mixins
   * (Less: `.foo {}` is a mixin) are both candidates, in definition order.
   * [closure] track each candidate's DEFINITION frame: a mixin body resolves its
   * free variables in the scope where the mixin was WRITTEN, not the call site
   * (less@4 `MixinDefinition.frames`). The path finder records the descended
   * definition scope; a bare `.m()` may resolve a def in an ANCESTOR frame.
   */
  const namespaced = call.path.length > 0;
  const homes = new Map<MixinDefinition, Frame>();

  /*
   * Candidate lookup builds each frame index as it reaches it, which can await
   * when a rule's mixin key is interpolated from an awaitable value.
   */
  return mapMaybe(namespaced
    ? findPathCandidates(frame, call, e, homes)
    : lookupCandidates(frame, call.name, e, homes), (rawCandidates) => {
  /*
   * [parent-exclusion] A paren-less ruleset callable as a zero-arg mixin
   * (`ruleMixin`) is EXCLUDED from its own candidate set while its body is on the
   * active expansion stack — the enclosing frame declines to be its own candidate.
   * `.recursion { .recursion(); }` re-binds to a same-name parametric def (or
   * no-ops) instead of re-entering its own body forever: a non-parametric re-entry
   * carries no new args and makes no progress. This is the mixin half of the file's
   * one exclusion principle (the variable half lives in `resolveVarStack` /
   * `e.excluded`); see `parentExcludes`. It mirrors less@4 mixin-call.js
   * `isRecursive` (a candidate that is NOT a parametric MixinDefinition and equals a
   * ruleset currently in `context.frames` is skipped). A ruleMixin's synthesized
   * `body` IS the source Ruleset's own body array, and the frame built to expand that
   * Ruleset carries the SAME array as `statements`, so identity on the array is the
   * rule identity. Parametric recursion DOES progress (new args) and is never
   * excluded here — guards terminate it, and the depth backstop below is the sole
   * error path for a non-terminating (bad-guard) runaway.
   */
    const candidates = rawCandidates.some(d => d.ruleMixin === true)
      ? rawCandidates.filter(d => d.ruleMixin !== true || !parentExcludes(frame, d.rules))
      : rawCandidates;

    /*
     * A callable becomes visible only when its defining statement has executed.
     * A statement MixinCall remains obligatory: a miss is an error, never a CSS
     * function fallback and never controlled by functionMode.
     */
    if (rawCandidates.length === 0) {
      unresolvedMixinCall(call, e);
    }

    /*
     * A ruleset currently expanding may deliberately exclude itself; that is the
     * recursion terminator, not a resolution miss.
     */
    if (candidates.length === 0) {
      return;
    }
    const queueComments = queueCommentOnlyMixinBodies(candidates, call, frame, e, group);
    const runDispatch = (): MaybePromise<void> => mapMaybe(dispatch(candidates, call, frame, e, homes, true), (selected) => {
      if (selected.length === 0) {
        return;
      }
      const bodyImp = imp || call.important; // propagate call-level !important
      /*
       * [recursion-backstop] Parametric self-recursion (`.loop(@n - 1)`) is terminated
       * by its guard; a MALFORMED guard (`.loop(@n) { .loop(@n + 1) }`) never stops and
       * would otherwise blow the JS stack. Each nested expansion adds one level here; a
       * high backstop (`MAX_MIXIN_DEPTH`) raises a clean, catchable error well before a
       * native stack overflow. This is NOT the parent-exclusion skip above and NOT a low
       * cap — legit deep guarded recursion runs unaffected far below the limit.
       */
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

        /*
         * [closure] free variables resolve in the mixin's DEFINITION scope FIRST, with
         * the call-site scope as a fallback — less@4 evaluates a mixin body under
         * `definitionFrames.concat(callerFrames)`. `parent` = the definition frame (so
         * a `@var` written in the mixin's home scope wins over a same-name caller var,
         * e.g. `mixins-closure`); `fallback` = the caller chain, which also keeps the
         * DYNAMIC expansion stack reachable for the ruleset-mixin parent-exclusion
         * check (`parentExcludes`) and lets the body see caller-published mixins. A
         * namespaced call already descends to the definition scope (home is confined
         * to the namespace), so it takes no caller fallback.
         */
        const homeFrame = homes.get(def) ?? frame;
        const callFrame: Frame = {
          parent: homeFrame,
          mixins: collectMixins(def.rules),
          declIndex: collectDeclIndex(def.rules, bindings), cells: cellsForParams(bindings), reassign: null,
          statements: def.rules,
          sourceOwner: sourceOwnerForBody(def.rules, frame, e),
          ...(namespaced || homeFrame === frame ? {} : { fallback: frame })
        };
        captureArgDefFrames(bindings, frame, callFrame, e);

        /*
         * [namespace-accessor] expose the callee's evaluated scope so a `#ns.m[@var]`
         * accessor can read its VARIABLE members (local `@x:` decls + nested-call
         * leaked vars), which never appear in the emitted-declaration output.
         */
        captureFrames?.push(callFrame);

        /*
         * Only an argument-bearing mixin is a transparent parametric wrapper for
         * this output rule. A zero-parameter `MixinDefinition` splices at its call site;
         * treating every AST MixinDefinition as force-leading moved `.mixin2()` output
         * ahead of an intervening nested rule in the Less property-accessor corpus.
         */
        const bodyForceLeading = forceLeading || def.params.length !== 0;

        /*
         * [adjacent-merge] each mixin expansion is a DISTINCT parent expansion: give
         * its body a FRESH composed-array identity (same values → byte-identical
         * composition) so nested rulesets from two separate calls of the same body do
         * NOT reopen-merge (`.class .inner {} .class .inner {}` stay two blocks —
         * `mixins-important`), while two nested siblings within ONE expansion still
         * share it and merge.
         */
        const bodyComposed = composed === null ? null : composed.slice();
        const bodyTrivia = bodyTriviaReplay(def, e);
        const executeBody = () => mapMaybe(
          prepareBodyPlugins(def.rules, callFrame, e),
          () => mapMaybe(
            walkBody(
              def.rules,
              bodyComposed,
              ancestor,
              callFrame,
              group,
              flush,
              partition,
              e,
              bodyImp,
              bodyForceLeading,
              propertyScope,
              applyExpansion,
              false,
              bodyTrivia
            ),
            () => {
              queueBodyTriviaTail(bodyTrivia, group, partition, e);
            }
          )
        );
        const emitted = withSourceOwner(e, callFrame.sourceOwner, executeBody);
        return mapMaybe(emitted, () => {
          /*
           * [scope-leak] after expansion the mixin's own `@x:` declarations unlock into
           * the caller scope (visible to later siblings), matching less@4.
           * Keep this continuation outside Context's source scope: only the shared
           * source body owns that scope; the lexical caller owns its published facts.
           */
          leakBodyVars(frame, def.rules, callFrame, e);

          /*
           * [ruleset-unlock] a ruleset (or nested mixin def) declared inside the called
           * body ALSO unlocks into the caller scope, so a later sibling can call it as a
           * mixin (less@4 splices the body's evaluated rules as siblings of the call, and
           * `Ruleset.find` then resolves against them). `.importRuleset()` defining
           * `.imported` makes `.imported()` callable afterward (`scope` fixture). Reuse
           * the callee frame's already-synthesized def+ruleMixin map (explicit MixinDefs
           * and paren-less rulesets, interleaved) rather than re-scanning the body.
           */
          publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
          if (def.ruleMixin !== true) {
            publishExplicitRulesets(frame, def.rules, callFrame);
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
    });
    return mapMaybe(queueComments, runDispatch);
  });
}

function queueCommentOnlyMixinBodies(
  candidates: readonly MixinDefinition[],
  call: MixinCall,
  frame: Frame,
  e: Emit,
  group: Leaf[]
): MaybePromise<void> {
  const resolveCaller = makeResolver(frame, e);
  const run = (index: number): MaybePromise<void> => {
    for (let i = index; i < candidates.length; i++) {
      const def = candidates[i]!;
      if (def.guard !== undefined || def.rules.length !== 0) {
        continue;
      }
      const comments = bodyBlockCommentTexts(def, e);
      if (comments.length === 0) {
        continue;
      }
      const bound = bindArgs(def, call, resolveCaller);
      if (isThenable(bound)) {
        return bound.then((bindings) => {
          if (bindings !== null) {
            queueLeafBlockComments(group, comments);
          }
          return run(i + 1);
        });
      }
      if (bound !== null) {
        queueLeafBlockComments(group, comments);
      }
    }
  };
  return run(0);
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
  flush: () => MaybePromise<void>,
  partition: Partition | null,
  e: Emit,
  imp = false,
  forceLeading = false,
  propertyScope: Frame = frame
): MaybePromise<void> {
  const selected: Array<{ rule: Ruleset; home: Frame }> = [];

  /*
   * [guards] Selecting which ruleset-mixin bodies apply may need an awaitable
   * guard value, so candidates are gathered first and their guards folded in
   * order — the fold stays fully synchronous until a guard actually awaits.
   */
  const candidates: Array<{ rule: Ruleset; home: Frame }> = [];
  for (const selector of node.selectors) {
    const key = selectorTermCanonical(selector);
    for (let scope: Frame | null = frame; scope; scope = scope.parent) {
      const matches = frameRulesets(scope)?.get(key);
      if (!matches) {
        continue;
      }
      for (const rule of matches) {
        if (!parentExcludes(frame, rule.rules)) {
          candidates.push({ rule, home: scope });
        }
      }
    }
  }
  const gather = serialForEach(candidates, ({ rule, home }) =>
    mapMaybe(ruleGuardPasses(rule, home, e), (passes) => {
      if (passes) {
        selected.push({ rule, home });
      }
    }));
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < selected.length; index++) {
      const { rule, home } = selected[index]!;
      const applyFrame: Frame = {
        parent: home,
        mixins: collectMixins(rule.rules),
        declIndex: collectDeclIndex(rule.rules), cells: null, reassign: null,
        statements: rule.rules,
        sourceOwner: sourceOwnerForBody(rule.rules, frame, e),
        ...(home === frame ? {} : { fallback: frame })
      };
      const emitted = withSourceOwner(e, applyFrame.sourceOwner, () => mapMaybe(
        prepareBodyPlugins(rule.rules, applyFrame, e),
        () => walkBody(
          rule.rules, composed, ancestor, applyFrame, group, flush, partition, e,
          imp, forceLeading, propertyScope, true
        )
      ));
      if (isThenable(emitted)) {
        return emitted.then(() => run(index + 1));
      }
    }
  };
  return mapMaybe(gather, () => run(0));
}

/** Candidate lookup in a probe position that cannot suspend (see {@link settledDispatch}). */
function settledCandidates(list: MaybePromise<MixinDefinition[]>, call: MixinCall, e: EvalCtx): MixinDefinition[] {
  if (isThenable(list)) {
    observeRejectedThenable(list);
    throw ERR.asyncInSyncPosition({
      node: call,
      ...callSiteLocation(call, e),
      meta: { where: 'mixin candidate lookup in a synchronous probe position' }
    });
  }
  return list;
}

/**
 * Dispatch in a position that cannot suspend. Namespace-path descent builds a
 * scope index, and a transparent-shell probe answers a structural question
 * before any emission — both are reached from callers that would have to be
 * restructured, so an awaitable dispatch is reported rather than guessed at.
 *
 * TODO(maybe-promise-sync-islands): fold these two onto the awaitable lane.
 */
function settledDispatch(selected: MaybePromise<Selection[]>, call: MixinCall, e: EvalCtx): Selection[] {
  if (isThenable(selected)) {
    observeRejectedThenable(selected);
    throw ERR.asyncInSyncPosition({
      node: call,
      ...callSiteLocation(call, e),
      meta: { where: 'mixin dispatch in a synchronous index/probe position' }
    });
  }
  return selected;
}

/**
 * Descend a namespace path (`#ns > .a`) to the scope frame in which the
 * final mixin dispatches. Each segment resolves a ruleset by own-local selector
 * and layers its body as a new scope. Returns `null` if any segment is unknown.
 */
function descendNamespacePath(path: MixinCall['path'], frame: Frame): Frame | null {
  let scope: Frame | null = frame;
  for (const seg of path) {
    let rules: Ruleset[] | undefined;
    let owner: Frame | null = null;
    for (let f: Frame | null = scope; f; f = f.parent) {
      const hit = f.rulesets !== undefined || f.statements ? frameRulesets(f)?.get(seg.selector) : undefined;
      if (hit?.length) {
        rules = hit;
        owner = f;
        break;
      }
    }
    if (!rules) {
      return null;
    }

    /*
     * Imported facts execute in a particular render placement. A Ruleset found by
     * namespace lookup contributes both that placement's already-published
     * import prefix and its authored body, matching lexical import splice order.
     */
    const bodies: Statement[] = rules.flatMap(r => [
      ...(owner?.rulePlacements?.get(r)?.importedRules ?? []),
      ...r.rules
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
    if (isValueBlock(v)) {
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
function leakBodyVars(callerFrame: Frame, rules: Statement[], callFrame: Frame, e: EvalCtx): void {
  for (const s of rules) {
    if (s.type !== 'VariableDeclaration') {
      continue;
    }
    const v = s.value;

    /*
     * A mixin-CALL-bound var (`@p: .m()`) is not byte-snapshottable; leave it to
     * resolve lazily at its call site rather than snapshotting a leaked copy.
     */
    if (isMixinCallValue(v)) {
      continue;
    }
    let snap: ValueNode;
    if (!isValueSlotArray(v) && (isValueBlock(v) || isTypedLiteral(v))) {
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
function publishMixins(frame: Frame, extra: Map<string, MixinDefinition[]> | null, home?: Frame): void {
  if (!extra) {
    return;
  }

  /*
   * [closure/publish] record each unlocked def's closure home so a later call
   * resolves its free vars/guard there (see `Frame.mixinHomes`). Only when a home
   * frame is supplied AND it differs from the destination (a def published into
   * its own frame keeps the ordinary lexical home).
   */
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
  const definitions = new Map<string, MixinDefinition[]>();
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
function publishExplicitRulesets(frame: Frame, rules: Statement[], callFrame: Frame): void {
  for (const statement of rules) {
    if (statement.type !== 'Ruleset') {
      continue;
    }

    /*
     * A following namespace call can run before this nested rule's deferred
     * render closure. Establish its call-specific lexical placement now, using
     * the existing source facts; `flatten` reuses this exact frame when it later
     * emits the rule. This is not a copied Ruleset or a second walk.
     */
    let placement = callFrame.rulePlacements?.get(statement);
    if (placement?.parent !== callFrame) {
      placement = {
        parent: callFrame,
        mixins: collectMixins(statement.rules),
        declIndex: collectDeclIndex(statement.rules), cells: null, reassign: null,
        statements: statement.rules
      };
      (callFrame.rulePlacements ??= new Map()).set(statement, placement);
    }
    (frame.publishedRules ??= []).push({ rule: statement, frame: placement });
  }
}

/** The taken arm of a value-position `$if`, resolved on the SYNCHRONOUS lane —
 *  `@x: $if (…) { {…} } $else { {…} }; @x();` splices the chosen arm's
 *  declarations. `undefined` when no arm matches. */
function pickIfBranch(node: IfValue, frame: Frame | null, e: EvalCtx): ValueSlot | undefined {
  return settledGuard(pickIfValue(node, frame, e), '$if value-arm block resolution', node, e);
}

/**
 * Resolve a binding node to the {@link ValueBlock} it names or produces:
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
    if (cur.type === 'Lookup' && cur.kind === 'var') {
      cur = lookupVar(frame, literalName(cur));
      continue;
    }
    return undefined;
  }
  return undefined;
}

function resolveValueBlock(node: Binding, frame: Frame | null, e: EvalCtx): ValueBlock | undefined {
  const seen = new Set<Binding>();
  let cur: Binding | undefined = node;

  /*
   * Each hop lands in the scope that OWNS the link — a lambda call yields its
   * `result:` in the activation frame holding the params. Re-resolving the next
   * link in the frame this walk STARTED from loses those bindings, so a
   * `result:` that calls on through (`$q: @($n) > { result: $d($n); }`) failed
   * to find `$n` while merely probing whether the value is a ruleset.
   */
  let cursor = frame;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (isValueSlotArray(cur)) {
      return undefined;
    }
    if (isValueBlock(cur)) {
      return cur;
    }
    if (cur.type === 'Lookup' && cur.kind === 'var') {
      const hit = lookupVarIn(cursor, literalName(cur));
      cur = hit?.value;
      cursor = hit?.frame ?? cursor;
      continue;
    }
    if (cur.type === 'Reference') {
      const resolved = resolveReferenceResult(cur, cursor, e);
      cur = resolved?.value;
      cursor = resolved?.frame ?? cursor;
      continue;
    }
    if (cur.type === 'IfValue') {
      cur = pickIfBranch(cur, cursor, e);
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** An anonymous mixin is callable, not a CSS declaration value. Jess collection
 * data is a real value and SCSS nested-property Collections are flattened
 * elsewhere, so only value-block resolution is rejected here. */
function assertDeclarationValueIsNotRuleset(node: Declaration, frame: Frame | null, e: EvalCtx): void {
  if (!isValueSlotArray(node.value) && node.value.type === 'Collection') {
    return;
  }
  if (!resolveValueBlock(node.value, frame, e)) {
    return;
  }
  throw ERR.rulesetOnProperty({
    node,
    ...callSiteLocation(node, e),
    meta: { what: declName(node, frame, e) }
  });
}

/** Build the overlay frame for a detached-ruleset call (definition scope has
 * priority; caller scope is the fallback). Publishes the ruleset's mixin defs
 * into the CALLER frame (Less scope unlocking). Returns null if the variable is
 * not bound to (or does not conditionally produce) a detached ruleset. */
function referenceCallFrame(
  dr: ValueBlock,
  frame: Frame,
  definitionFrame: Frame | null = frame,
  sourceOwner: object | null = null
): { dr: ValueBlock; callFrame: Frame } {
  /*
   * A value-block node is canonical and can be passed through several loop
   * activations. Its lexical home is therefore the FRAME that resolved THIS call,
   * never a mutable node-level first-use cache.
   */
  const def = definitionFrame ?? frame;
  const body = valueBlockBody(dr);
  const own = collectMixins(body);
  const callFrame: Frame = {
    parent: def, // definition scope has priority
    mixins: own,
    declIndex: collectDeclIndex(body), cells: null, reassign: null,
    fallback: frame, // caller scope is the fallback
    statements: body,
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
  flush: () => MaybePromise<void>,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  forceLeading = false, // [partition] inherited leading-hoist context
  propertyScope: Frame = frame,
  applyExpansion = false
): MaybePromise<void> {
  /*
   * `@alias: .something(foo); @alias();` — a variable bound to a MIXIN CALL is
   * dispatched as that call (Less: a mixin-call-valued var is callable), not spliced
   * as a detached ruleset. Also covers a mixin PARAMETER carrying a passed call value
   * (`.wrapper(@another-mixin) { @another-mixin(); }`).
   */
  const step = call.steps.at(-1);
  if (step?.type !== 'Call') {
    return;
  }
  const resolved = resolveReferenceResult(call, frame, e);
  if (!resolved) {
    if (call.base.type === 'Lookup' && call.base.kind === 'var') {
      unresolvedSymbol(call.base, `@${call.base.name}`, e);
    }
    return;
  }
  if (isMixinCallValue(resolved.value)) {
    const home = e.mixinCallHomes?.get(resolved.value) ?? resolved.frame ?? frame;
    return expandCall(resolved.value, composed, ancestor, home, group, flush, partition, e, false, forceLeading, undefined, propertyScope, applyExpansion);
  }
  if (step.args.length !== 0) {
    throw new Error('Reference call arguments require a callable mixin target.');
  }
  const dr = resolveValueBlock(resolved.value, resolved.frame, e);
  if (!dr) {
    return;
  }

  /*
   * A detached ruleset passed as a mixin argument closes over the caller frame
   * captured at argument binding time. `resolved.frame` owns the parameter cell,
   * not the detached body; using it here lets a same-named mixin local shadow the
   * argument's free variables. A direct declaration has the same lexical frame
   * either way, so consult the render-local closure fact when it exists.
   */
  const binding = detachedBinding(resolved.frame ?? frame, dr);
  const r = referenceCallFrame(
    dr,
    frame,
    binding?.lexicalFrame ?? resolved.frame,
    binding?.sourceOwner ?? resolved.sourceOwner
  );
  const drBody = valueBlockBody(r.dr);
  const executeBody = () => mapMaybe(
    prepareBodyPlugins(drBody, r.callFrame, e),
    () => walkBody(drBody, composed, ancestor, r.callFrame, group, flush, partition, e, false, forceLeading, propertyScope, applyExpansion)
  );
  return withSourceOwner(e, r.callFrame.sourceOwner, executeBody);
}

/* --------------------------------------------------------------- [each/For] */

/** One iterable item: its value node plus the map KEY (`null` for a plain list,
 *  where the key defaults to the 1-based index). */
interface ForItem {
  value: ValueSlot;
  key: ValueNode | null;
  valueFrame?: Frame;
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
 * If the iterable resolves to an executable detached ruleset, return its
 * statement body + lexical frame; else `null` (a list/collection iterable).
 * Collection iteration is handled before this helper because its entries are
 * data pairs, not declarations.
 */
function resolveForRuleset(
  node: ValueSlot,
  frame: Frame | null,
  e: EvalCtx
): { rules: Statement[]; frame: Frame | null; detached?: DetachedBinding } | null {
  if (isValueSlotArray(node)) {
    return null;
  }
  if (isValueBlock(node)) {
    const binding = detachedBinding(frame, node);
    return { rules: valueBlockBody(node), frame: binding?.lexicalFrame ?? frame, detached: binding };
  }
  if (node.type === 'Lookup' && node.kind === 'var') {
    const bound = lookupVar(frame, literalName(node));
    if (!bound) {
      return null;
    }
    if (isValueSlotArray(bound)) {
      return null;
    }
    if (isValueBlock(bound)) {
      const binding = detachedBinding(frame, bound);
      return { rules: valueBlockBody(bound), frame: binding?.lexicalFrame ?? frame, detached: binding };
    }

    /*
     * The binding is itself an indirection to a ruleset — a `@var` alias chain or
     * a `@map[k]` accessor (`@scheme: @color-schemes[@@name]; each(@scheme, …)` /
     * `@scheme[@color]`). Follow it through the same resolver.
     */
    if (bound.type === 'Lookup' && bound.kind === 'var' || bound.type === 'Reference' || bound.type === 'Block') {
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
      cur = cur.value;
      continue;
    }
    if (cur.type === 'Lookup' && cur.kind === 'var') {
      const hit = resolveVarRef(f, literalName(cur), cur.scope, e);

      /*
       * A mixin-CALL binding is not a plain list/scalar iterable node; stop at the
       * `VariableReference` (the list-fallback then treats it as a single item — the mixin-call
       * iterable proper is handled up front in `forItems`).
       */
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
function forItemsFromMixinCall(call: MixinCall, frame: Frame, e: Emit): MaybePromise<ForItem[]> {
  const collected: Leaf[] = [];
  const noop = (): void => {};

  /*
   * Collect EVERY declaration (`forceLeading` → all decls to `collected`), discard
   * nested rules (they defer to `trailing`, which is never drained here).
   */
  const discard: Partition = {
    encounteredContainer: false,
    trailing: [],
    pending: [],
    emitBlock: noop
  };
  return mapMaybe(expandCall(call, null, null, frame, collected, noop, discard, e, false, true), () => {
    const items: ForItem[] = [];
    for (const leaf of collected) {
      const n = leaf.node;
      if (n.type === 'Declaration') {
        const name = typeof n.name === 'string' ? n.name : evalBytesSync(n.name, leaf.frame, e);
        items.push({ value: n.value, key: any(name), valueFrame: leaf.frame });
      } else if (n.type === 'VariableDeclaration' && !isMixinCallValue(n.value)) {
        items.push({ value: n.value, key: any(n.name), valueFrame: leaf.frame });
      }
    }
    return items;
  });
}

function forItemsFromCollection(node: Collection, frame: Frame | null, e: Emit): ForItem[] {
  const collectionFrame: Frame = {
    parent: frame,
    mixins: null,
    declIndex: collectDeclIndex([]), cells: null, reassign: null,
    statements: [],
    sourceOwner: frame?.sourceOwner ?? null
  };
  recordCollectionPropertyTimeline(node.entries, collectionFrame, e);
  return node.entries.map(entry => ({
    value: entry.value,
    key: isValueSlotArray(entry.key) ? any(evalBytesSync(entry.key, collectionFrame, e)) : entry.key,
    valueFrame: collectionFrame
  }));
}

/** The ordered items an `each()` iterable expands to. */
function forItems(node: ValueSlot | MixinCall, frame: Frame | null, e: Emit): MaybePromise<ForItem[]> {
  // [each mixin-call iterable] `.mixin()` output → iterate its declarations.
  if (isMixinCallValue(node)) {
    return frame === null ? [] : forItemsFromMixinCall(node, frame, e);
  }
  if (!isValueSlotArray(node) && node.type === 'Range') {
    return forRangeItems(node, frame, e);
  }
  const resolvedIterable = resolveForNode(node, frame, e);
  if (!isValueSlotArray(resolvedIterable.node) && resolvedIterable.node.type === 'Collection') {
    return forItemsFromCollection(resolvedIterable.node, resolvedIterable.frame, e);
  }
  const map = resolveForRuleset(node, frame, e);
  if (map) {
    const mapFrame: Frame = {
      parent: map.frame,
      mixins: collectMixins(map.rules),
      declIndex: collectDeclIndex(map.rules), cells: null, reassign: null,
      statements: map.rules,
      sourceOwner: map.detached?.sourceOwner ?? map.frame?.sourceOwner ?? null
    };
    recordMapPropertyTimeline(map.rules, mapFrame);
    const items: ForItem[] = [];
    for (const s of map.rules) {
      if (s.type === 'Declaration') {
        const name = typeof s.name === 'string' ? s.name : evalBytesSync(s.name, mapFrame, e);
        items.push({
          value: s.value,
          key: any(name),
          valueFrame: mapFrame,
          ...(!isValueSlotArray(s.value) && isValueBlock(s.value) && map.detached
            ? { detached: map.detached }
            : {})
        });
      } else if (s.type === 'VariableDeclaration' && !isMixinCallValue(s.value)) {
        items.push({ value: s.value, key: any(s.name), valueFrame: mapFrame });
      }
    }
    return items;
  }

  /*
   * A list iterable. A LITERAL word — an authored list (`1 2 3`, `a, b`) or a var
   * bound to one — is byte-split into its top-level items (Less's Expression/Value
   * list model, which the flattened value domain does not preserve structurally). A
   * COMPUTED value evaluates: a genuine `List` (`range(…)`) iterates its typed
   * items; any other single value (an escaped `e("…")`, a scalar) is ONE item — it
   * is not a list, so it is never split.
   */
  const { node: base, frame: baseFrame } = resolvedIterable;
  if (isValueSlotArray(base)) {
    return base.map(value => ({ value, key: null }));
  }
  if (base.type === 'Range') {
    return forRangeItems(base, baseFrame, e);
  }
  if (base.type === 'List') {
    return base.value.map(value => ({ value, key: null }));
  }
  if (base.type === 'Sequence') {
    return base.parts.map(value => ({ value, key: null }));
  }
  if (base.type === 'Any' || base.type === 'Keyword') {
    return splitListBytes(base.src).map(b => ({ value: any(b), key: null }));
  }

  /*
   * [each] The iterable may name a value the engine can only produce by awaiting
   * (a `@plugin` result, a module-provided list). It resolves in place when it is
   * already settled, so the ordinary `each()` never becomes awaitable.
   */
  return mapMaybe(evalTyped(base, baseFrame, e), v =>
    groupItems(v).map(item => ({ value: any(emitValue(item)), key: null })));
}

function forRangeItems(node: Range, frame: Frame | null, e: Emit): ForItem[] {
  const start = evalTyped(node.start, frame, e);
  const end = evalTyped(node.end, frame, e);
  const step = node.step === null ? null : evalTyped(node.step, frame, e);
  if (isThenable(start) || isThenable(end) || isThenable(step)) {
    if (isThenable(start)) {
      observeRejectedThenable(start);
    }
    if (isThenable(end)) {
      observeRejectedThenable(end);
    }
    if (isThenable(step)) {
      observeRejectedThenable(step);
    }
    throw ERR.asyncInSyncPosition({
      node,
      ...callSiteLocation(node, e),
      meta: { where: '$for range bound' }
    });
  }
  if (isValueGroupArray(start) || isValueGroupArray(end) || (step !== null && isValueGroupArray(step))
    || start.type !== 'Dimension' || end.type !== 'Dimension' || (step !== null && step.type !== 'Dimension')) {
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
    const values = isValueSlotArray(value) ? value : value.type === 'Sequence' ? value.parts : value.type === 'List' ? value.value : [value];
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
    if (value === item.value && !isValueSlotArray(value) && isValueBlock(value)) {
      bindDetached(frame, value, item.detached.lexicalFrame, item.detached.sourceOwner);
    }
  }
}

function bindingValueFramesForItem(bindings: Map<string, ValueSlot>, item: ForItem): Map<Binding, Frame> | undefined {
  if (!item.valueFrame) {
    return undefined;
  }
  let frames: Map<Binding, Frame> | undefined;
  for (const value of bindings.values()) {
    if (value === item.value) {
      (frames ??= new Map()).set(value, item.valueFrame);
    }
  }
  return frames;
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
  flush: () => MaybePromise<void>,
  partition: Partition | null, // [partition] nested-ruleset sink (see walkBody)
  e: Emit,
  imp = false,
  forceLeading = false, // [partition] inherited leading-hoist context
  propertyScope: Frame = frame,
  applyExpansion = false
): MaybePromise<void> {
  return mapMaybe(forItems(node.iterable, frame, e), (items) => {
    const run = (start: number): MaybePromise<void> => {
      for (let i = start; i < items.length; i++) {
        const item = items[i]!;
        const { value, key } = item;
        const index = dimension(i + 1);
        const bindings = bindForEntry(node, value, key, index);
        const bindingValueFrames = bindingValueFramesForItem(bindings, item);
        const extendPlacement = e.plannedForExtendPlacements?.get(node)?.[i];
        const loopFrame: Frame = {
          parent: frame,
          mixins: collectMixins(node.rules),
          declIndex: collectDeclIndex(node.rules, bindings), cells: cellsForParams(bindings, bindingValueFrames), reassign: null,
          statements: node.rules,
          sourceOwner: frame.sourceOwner ?? null,
          ...(bindingValueFrames ? { bindingValueFrames } : {}),
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
  });
}

/**
 * [guards] Resolve the overloaded definitions that match a call. Args resolve to
 * BYTES in the caller frame (pattern-match); guard leaves compare TYPED values
 * in the callee frame through the injected `ValueEvaluator`.
 */
function dispatch(
  candidates: MixinDefinition[],
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
  homes?: Map<MixinDefinition, Frame>, // [closure] def → its DEFINITION frame (guard scope)
  errorOnNoViable = false
): MaybePromise<Selection[]> {
  const resolveCaller = makeResolver(frame, e);

  /*
   * [closure] a guard resolves free variables in the mixin's DEFINITION scope, with
   * the params overlaid and the call site as a fallback — the same frame layering
   * `expandCall` builds for the body. Absent a home (detached call)
   * it falls back to the caller frame (`parent: frame`).
   */
  const makeCalleeTyped = (
    def: MixinDefinition,
    bindings: Map<string, CallValue> | null,
    isDefault: () => boolean
  ): TypedResolver => {
    const home = homes?.get(def);

    /*
     * [default-fn] thread the dispatch decision into the operand-resolution ctx so a
     * `default()` inside a comparison (`when (@x = default())`) folds to it. Guard
     * operands resolve SYNC (`makeTypedResolver` throws on async), so the spread ctx
     * never drives the async Emit machinery.
     */
    return makeTypedResolver(
      home && home !== frame
        ? { parent: home, mixins: null, declIndex: collectDeclIndex([], bindings), cells: cellsForParams(bindings), reassign: null, fallback: frame }
        : { parent: frame, mixins: null, declIndex: collectDeclIndex([], bindings), cells: cellsForParams(bindings), reassign: null },
      { ...e, defaultFn: isDefault }
    );
  };

  /*
   * A DEFAULT param value resolves with the params bound so far in scope (Less:
   * `@hover-background: darken(@background, …)` reads the `@background` param)
   * overlaid on the mixin's DEFINITION scope, with the call site as a fallback —
   * the same frame layering `makeCalleeTyped` builds for guards. So a default like
   * `@parameter: @parameterDefault` reads the def-scope `@parameterDefault`, not a
   * same-name variable redeclared in the caller (`scope` fixture #allAreUsedHere).
   */
  const resolveDefault: DefaultResolver = (v, boundSoFar, def) => {
    const home = homes?.get(def);
    const overlay: Frame = home && home !== frame
      ? { parent: home, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null, fallback: frame }
      : { parent: frame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    return evalBytes(v, overlay, e);
  };

  /*
   * A default that NAMES a value block (`@breakpoints: @grid-breakpoints`) binds
   * the block by reference, matching what `substituteClosureVarArgs` already does
   * for a block passed explicitly. Anything else falls through to byte resolution.
   */
  const resolveDefaultBlock = (v: ValueSlot, boundSoFar: Map<string, CallValue>, def: MixinDefinition): ValueSlot | undefined => {
    if (isValueSlotArray(v) || v.type !== 'Lookup' || v.kind !== 'var') {
      return undefined;
    }
    const home = homes?.get(def);
    const overlay: Frame = home && home !== frame
      ? { parent: home, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null, fallback: frame }
      : { parent: frame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    const bound = lookupVar(overlay, literalName(v));
    return bound && !isValueSlotArray(bound) && isValueBlock(bound) ? bound : undefined;
  };

  /*
   * [spread] `.mixin(@args...)` splats a list variable into positional args at the
   * call site (Less variadic forwarding) BEFORE binding, so overloads select on the
   * splatted arity.
   */
  return mapMaybe(expandSpreadArgs(call, resolveCaller), (call1) => {
  /*
   * an arg that is a variable bound to a detached ruleset must bind BY
   * REFERENCE (its body/closure survives); substitute the resolved node so the
   * eager byte-resolver never tries to serialize a ruleset as a value.
   */
    const call2 = substituteClosureVarArgs(call1, frame);
    const ambiguity = (error: unknown): never => {
      if (error instanceof DefaultGuardAmbiguityError) {
        throw ERR.ambiguousDefault({
          node: call,
          ...callSiteLocation(call, e),
          meta: { callee: `${call.name}()` }
        });
      }

      /*
       * §9 — `mixin-dispatch.ts` runs `evalGuard` for overload selection with no
       * `withUnitErrors` around it, so a MIXIN guard's unit clash or
       * no-common-ground comparison escaped as the bare value-domain class and
       * surfaced from the public API as `internal/unknown` with no location,
       * while the very same guard evaluated by any other lane produced a
       * structured diagnostic. Dispatch cannot wrap it itself (it holds no
       * `EvalCtx` and must not import this module), so the mapping is attached
       * where the call site is known — here, on BOTH lanes, exactly as the
       * `default()` ambiguity mapping already is.
       */
      throwUnitArithmetic(error, call, e);
    };
    try {
      const selected = selectDefinitions(
        candidates,
        call2,
        resolveCaller,
        makeCalleeTyped,
        e.ev,
        e.modes,
        resolveDefault,
        resolveDefaultBlock,
        errorOnNoViable ? () => unresolvedMixinCall(call2, e) : undefined
      );

      /*
       * `default()` ambiguity can now surface on either lane, so the mapping to a
       * positioned diagnostic is attached to both.
       */
      return isThenable(selected) ? selected.catch(ambiguity) : selected;
    } catch (error) {
      return ambiguity(error);
    }
  });
}

/** [spread] Replace each `@args...` spread arg with the POSITIONAL args it splats
 * to: resolve the list variable's bytes in the caller frame and split it on the
 * top-level list separator (comma, else whitespace). A spread of an empty/missing
 * value contributes no args. Non-spread args pass through unchanged. */
function expandSpreadArgs(call: MixinCall, resolveCaller: ValueResolver): MaybePromise<MixinCall> {
  // The overwhelmingly common call has no spread at all and leaves here untouched.
  if (!call.args.some(a => a.spread)) {
    return call;
  }
  const args: CallArg[] = [];
  const step = (index: number): MaybePromise<MixinCall> => {
    for (; index < call.args.length; index++) {
      const a = call.args[index]!;
      if (!a.spread) {
        args.push(a);
        continue;
      }
      if (isMixinCallValue(a.value)) {
        throw new Error('A deferred mixin call cannot be used as a spread argument.');
      }
      const resolved = resolveCaller(a.value);
      if (isThenable(resolved)) {
        const at = index;
        return resolved.then((bytes) => {
          pushSpread(args, bytes);
          return step(at + 1);
        });
      }
      pushSpread(args, resolved);
    }
    return { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important, content: call.content, _s: call._s, _e: call._e };
  };
  return step(0);
}

/** Split one resolved spread argument into the positional args it splats to. */
function pushSpread(args: CallArg[], rawBytes: string): void {
  const bytes = rawBytes.trim();
  if (bytes === '') {
    return;
  }
  for (const piece of splitListBytes(bytes)) {
    args.push(callArg(any(piece)));
  }
}

/** Replace `@rs` args (a VariableReference bound to a detached ruleset) with the
 * resolved value-block node so it binds by reference. */
/**
 * Recognize a mixin-call-shaped VALUE — a `Sequence` of a `.`/`#` selector head
 * (`Any`) glued to a `Block` arg group (`.something(foo)`, `#library.core.colors()`)
 * — and build the `MixinCall` it denotes, so a mixin call passed as an arg value
 * (`.wrapper(.something(foo))`) binds as a callable. Returns `undefined` for any
 * other value shape. Mirrors {@link tryMixinCallIterable}, on the serializer's value
 * model rather than raw parser children.
 */
function substituteClosureVarArgs(call: MixinCall, frame: Frame): MixinCall {
  let changed = false;
  const args = call.args.map((a) => {
    /*
     * A mixin call passed directly as an arg value (`.wrapper(.something(foo))`):
     * wrap it as a detached ruleset whose body is that call, so `@another-mixin()`
     * dispatches it (its args resolve in the caller frame's runtime binding).
     */
    if ('type' in a.value && a.value.type === 'Lookup' && a.value.kind === 'var') {
      const bound = lookupVar(frame, literalName(a.value));
      if (bound && !isValueSlotArray(bound) && isValueBlock(bound)) {
        changed = true;
        return { ...a, value: bound };
      }

      /*
       * `@alias: .something(foo); .wrapper(@alias);` — a mixin-call-valued var passed
       * as an arg binds BY REFERENCE, wrapped as a detached ruleset whose body is that
       * call (so `@another-mixin()` in the callee dispatches it). The wrapper's home is
       * the caller frame, where the call's own selector/args resolve.
       */
      if (bound && isMixinCallValue(bound)) {
        changed = true;
        return { ...a, value: bound };
      }
    }
    return a;
  });
  return changed
    ? { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important, content: call.content, _s: call._s, _e: call._e }
    : call;
}

function flushBlock(selector: string[], group: Leaf[], e: Emit, selNode?: SelectorList, parentKey?: object | null, owner?: object): MaybePromise<void> {
  /*
   * A root-level mixin/detached-ruleset call has no selector header. Its ordinary
   * declarations are invalid Less output; custom properties remain legal at root.
   */
  if (selector.length === 0) {
    for (const leaf of group) {
      if (leaf.node.type !== 'Declaration') {
        continue;
      }
      const name = declName(leaf.node, leaf.frame, e);
      if (!name.startsWith('--')) {
        throw ERR.propertyInRoot({
          node: leaf.node,
          ...callSiteLocation(leaf.node, e),
          meta: { what: name }
        });
      }
    }
  }
  const emit = (kept: Leaf[], merged = false): void => {
    const trailingBlockComments = takePendingLeafBlockComments(group);

    // [atrule] indent by the current block depth (0 at top level == prior behavior).
    const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
    const authoredHeader = parentKey === null && selector.length === selNode?.selectors.length
      ? authoredSelectorHeaderWithTrivia(selNode, selector, e)
      : null;
    const header = authoredHeader ?? (idt ? selector.join(',\n' + idt) : selector.join(',\n'));

    /*
     * [adjacent-merge] v5 merges consecutive same-selector SIBLING rulesets nested
     * under a common parent (see `Emit.lastBlock`): a non-null parent-expansion key
     * matching the prior block's, same header+depth, and strict adjacency (nothing
     * emitted since it closed) reopen the prior block rather than starting a new one.
     */
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
    if (owner !== undefined && kept.length === 0 && trailingBlockComments.length === 0) {
      emitBodyBlockCommentTrivia(owner, e, e.depth > 0 ? INDENT.repeat(e.depth + 1) : INDENT);
    }
    if (merged) {
      mergeFold(kept, e, INDENT.repeat(e.depth + 1));
    } else {
      const bodyOwner = owner;
      const bodyStart = bodyOwner === undefined ? NO_SPAN : bodyStartOf(bodyOwner);
      const hasBody = bodyStart !== NO_SPAN;
      let bodyTriviaCursor = hasBody ? bodyStart : 0;
      for (const leaf of kept) {
        if (hasBody) {
          emitBlockCommentTriviaBetween(e, bodyTriviaCursor, statementStartOf(leaf.node), INDENT.repeat(e.depth + 1));
          bodyTriviaCursor = statementEndOf(leaf.node) ?? bodyTriviaCursor;
        }
        for (const comment of leaf.leadingBlockComments ?? []) {
          put(e, INDENT.repeat(e.depth + 1));
          put(e, comment);
          put(e, '\n');
        }
        emitLeaf(leaf, e);
      }
      if (hasBody) {
        emitBlockCommentTriviaBetween(e, bodyTriviaCursor, bodyOwner === undefined ? bodyTriviaCursor : bodyEndOf(bodyOwner), INDENT.repeat(e.depth + 1));
      }
    }
    for (const comment of trailingBlockComments) {
      put(e, INDENT.repeat(e.depth + 1));
      put(e, comment);
      put(e, '\n');
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
  };
  if (groupHasMerge(group)) {
    return emit(group, true);
  }
  return mapMaybe(dedupGroup(group, e), emit);
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
function dedupGroup(group: Leaf[], e: Emit): MaybePromise<Leaf[]> {
  if (group.length < 2) {
    return group;
  }

  /*
   * Gate: resolve each declaration NAME (cheap for string names); dedup only runs
   * if some property name occurs more than once in the block.
   */
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

  /*
   * Reverse keep-last: a key already recorded from a LATER position collapses this
   * (earlier) occurrence.
   */
  const seen = new Set<string>();
  let suppressed: Set<number> | null = null;
  const finish = (): Leaf[] => {
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
  };
  const inspect = (index: number): MaybePromise<Leaf[]> => {
    for (let i = index; i >= 0; i--) {
      const leaf = group[i]!;
      const n = leaf.node;
      if (n.type !== 'Declaration') {
        continue;
      }
      const nm = names[i]!;
      if ((nameCounts.get(nm) ?? 0) < 2) {
        continue;
      } // unique name → nothing to collapse
      const record = (val: string): void => {
        const important = n.important || leaf.important === true;
        const key = `${nm}\x00${val}\x00${important ? '!' : ''}`;
        if (seen.has(key) && leaf.fromApply !== true) {
          (suppressed ??= new Set<number>()).add(i);
        } else {
          seen.add(key);
        }
      };
      const val = evalBytes(n.value, leaf.frame, e);
      if (isThenable(val)) {
        return val.then((value) => {
          record(value);
          return inspect(i - 1);
        });
      }
      record(val);
    }
    return finish();
  };
  return inspect(group.length - 1);
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
    l.node.type === 'Declaration' ? declName(l.node, l.frame, e) : null);

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

        /*
         * Match ordinary declaration emission: an Important wrapper may sit
         * behind a variable reference, and promotes this whole merged line.
         * Keep that one-bit signal on the existing emit context: merged output
         * already takes this path only after `groupHasMerge` admitted the group.
         */
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
  return !isValueSlotArray(value) && value.type === 'Collection';
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

/**
 * A custom property name (`--foo`, or an interpolation whose literal head is `--`).
 * A custom property's value is an arbitrary token stream, so `--foo: { … }` is
 * already valid CSS; a superset may not reassign its meaning.
 */
function isCustomPropertyName(name: string | Interpolation): boolean {
  if (typeof name === 'string') {
    return name.startsWith('--');
  }
  const head = name.parts[0];
  return head !== undefined && 'lit' in head && head.lit.startsWith('--');
}

function collectionEntryPropertyName(entry: AstCollectionEntry, frame: Frame | null, e: EvalCtx): string | Interpolation | null {
  if (isValueSlotArray(entry.key)) {
    return null;
  }
  switch (entry.key.type) {
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Any':
      return entry.key.src;
    case 'Quoted':
      return entry.key.value;
    case 'Interpolation':
      return entry.key;
    default:
      return evalBytesSync(entry.key, frame, e);
  }
}

/** [nested-property] Append one carrier level's declarations to `out`, recursing
 * through an entry that is itself a `{ … }` block (`font: { family: { weight: bold } }`). */
function collectNestedProperty(
  name: string | Interpolation,
  block: Collection,
  merge: Declaration['merge'],
  important: boolean,
  out: Declaration[],
  frame: Frame | null,
  e: EvalCtx
): void {
  if (block.base !== undefined) {
    out.push(decl(name, block.base, merge, important));
  }
  for (const entry of block.entries) {
    const leaf = collectionEntryPropertyName(entry, frame, e);
    if (leaf === null) {
      continue;
    }
    const joined = joinNestedPropertyName(name, leaf);
    if (isCollectionValue(entry.value)) {
      collectNestedProperty(joined, entry.value, entry.merge, entry.important, out, frame, e);
    } else {
      out.push(decl(joined, entry.value, entry.merge, entry.important));
    }
  }
}

/**
 * [nested-property] A `Collection` has two roles selected by POSITION: in
 * value/argument position it is DATA (serialized as `{ a: 1; b: 2 }`); at a
 * PROPERTY ROOT it is STRUCTURE and expands to hyphenated declarations — the
 * carrier's own `base` value first, then each entry with its outer name joined
 * by `-`, in source order.
 *
 * The trigger is the literal block SYNTAX in property position (`node.value` is
 * an unevaluated `Collection` node), not a value that merely evaluates to a
 * Collection.
 *
 * Carve-out: a custom property takes the DATA role. `--foo: { a: 1 }` is already
 * valid CSS, and `--foo-a` bears no CSS-defined relationship to `--foo`, so
 * flattening would mint names into an open namespace we do not control.
 *
 * Returns `null` when `node` is not a nested-property carrier. BOTH emitters
 * (flattened `walkBody` and nested `emitNestedBody`) route through this one
 * function: a second implementation would drift, and an emitter divergence is
 * exactly the defect this guards.
 */
function nestedPropertyDeclarations(node: Declaration, frame: Frame | null, e: EvalCtx): Declaration[] | null {
  if (!isCollectionValue(node.value) || isCustomPropertyName(node.name)) {
    return null;
  }
  const out: Declaration[] = [];
  collectNestedProperty(node.name, node.value, node.merge, node.important, out, frame, e);
  return out;
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

/**
 * [null] The emit cursor as it stood before a declaration's first byte, so a
 * declaration that turns out to elide can be rolled back out of the output.
 */
interface DropMark {
  readonly chunks: number;
  readonly off: number;
  readonly positions: number;
  readonly sink: { elided: boolean };
}

const dropMark = (e: Emit): DropMark => ({
  chunks: e.chunks.length,
  off: e.off,
  positions: e.positions === null ? 0 : e.positions.length,
  sink: { elided: false }
});

/**
 * [null] Drop a fully-elided declaration (§4.3): `$x: null; a { b: $x; c: red }`
 * emits `a { c: red }`, never `b: ;`.
 *
 * A SYNC elision truncates back to the mark. A value that deferred to an async
 * slot cannot — its chunk range is already fixed and later statements have been
 * appended past it — so the range is recorded and blanked once every pending slot
 * has settled. Blanking, not splicing: a pending slot addresses `chunks` BY INDEX.
 */
function finishDrop(e: Emit, mark: DropMark, deferred: boolean): void {
  if (deferred) {
    e.drops.push({ from: mark.chunks, to: e.chunks.length, sink: mark.sink });
    return;
  }
  if (!mark.sink.elided) {
    return;
  }
  e.chunks.length = mark.chunks;
  e.off = mark.off;
  if (e.positions !== null) {
    e.positions.length = mark.positions;
  }
}

function emitLeaf(leaf: Leaf, e: Emit, atRoot = false): void {
  const { node, frame } = leaf;
  const start = e.off;

  /*
   * [atrule] a declaration/comment sits one level in from its container's depth.
   * A leaf emitted directly at the document root (not inside any block) sits flush
   * left at depth 0 rather than one level in.
   */
  const idt = atRoot ? INDENT.repeat(e.depth) : e.depth > 0 ? INDENT.repeat(e.depth + 1) : INDENT;
  if (node.type === 'Declaration') {
    assertDeclarationValueIsNotRuleset(node, frame, e);
    const name = declName(node, frame, e);
    if (atRoot && !name.startsWith('--')) {
      throw ERR.propertyInRoot({
        node,
        ...callSiteLocation(node, e),
        meta: { what: name }
      });
    }
    const mark = dropMark(e);
    let deferred = false;
    put(e, idt);
    put(e, name); // resolve interpolated property name
    put(e, declarationHeadTriviaText(node, e));
    const onNewLine = node.valueOnNewLine === true;
    put(e, onNewLine ? ':' : ': ');
    const important = node.important === true || leaf.important === true;
    const customValue = name.startsWith('--')
      ? customPropertyValueWithTrivia(node.value, frame, e)
      : null;
    if (customValue === null) {
      const prevElide = e.elideSink;
      e.elideSink = mark.sink; // [null] this declaration's elision, not an enclosing one
      deferred = putValue(e, node.value, frame, isValueSlotArray(node.value) ? undefined : node.value, idt + INDENT, important, onNewLine) === null; // [whitespace] continuation indent
      e.elideSink = prevElide;
    } else if (isThenable(customValue)) {
      const i = e.chunks.length;
      e.chunks.push('');
      e.pending.push({
        i,
        p: Promise.resolve(mapMaybe(customValue, value => important ? normalizeImportant(value) : value))
      });
    } else {
      const valStart = e.off;
      put(e, important ? normalizeImportant(customValue) : customValue);
      if (e.positions && !isValueSlotArray(node.value)) {
        e.positions.push({ node: node.value, type: node.value.type, start: valStart, end: e.off });
      }
    }
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
    emitInlineBlockCommentTriviaAfter(node, e);
    put(e, ';\n');
    finishDrop(e, mark, deferred);
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
    /*
     * [atrule-nested] a stay-nested at-rule buffered into a decl group: emit one
     * block level deeper than the containing declarations.
     */
    e.depth++;
    settledEmission(emitAtRuleBlock(node, frame, e), node, e);
    e.depth--;
  } else if (node.type === 'AtRuleStatement') {
    e.depth++;
    emitAtRuleStatement(node, frame, e);
    e.depth--;
  } else if (node.type === 'StyleImport') {
    e.depth++;
    settledEmission(emitStyleImport(node, frame, e, e.importDocument), node, e);
    e.depth--;
  } else if (node.type === 'OpaqueAtRuleBlock') {
    e.depth++;
    emitOpaqueAtRuleBlock(node, e);
    e.depth--;
  }
}

/**
 * A leaf emission that CANNOT suspend. `emitLeaf` writes straight into the
 * render buffer from a synchronous group flush; if the child suspends, the
 * closing bytes are written before the child's, producing unbalanced output with
 * declarations silently missing. Reported instead — the same loud failure this
 * position had before mixin dispatch reached the awaitable lane.
 *
 * TODO(maybe-promise-leaf-flush): put the group-flush path (`flushBlock` /
 * `mergeFold` / `emitLeaf`) on the awaitable lane so a stay-nested at-rule whose
 * body awaits can be buffered correctly.
 */
function settledEmission(result: MaybePromise<void>, node: Statement, e: EvalCtx): void {
  if (isThenable(result)) {
    observeRejectedThenable(result);
    throw ERR.asyncInSyncPosition({
      node,
      ...callSiteLocation(node, e),
      meta: { where: 'nested at-rule buffered into a synchronous declaration group' }
    });
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
function emitHoistedCharset(rules: Statement[], frame: Frame, e: Emit): void {
  for (const c of rules) {
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
function rootCssImportKey(node: AtRuleStatement): string | null {
  if (node.name.toLowerCase() !== '@import' || node.prelude === null) {
    return null;
  }

  /*
   * Only a dialect that TYPES its CSS-terminal import prelude participates. A
   * grammar that flattens the whole prelude to opaque bytes (plain CSS, jess)
   * keeps its authored statement order, and nothing here re-derives a target
   * from those bytes.
   */
  const prelude = node.prelude;
  const target = prelude.type === 'Sequence' ? prelude.parts[0] : prelude;
  if (target === undefined || (target.type !== 'Quoted' && target.type !== 'Url')) {
    return null;
  }
  const tail = prelude.type === 'Sequence' ? prelude.parts.slice(1) : [];
  if (tail.some(part => part.type !== 'Any')) {
    return null;
  }
  const specifier = target.type === 'Quoted'
    ? target.value
    : target.value.type === 'Quoted'
      ? target.value.value
      : target.value.type === 'Any'
        ? target.value.src
        : null;
  if (specifier === null) {
    return null;
  }

  /*
   * A media/layer tail is NOT what makes an import CSS terminal — only the
   * target is. `@import "a.less" screen` loads `a.less` and wraps its rules in
   * `@media screen`, which `emitStyleImport` does from the typed tail; that form
   * never reaches this statement node at all.
   */
  if (!/\.css(?:[?#].*)?$/iu.test(specifier) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(specifier)) {
    return null;
  }

  /* Every shape reaching here carries an authored `src`; read it structurally
   * rather than asserting a narrower node type. */
  const srcOf = (v: { readonly type: string } & Partial<Record<'src', string>>): string => v.src ?? '';
  const emittedTarget = target.type === 'Quoted'
    ? target.src
    : `url(${target.value.type === 'Quoted' ? target.value.src : srcOf(target.value)})`;
  return `${node.name}\u0000${emittedTarget}\u0000${tail.map(srcOf).join(' ')}`;
}

function emitHoistedCssImports(rules: Statement[], frame: Frame, e: Emit): void {
  if (e.context?.options.processImports === false) {
    return;
  }
  const seen = new Set<string>();
  let hoisted: Set<AtRuleStatement> | null = null;
  for (const child of rules) {
    if (child.type !== 'AtRuleStatement') {
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
    emitAtRuleStatementRaw(child, frame, e);
  }
  e.hoistedCssImports = hoisted;
}

function emitAtRuleStatement(node: AtRuleStatement, frame: Frame, e: Emit): void {
  /*
   * [charset] Inline `@charset` occurrences are dropped; `serialize` hoists the
   * first to the document top (dedupe).
   */
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
  const authored = authoredStatementWithTrivia(node, e);
  if (authored !== null) {
    put(e, authored);
    put(e, '\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
    return;
  }
  put(e, node.name);
  if (node.prelude !== null) {
    /*
     * A statement prelude resolves only `@{…}` interpolation (`@charset
     * "UTF-@{Eight}"`); a bare-`@var` / static prelude is a verbatim `Any`.
     *
     * Rendered through the query-prelude writer, not the plain value writer: a
     * CSS-terminal `@import` keeps its target and media/layer tail TYPED, and a
     * media feature `(min-width: @w)` is a `Block` around an `Operation` whose
     * delimiters and `: ` are structure rather than bytes.
     */
    const p = evalQueryPreludeSync(node.prelude, frame, e).replace(/^\s+/u, '');
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
function emitStyleImport(
  node: StyleImport,
  frame: Frame,
  e: Emit,
  importDocument?: SerializeOptions['importDocument'],
  emitLoaded?: (document: Stylesheet, frame: Frame) => MaybePromise<void>
): MaybePromise<void> {
  if (e.context?.options.processImports === false) {
    return;
  }
  if (importDocument) {
    const planned = e.plannedImportDocuments;
    const plannedImport = planned?.has(node)
      ? (() => {
          const loaded = planned.get(node)!;
          if (!e.preparedImportsOwnedByCaller) {
            planned.delete(node);
          }
          return loaded;
        })()
      : null;
    const request = plannedImport?.request ?? {
      node,
      specifier: importSpecifier(node, frame, e),
      options: importRequestOptions(node.options)
    };
    const loadedRequest = plannedImport ? plannedImport.loaded : importDocument(request);
    return mapMaybe(loadedRequest, (loaded) => {
      if (loaded !== undefined) {
        if ('inline' in loaded) {
          emitRawInline(loaded.inline, e);
          return;
        }
        if (request.options === null && e.multipleImportDepth === 0 && loaded.key !== undefined) {
          const seen = e.loadedImports ??= new Set();
          if (seen.has(loaded.key)) {
            return;
          }
          seen.add(loaded.key);
        }

        /*
         * Imported facts publish IN SOURCE ORDER, interleaved exactly as authored:
         * a `MixinDefinition` and a rule-mixin both land in the same per-name list, so
         * batching the rule-mixins to the end would silently sort every imported
         * `MixinDefinition` ahead of them. An interpolated rule key can only be built by
         * awaiting, so the walk suspends there rather than deferring the publish.
         */
        const children = loaded.document?.rules ?? [];
        const publishChildren = (from: number): MaybePromise<void> => {
          for (let index = from; index < children.length; index++) {
            const child = children[index]!;
            if (child.type === 'MixinDefinition') {
              publishImportedMixinDefinition(frame, child);
            }
            if (child.type === 'VariableDeclaration') {
              publishImportedVariableDeclaration(frame, child);
            }
            if (child.type === 'Ruleset') {
              publishImportedRuleset(frame, child);

              /*
               * Keep bare ruleset-mixin lookup aligned with namespace lookup for
               * an executed lexical import. This is a render-frame callable fact,
               * not an AST copy or an alternate import path.
               */
              const built = orderedMixinsForStatements([child], frame, e);
              if (isThenable(built)) {
                const at = index;
                return built.then((idx) => {
                  publishOrderedMixins(frame, idx, frame);
                  return publishChildren(at + 1);
                });
              }
              publishOrderedMixins(frame, built, frame);
            }
          }
          return undefined;
        };

        /*
         * Published UNCONDITIONALLY here, before the document is remembered and
         * outside `withinDocument` — the position the synchronous engine used.
         * The driver's `withinDocument` callback is not a place to put facts the
         * import must publish exactly once.
         */
        return mapMaybe(publishChildren(0), () => {
          if (loaded.document === null) {
            return;
          }
          rememberImportedCallableBodies(loaded.document, loaded.document.rules, e.context);
          const emitDocument = () => emitLoaded
            ? emitLoaded(loaded.document!, frame)
            : emitDocumentStatements(loaded.document!.rules, frame, e, importDocument, true);

          /*
           * A compile-time import has NO postlude to honour: the grammar rejects
           * one outright, so the loaded document simply executes at this lexical
           * position. Less 4.x instead wraps it in `@media <tail>`; that wrap is
           * deliberately gone along with the syntax that reached it.
           */
          const emit = (): MaybePromise<void> => emitDocument();

          /*
           * An imported document executes IN the importing frame, so a `@plugin`
           * it declares registers its functions THERE — exactly like Less, where a
           * plugin loaded from an imported file is visible to the importer. Without
           * this, every `@plugin` behind an `@import` silently registers nothing.
           * It must run inside the loaded document's own context so a relative
           * plugin specifier resolves against the file that wrote it.
           */
          const emitWithPlugins = (): MaybePromise<void> =>
            withDocumentTrivia(e, loaded.document!, () =>
              mapMaybe(prepareBodyPlugins(loaded.document!.rules, frame, e), () => {
                if (e.referenceImportDepth === 0 && e.depth > 0) {
                  emitLeadingDocumentBlockComments(e, INDENT.repeat(e.depth));
                }
                return emit();
              }));
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
              result = loaded.withinDocument ? loaded.withinDocument(emitWithPlugins) : emitWithPlugins();
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
          return loaded.withinDocument ? loaded.withinDocument(emitWithPlugins) : emitWithPlugins();
        });
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
function importSpecifier(node: StyleImport, frame: Frame, e: Emit): string {
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

/**
 * Write the preserved import syntax when no canonical document is loaded.
 *
 * The option clause is import machinery, not syntax: `(reference)`, `(optional)`
 * and friends select load behavior and have no CSS meaning, so no browser
 * understands `@import (reference) "a";`. `importThroughContext` is the only
 * reader of `node.options`; it never reaches output, matching Less 4.x.
 */
function emitCssImportAtRule(node: StyleImport, frame: Frame, e: Emit): void {
  const start = e.off;
  if (e.depth > 0) {
    put(e, INDENT.repeat(e.depth));
  }
  put(e, node.name);
  put(e, ' ');
  put(e, evalBytesSync(node.target, frame, e));
  if (node.alias !== null) {
    put(e, ' as ');
    put(e, evalBytesSync(node.alias, frame, e));
  } else if (node.namespace !== null) {
    put(e, ' as ');
    put(e, node.namespace);
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
 * from the next statement (mirrors Less's inline splice — an `Any` value
 * printed as-is with a trailing rule separator).
 *
 * There is no media-wrapped variant. `(inline)` makes an import compile-time, and
 * a postlude on a compile-time import is a parse error, so the bytes always
 * splice bare.
 */
function emitRawInline(text: string, e: Emit): void {
  put(e, text);
  put(e, '\n');
}

function canEmitRootCallValue(value: EvalValue): boolean {
  return isLiteral(value) || (!isValueGroupArray(value) && value.type === 'Any');
}

/**
 * A bare value-position call in statement position (e.g. `e('…');`): Less
 * evaluates it and prints the result bytes as a standalone line (an `Any`
 * at document scope — no trailing `;`), so an `e(...)` escape emits its inner
 * text. Emitted at the current indent; an empty result contributes nothing.
 */
function emitCallStatement(node: FunctionCall, frame: Frame, e: Emit, precomputed?: string): MaybePromise<void> {
  const start = e.off;
  const emitBytes = (bytes: string): void => {
    const isRoot = e.depth === 0;
    const isAllowedVoid = node.name.toLowerCase() === 'if';
    if (isRoot && bytes.length === 0 && !isAllowedVoid) {
      throw ERR.rootCallWithoutRoot({
        node,
        ...callSiteLocation(node, e),
        meta: { name: node.name }
      });
    }
    if (isRoot && node.args.length === 0 && bytes.trim() === `${node.name}()`) {
      throw ERR.rootCallWithoutRoot({
        node,
        ...callSiteLocation(node, e),
        meta: { name: node.name }
      });
    }
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
  };
  const emitValueResult = (value: EvalValue): void => {
    if (e.depth === 0 && !canEmitRootCallValue(value)) {
      throw ERR.rootCallWithoutRoot({
        node,
        ...callSiteLocation(node, e),
        meta: { name: node.name }
      });
    }
    if (!isLiteral(value)) {
      validateValueGroupUnits(value, e.modes, node, e, false);
    }
    emitBytes(emitValue(value));
  };
  const evalAndEmit = (): MaybePromise<void> =>
    precomputed === undefined
      ? e.depth === 0
        ? mapMaybe(evalValue(node, frame, e), emitValueResult)
        : mapMaybe(evalBytes(node, frame, e), emitBytes)
      : emitBytes(precomputed);

  /*
   * A typed color is a value, not a statement surface.  Keep the normal
   * byte-only fast path for ordinary/unknown calls, but retain this one fact
   * while evaluating a known call so `rgba(0,0,0,0);` fails like Less instead
   * of leaking a color token into the root output.
   */
  if (precomputed === undefined && e.ev && DEFERRED_COLOR_CALLS.has(node.name) && hasCssColorCallShape(node)) {
    const value = evalTyped(node, frame, e);
    return mapMaybe(value, (resolved) => {
      if (!isValueGroupArray(resolved) && resolved.type === 'Color') {
        throw ERR.invalidStatement({
          node,
          ...callSiteLocation(node, e),
          meta: { what: 'Color' }
        });
      }
      return evalAndEmit();
    });
  }
  return evalAndEmit();
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

/**
 * The grammar-owned template of a general-enclosed function form, or `null` when
 * the call is an ordinary one. A single `Interpolation` argument is the shape no
 * structured call can have: every structured argument path yields a typed value
 * node, so the template is the discriminator, not a flag.
 */
function generalEnclosedPayload(args: readonly CallArg<ValueSlot>[]): Interpolation | null {
  if (args.length !== 1) {
    return null;
  }
  const only = args[0]!.value;
  return !isValueSlotArray(only) && only.type === 'Interpolation' ? only : null;
}

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
function evalSupportsPrelude(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<SupportsPreludePart[]> {
  const plain = (bytes: string): SupportsPreludePart[] => [{ bytes, protected: false }];
  if (isValueSlotArray(node)) {
    const authored = valueLayoutOf(node);
    const parts: Array<MaybePromise<SupportsPreludePart[]>> = [];
    for (let index = 0; index < node.length; index += 1) {
      if (index > 0) {
        parts.push(plain(authored?.[index - 1] ?? ' '));
      }
      parts.push(evalSupportsPrelude(node[index]!, frame, e));
    }
    return concatPreludeParts(parts);
  }
  switch (node.type) {
    /*
     * [general-enclosed] The two general-enclosed spellings — `selector(…)` and a
     * bare `(…)` the condition grammar could not structure — are an ordinary
     * `FunctionCall` / `Block` whose sole payload is the grammar-owned
     * `Interpolation` template. Their bytes are the author's, not a value's, so
     * they are emitted whole and marked protected: normalization must not touch
     * the payload's spacing, comments, or quoting.
     */
    case 'FunctionCall': {
      const payload = generalEnclosedPayload(node.args);
      if (payload === null) {
        return mapMaybe(evalBytes(node, frame, e), plain);
      }
      return mapMaybe(evalBytes(payload, frame, e), content =>
        [{ bytes: `${node.name}(${content})`, protected: true }]);
    }
    case 'Block': {
      const open = node.delimiter === 'square' ? '[' : '(';
      const close = node.delimiter === 'square' ? ']' : ')';
      if (!isValueSlotArray(node.value) && node.value.type === 'Interpolation') {
        return mapMaybe(evalBytes(node.value, frame, e), content =>
          [{ bytes: `${open}${content}${close}`, protected: true }]);
      }
      return concatPreludeParts([plain(open), evalSupportsPrelude(node.value, frame, e), plain(close)]);
    }
    case 'Operation':
      return concatPreludeParts([
        evalSupportsPrelude(node.left, frame, e),
        plain(node.operator === ':' ? ': ' : ` ${node.operator} `),
        evalSupportsPrelude(node.right, frame, e)
      ]);
    case 'Sequence': {
      const parts: Array<MaybePromise<SupportsPreludePart[]>> = [];
      for (let index = 0; index < node.parts.length; index += 1) {
        if (index > 0) {
          parts.push(plain(' '));
        }
        parts.push(evalSupportsPrelude(node.parts[index]!, frame, e));
      }
      return concatPreludeParts(parts);
    }
    default:
      return mapMaybe(evalBytes(node, frame, e), plain);
  }
}

/** The `SupportsPreludePart[]` analogue of {@link joinPreludeParts}. */
function concatPreludeParts(parts: Array<MaybePromise<SupportsPreludePart[]>>): MaybePromise<SupportsPreludePart[]> {
  const out: SupportsPreludePart[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (isThenable(part)) {
      return Promise.all(parts.slice(index)).then(rest => [...out, ...rest.flat()]);
    }
    out.push(...part);
  }
  return out;
}

/**
 * Concatenate prelude fragments in SOURCE order. Stays entirely synchronous
 * while every fragment is settled — the ordinary prelude allocates one array and
 * no promise — and only the first awaitable fragment moves the join onto
 * `Promise.all`, which preserves positional order regardless of which fragment
 * settles first.
 */
function joinPreludeParts(parts: Array<MaybePromise<string>>): MaybePromise<string> {
  let out = '';
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (isThenable(part)) {
      /*
       * Only the remaining tail needs awaiting; what is already joined stays put,
       * so the result reads in source order however the tail settles.
       */
      return Promise.all(parts.slice(index)).then(rest => out + rest.join(''));
    }
    out += part;
  }
  return out;
}

/**
 * Media and container queries also own `Block` as grammar syntax. Unlike an
 * ordinary value position, evaluating a variable inside `(min-width: @size)`
 * must not erase the feature delimiters.  Keep that structural spelling while
 * delegating all leaf evaluation to the normal value path.
 */
function evalQueryPrelude(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (isValueSlotArray(node)) {
    const authored = valueLayoutOf(node);
    const parts: Array<MaybePromise<string>> = [];
    for (let index = 0; index < node.length; index += 1) {
      if (index > 0) {
        const separator = authored?.[index - 1];
        parts.push(separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : ' ');
      }
      parts.push(evalQueryPrelude(node[index]!, frame, e));
    }
    return joinPreludeParts(parts);
  }
  switch (node.type) {
    case 'Block': {
      const open = node.delimiter === 'square' ? '[' : '(';
      const close = node.delimiter === 'square' ? ']' : ')';
      return mapMaybe(evalQueryPrelude(node.value, frame, e), inner => `${open}${inner}${close}`);
    }
    case 'Operation':
      return joinPreludeParts([
        evalQueryPrelude(node.left, frame, e),
        node.operator === ':' ? ': ' : ` ${node.operator} `,
        evalQueryPrelude(node.right, frame, e)
      ]);
    case 'Sequence': {
      const parts: Array<MaybePromise<string>> = [];
      for (let index = 0; index < node.parts.length; index += 1) {
        if (index > 0) {
          parts.push(' ');
        }
        parts.push(evalQueryPrelude(node.parts[index]!, frame, e));
      }
      return joinPreludeParts(parts);
    }
    case 'List': {
      const glue = node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ';
      const authored = valueLayoutOf(node);
      const parts: Array<MaybePromise<string>> = [];
      for (let index = 0; index < node.value.length; index += 1) {
        if (index > 0) {
          const separator = authored?.[index - 1];
          parts.push(separator !== undefined && /[\r\n]|\/\*/u.test(separator) ? separator : glue);
        }
        parts.push(evalQueryPrelude(node.value[index]!, frame, e));
      }
      return joinPreludeParts(parts);
    }
    case 'Lookup':
      /* Var only — see the typed lane above. */
      if (node.kind !== 'var') {
        return evalBytes(node, frame, e);
      }
      return mapMaybe(lookupName(node, frame, e), (nm) => {
        const hit = resolveVarRef(frame, nm, node.scope, e);
        if (!hit) {
          if (hasExcludedVarRef(frame, nm, node.scope, e)) {
            recursiveReference(node, `@${nm}`, 'Variable', e);
          }
          return evalBytes(node, frame, e);
        }
        const value = hit.value;
        if (isMixinCallValue(value)) {
          return evalBytes(node, frame, e);
        }
        return withExcluded(e, value, () => evalQueryPrelude(value, hit.frame, e));
      });
    case 'Reference': {
      const resolved = resolveReferenceResult(node, frame, e);
      if (resolved === null || isMixinCallValue(resolved.value)) {
        return evalBytes(node, frame, e);
      }
      return evalQueryPrelude(resolved.value, resolved.frame, e);
    }
    default:
      return evalBytes(node, frame, e);
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

      /*
       * Less UNQUOTES an escaped string `~"…"` / `~'…'`: emit its inner bytes VERBATIM
       * (its `@{…}` interpolation is already resolved upstream at eval), dropping the
       * `~` + quotes. The inner run stays OPAQUE to the plain-run spacing rules, so a
       * ratio like `~"2/1"` prints tight (`2/1`), NOT ` / `-spaced. A plain (un-escaped)
       * quoted string keeps its quotes and passes through verbatim.
       */
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
/**
 * The emitted bytes of an at-rule prelude. `@supports` and `@media`/`@container`
 * own structural spellings the ordinary value path would erase, so each keeps
 * its own builder; all three resolve on the awaitable lane and stay synchronous
 * when nothing in the prelude needs awaiting.
 */
function atRulePreludeBytes(node: AtRuleBlock, frame: Frame, e: Emit): MaybePromise<string> {
  if (node.prelude === null) {
    return '';
  }
  const lname = node.name.toLowerCase();
  if (lname === '@supports') {
    return mapMaybe(evalSupportsPrelude(node.prelude, frame, e), normalizeSupportsPrelude);
  }
  if (lname === '@media' || lname === '@container') {
    return mapMaybe(evalQueryPrelude(node.prelude, frame, e), normalizeQueryPrelude);
  }
  return evalBytes(node.prelude, frame, e);
}

function emitAtRuleBlock(node: AtRuleBlock, frame: Frame, e: Emit, ctx: string[] | null = null): MaybePromise<void> {
  /*
   * The prelude resolves BEFORE any byte is written, so the rewind marks below
   * still bracket exactly this at-rule's output.
   */
  return mapMaybe(atRulePreludeBytes(node, frame, e), prelude =>
    emitAtRuleBlockResolved(node, frame, e, ctx, prelude));
}

function emitAtRuleBlockResolved(
  node: AtRuleBlock,
  frame: Frame,
  e: Emit,
  ctx: string[] | null,
  prelude: string
): MaybePromise<void> {
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  if (idt) {
    put(e, idt);
  }
  const renderedPrelude = keyframesPreludeWithTrivia(node, e) ?? prelude;
  put(e, node.name);
  if (renderedPrelude.length > 0) {
    put(e, ' ');
    put(e, renderedPrelude);
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const bodyFrame: Frame = {
    parent: frame,
    mixins: collectMixins(node.rules),
    declIndex: collectDeclIndex(node.rules), cells: null, reassign: null,
    statements: node.rules
  };
  const emitted = prepareBodyPlugins(node.rules, bodyFrame, e);
  const finish = (): MaybePromise<void> => {
    if (e.chunks.length === afterHeader) {
      if (hasBodyBlockCommentTrivia(node, e)) {
        emitBodyBlockCommentTrivia(node, e, INDENT.repeat(e.depth + 1));
      } else {
        // Nothing emitted: drop the whole at-rule (rewind chunks/offset/positions).
        e.chunks.length = markChunks;
        e.off = markOff;
        if (e.positions) {
          e.positions.length = markPos;
        }
        return;
      }
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

      /*
       * A non-empty selector context propagates inside; null/empty keeps the
       * top-level shape (bare direct decls) but still bubbles nested at-rules out
       * of the body's rulesets.
       */
      ? emitBubbleBody(node.rules, ctx && ctx.length > 0 ? ctx : null, bodyFrame, e)
      : emitAtRuleBody(node.rules, bodyFrame, e, node);
    return mapMaybe(rendered, finish);
  });
}

/**
 * A mixin expansion whose emitted leaves are read IMMEDIATELY by a synchronous
 * consumer. If the expansion suspends, those leaves are not there yet — so the
 * consumer would read an empty buffer and produce a confidently wrong result
 * rather than a missing one. Reported instead.
 *
 * TODO(maybe-promise-sync-islands): put the remaining synchronous consumer
 * (namespace/map base resolution) on the awaitable lane.
 */
function settledExpansion(result: MaybePromise<void>, call: MixinCall, e: EvalCtx): void {
  if (isThenable(result)) {
    observeRejectedThenable(result);
    throw ERR.asyncInSyncPosition({
      node: call,
      ...callSiteLocation(call, e),
      meta: { where: 'mixin expansion read by a synchronous namespace/map lookup' }
    });
  }
}

/**
 * Emit an at-rule body. Consecutive declarations/comments group as DIRECT block
 * children (no selector wrapper). A nested ruleset / at-rule descends one level.
 */
function emitAtRuleBody(
  statements: Statement[],
  frame: Frame,
  e: Emit,
  owner?: object
): MaybePromise<void> {
  const group: Leaf[] = [];
  const ownerBodyStart = owner === undefined ? NO_SPAN : bodyStartOf(owner);
  let bodyTriviaCursor = ownerBodyStart === NO_SPAN ? 0 : ownerBodyStart;
  const flushDirect = (): void => {
    if (group.length > 0) {
      if (groupHasMerge(group)) {
        mergeFold(group, e, INDENT.repeat(e.depth + 1));
      } else {
        for (const leaf of group) {
          if (owner !== undefined) {
            emitBodyBlockCommentTriviaBefore(owner, leaf.node, e, INDENT.repeat(e.depth + 1), bodyTriviaCursor);
            {
              const leafEnd = sourceEndOf(leaf.node);
              bodyTriviaCursor = leafEnd === NO_SPAN ? bodyTriviaCursor : leafEnd;
            }
          }
          emitLeaf(leaf, e);
        }
      }
      group.length = 0;
    }
  };

  /**
   * Emit one nested child one level in. The `depth--` must run when the child is
   * DONE, not when the call returns, or a suspended child would leave every
   * later sibling indented one level too deep.
   */
  const nested = (node: Statement, run: () => MaybePromise<void>): MaybePromise<void> => {
    flushDirect();
    if (owner !== undefined) {
      emitBodyBlockCommentTriviaBefore(owner, node, e, INDENT.repeat(e.depth + 1), bodyTriviaCursor);
      {
        const nodeEnd = sourceEndOf(node);
        bodyTriviaCursor = nodeEnd === NO_SPAN ? bodyTriviaCursor : nodeEnd;
      }
    }
    e.depth++;
    let out: MaybePromise<void>;
    try {
      out = run();
    } catch (error) {
      e.depth--;
      throw error;
    }
    if (isThenable(out)) {
      return out.then(() => {
        e.depth--;
      }, (error) => {
        e.depth--;
        throw error;
      });
    }
    e.depth--;
    return undefined;
  };
  const one = (node: Statement): MaybePromise<void> => {
    switch (node.type) {
      case 'Declaration':
      case 'Comment':
      case 'FunctionCall':
        group.push({ node, frame });
        return undefined;
      case 'Ruleset':
        return nested(node, () => flatten(node, null, null, frame, e));
      case 'AtRuleBlock':
        return nested(node, () => emitAtRuleBlock(node, frame, e));
      case 'AtRuleStatement':
        return nested(node, () => emitAtRuleStatement(node, frame, e));
      case 'Plugin':
        return undefined;
      case 'StyleImport':
        return nested(node, () => emitStyleImport(node, frame, e, e.importDocument));
      case 'ModuleImport':
        return nested(node, () => {
          emitModuleImport(node, frame, e);
        });
      case 'OpaqueAtRuleBlock':
        return nested(node, () => {
          emitOpaqueAtRuleBlock(node, e);
        });
      case 'MixinCall':
        // Best-effort: expand into the direct-declaration group.
        return expandCall(node, null, null, frame, group, flushDirect, null, e);
      case 'Apply':
        return expandApply(node, null, null, frame, group, flushDirect, null, e);
      case 'Reference':
        return expandReferenceCall(node, null, null, frame, group, flushDirect, null, e);
      case 'For':
        return expandFor(node, null, null, frame, group, flushDirect, null, e);
      case 'If': {
        const body = selectIfBodyForRender(node, frame, e);
        return body ? emitAtRuleBody(body, frame, e) : undefined;
      }
      case 'While':
        return runWhile(node, frame, e, rules => emitAtRuleBody(rules, frame, e));

      case 'MixinDefinition':
        publishSelectedMixinDefinition(frame, node);
        return undefined;
      case 'VariableDeclaration':
        activateVariableDeclaration(node, frame, e);
        markSilentStatementBlockCommentTrivia(node, e);
        return undefined;
      default:
        return undefined;
    }
  };

  /*
   * Source order is load-bearing: statement k+1 never starts before k finishes,
   * and the walk stays fully synchronous until a statement actually suspends.
   */
  const run = (index: number): MaybePromise<void> => {
    for (; index < statements.length; index++) {
      const stepped = one(statements[index]!);
      if (isThenable(stepped)) {
        const at = index;
        return stepped.then(() => run(at + 1));
      }
    }
    flushDirect();
    return undefined;
  };
  return run(0);
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

  /*
   * Less hoists direct declarations in a bubbled conditional block ahead of
   * nested rules, even when those declarations occur after a child rule in
   * authored order (`.a { @media/@container { .b { … } color: blue; } }`).
   * Keep this narrow: only a static declaration/comment/rule/at-rule body can
   * be safely staged without executing dynamic mixin/loop/import expansion
   * twice or changing live-binding activation order. Dynamic bodies retain the
   * existing streaming path below.
   */
  const deferStaticChildren = ctx !== null && statements.every(statement =>
    statement.type === 'Declaration'
    || statement.type === 'Comment'
    || statement.type === 'Ruleset'
    || statement.type === 'AtRuleBlock'
    || statement.type === 'AtRuleStatement');
  const deferredChildren: Array<() => MaybePromise<void>> | null = deferStaticChildren ? [] : null;
  const flushDirect = (): MaybePromise<void> => {
    if (group.length === 0) {
      return;
    }
    if (ctx !== null) {
      // Wrap the direct declarations in the propagated selector context.
      e.depth++;
      const emitted = flushBlock(ctx, group, e);
      if (isThenable(emitted)) {
        return emitted.then(
          () => {
            e.depth--;
            group.length = 0;
          },
          (error) => {
            e.depth--;
            throw error;
          }
        );
      }
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

  /*
   * Keep one direct-leaf group and one cursor for the whole body.  In
   * particular, an async import resumes this exact group/body placement rather
   * than closing over a per-statement callback or re-walking a sliced tail.
   */
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;
      switch (node.type) {
        case 'Declaration':
        case 'Comment':
        case 'FunctionCall':
          group.push({ node, frame });
          break;
        case 'Ruleset':
          if (deferStaticChildren) {
            deferredChildren!.push(() => {
              e.depth++;
              const emitted = flatten(node, ctx, ctxAncestor, frame, e, false, ctx !== null);
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
            const flushed = flushDirect();
            if (isThenable(flushed)) {
              return flushed.then(() => {
                e.depth++;
                const emitted = flatten(node, ctx, ctxAncestor, frame, e, false, ctx !== null);
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
                e.depth--;
                return run(index + 1);
              });
            }
            e.depth++;
            {
              const emitted = flatten(node, ctx, ctxAncestor, frame, e, false, ctx !== null);
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
            const flushed = flushDirect();
            if (isThenable(flushed)) {
              return flushed.then(() => {
                e.depth++;
                const nested = emitAtRuleBlock(node, frame, e, ctx);
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
                return run(index + 1);
              });
            }
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
            const flushed = flushDirect();
            if (isThenable(flushed)) {
              return flushed.then(() => {
                e.depth++;
                emitAtRuleStatement(node, frame, e);
                e.depth--;
                return run(index + 1);
              });
            }
            e.depth++;
            emitAtRuleStatement(node, frame, e);
            e.depth--;
          }
          break;
        case 'StyleImport': {
          const flushed = flushDirect();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              e.depth++;
              const imported = emitStyleImport(
                node,
                frame,
                e,
                e.importDocument,
                (document, importFrame) => {
                  e.depth -= 2;
                  const emitted = emitBubbleBody(document.rules, ctx, importFrame, e);
                  if (isThenable(emitted)) {
                    return emitted.then(() => {
                      e.depth += 2;
                    }, (error) => {
                      e.depth += 2;
                      throw error;
                    });
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
              return run(index + 1);
            });
          }
          e.depth++;
          const imported = emitStyleImport(
            node,
            frame,
            e,
            e.importDocument,
            (document, importFrame) => {
            /*
             * The surrounding import owns the one statement indentation level.
             * Its loaded body belongs to this bubble body's level instead, just
             * like an authored sibling; restore the import level before the
             * cursor resumes after an async load.
             * `emitBubbleBody` increments before a Ruleset while the former
             * document dispatcher emitted loaded root Rules directly.  Drop
             * the import level and that one prospective Ruleset level so the
             * canonical loaded document keeps its historical body placement.
             */
              e.depth -= 2;
              const emitted = emitBubbleBody(document.rules, ctx, importFrame, e);
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
        }
        case 'ModuleImport': {
          const flushed = flushDirect();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              e.depth++;
              emitModuleImport(node, frame, e);
              e.depth--;
              return run(index + 1);
            });
          }
          e.depth++;
          emitModuleImport(node, frame, e);
          e.depth--;
          break;
        }
        case 'OpaqueAtRuleBlock': {
          const flushed = flushDirect();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              e.depth++;
              emitOpaqueAtRuleBlock(node, e);
              e.depth--;
              return run(index + 1);
            });
          }
          e.depth++;
          emitOpaqueAtRuleBlock(node, e);
          e.depth--;
          break;
        }
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
        case 'While': {
          const emitted = runWhile(node, frame, e, rules => emitBubbleBody(rules, ctx, frame, e));
          if (isThenable(emitted)) {
            return emitted.then(() => run(index + 1));
          }
          break;
        }
        case 'MixinDefinition':
          publishSelectedMixinDefinition(frame, node);
          break;
        case 'VariableDeclaration':
          activateVariableDeclaration(node, frame, e);
          markSilentStatementBlockCommentTrivia(node, e);
          break;
      }
    }
    const flushed = flushDirect();
    if (deferredChildren === null) {
      return flushed;
    }
    const runDeferred = (childIndex: number): MaybePromise<void> => {
      for (let i = childIndex; i < deferredChildren.length; i++) {
        const emitted = deferredChildren[i]!();
        if (isThenable(emitted)) {
          return emitted.then(() => runDeferred(i + 1));
        }
      }
    };
    return mapMaybe(flushed, () => runDeferred(0));
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

/**
 * [extend] A rule deferred to an enclosing block's hoist queue (an extend match that
 * crosses the `&`). `bubble` is the PER-BOUNDARY hoist distance (`NestedRulePlan.
 * hoistBubble`): the number of enclosing blocks the rule must rise out of. `1` (the
 * classic single-level trigger-P/X hoist) emits at the immediate parent's level; `k > 1`
 * re-hoists the entry up the ancestor chain (decrementing each level) until it lands
 * `k` blocks up, so a match that crosses `k` nesting boundaries clears exactly those.
 */
interface HoistEntry {
  rule: Ruleset;
  frame: Frame;
  bubble: number;
}

function emitNestedBody(
  statements: Statement[],
  frame: Frame,
  e: Emit,
  hoist?: HoistEntry[],
  imp = false, // [important] call-level `!important` forced onto this body's decls
  source: NestedHeaderSource | null = null,
  placement: NestedRuleMixinPlacement | null = null,
  sharedLeaves?: NestedLeafBuffer,
  applyExpansion = false,

  /*
   * [G28] The block whose body these statements are, when this call owns that
   * body outright. Supplies the source span the block-interior comment replay
   * anchors on. The COLLAPSED emitter has always done this walk; the nested one
   * never did, so a block comment between declarations was dropped whenever
   * `collapseNesting` was false -- the v5 default, and therefore every real
   * compile. Left undefined for a SHARED leaf buffer, where the body being
   * emitted is not this call's to anchor against.
   */
  owner?: object
): MaybePromise<void> {
  /*
   * buffer consecutive DIRECT leaves so a `+`/`+_` merge group can fold at
   * last-occurrence; flush when an interrupting nested rule/at-rule appears (a
   * merge group does not span an interrupting nested block). Absent any merge the
   * buffer flushes verbatim per-leaf (byte-identical to the prior stream).
   */
  const buf = sharedLeaves?.leaves ?? [];

  /*
   * [G28] Body-interior comment replay for the nested emitter, mirroring the
   * walk the collapsed emitter already performs. Only armed when this call owns
   * the body outright.
   */
  const bodyOwner = sharedLeaves === undefined ? owner : undefined;
  const bodyOwnerStart = bodyOwner === undefined ? NO_SPAN : bodyStartOf(bodyOwner);
  let bodyTriviaCursor = bodyOwnerStart === NO_SPAN ? 0 : bodyOwnerStart;
  const replayBodyCommentsBefore = (statement: Statement): void => {
    if (bodyOwner === undefined) {
      return;
    }
    emitBodyBlockCommentTriviaBefore(bodyOwner, statement, e, INDENT.repeat(e.depth), bodyTriviaCursor);
    const end = sourceEndOf(statement);
    bodyTriviaCursor = end === NO_SPAN ? bodyTriviaCursor : end;
  };
  const flushBuf = sharedLeaves?.flush ?? (() => {
    if (buf.length === 0) {
      return;
    }
    if (groupHasMerge(buf)) {
      mergeFold(buf, e, e.depth > 0 ? INDENT.repeat(e.depth) : '', emitNestedLeaf);
    } else {
      for (const leaf of buf) {
        replayBodyCommentsBefore(leaf.node);
        emitNestedLeaf(leaf, e);
      }
    }
    buf.length = 0;
  });
  const inlineLeaves: NestedLeafBuffer = sharedLeaves ?? { leaves: buf, flush: flushBuf };
  let rootTriviaCursor = frame.parent === null && sharedLeaves === undefined ? 0 : undefined;
  let rootTriviaSuppressedByDefinition = false;
  const rootTriviaExclusions = rootTriviaCursor === undefined
    ? []
    : statements.map((statement) => {
        const start = statementStartOf(statement);
        const end = statementEndOf(statement);
        return start === undefined || end === undefined ? undefined : { start, end };
      }).filter(isReplaySpan);
  const emitBeforeRootStatement = (node: Statement): void => {
    if (rootTriviaCursor === undefined) {
      return;
    }
    if (rootTriviaSuppressedByDefinition) {
      rootTriviaCursor = statementStartOf(node) ?? rootTriviaCursor;
      rootTriviaSuppressedByDefinition = false;
      return;
    }
    emitBlockCommentTriviaBetween(e, rootTriviaCursor, statementStartOf(node), '', rootTriviaExclusions);
  };
  const markAfterRootStatement = (node: Statement): void => {
    if (rootTriviaCursor === undefined) {
      return;
    }
    rootTriviaCursor = statementEndOf(node) ?? rootTriviaCursor;
  };
  const emitTrailingRootTrivia = (): void => {
    if (rootTriviaCursor === undefined) {
      return;
    }
    emitTopLevelBlockCommentsBetween(e, rootTriviaCursor, Number.MAX_SAFE_INTEGER, '');
  };
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;

      /*
       * Root sibling grouping is source-adjacent only. Any non-Ruleset—including a
       * silent declaration/definition—forms a hard boundary.
       */
      if (frame.parent === null && node.type !== 'Ruleset') {
        e.lastBlock.parentKey = null;
      }
      switch (node.type) {
        case 'Declaration':
        case 'Comment': {
          if (e.referenceImportDepth > 0) {
            break;
          }
          const pushLeaf = (leafNode: Declaration | Comment): void => {
            const leaf = attachPendingLeafBlockComments(buf, {
              node: leafNode,
              frame,
              ...(imp ? { important: true } : {}),
              ...(applyExpansion ? { fromApply: true } : {})
            });
            buf.push(leaf);
          };

          /*
           * [nested-property] A property-root `{ … }` block expands to hyphenated
           * declarations here exactly as in the flattened emitter, so both modes
           * produce the same declarations — see {@link nestedPropertyDeclarations}.
           */
          const parts = node.type === 'Declaration' ? nestedPropertyDeclarations(node, frame, e) : null;
          if (parts !== null) {
            for (const part of parts) {
              pushLeaf(part);
            }
            break;
          }
          pushLeaf(node);
          break;
        }
        case 'Ruleset': {
          if (e.referenceImportDepth > 0) {
            break;
          }
          flushBuf();
          replayBodyCommentsBefore(node);
          emitBeforeRootStatement(node);

          /*
           * [extend] a rule whose extend match crosses the `&` FLATTENS: defer it to
           * the enclosing rule's hoist queue. `hoistBubble` (default 1) is how many
           * enclosing blocks it must rise out of — the per-boundary hoist distance.
           */
          if (hoist && extendProjection(frame, e)?.nestedPlan.get(node)?.flatten) {
            const plan = extendProjection(frame, e)!.nestedPlan.get(node)!;
            hoist.push({ rule: node, frame, bubble: plan.hoistBubble ?? 1 });
            markAfterRootStatement(node);
            break;
          }

          /*
           * Only a selected synthesized ruleset mixin gets a placement fact.  It
           * is consumed by the first `&`-bearing nested header; ordinary authored
           * nesting has no fact and stays literal in collapse:false mode.
           */
          const appliesPlacement = placement !== null && selectorListHasAmpersand(node.selector);
          const emitted = emitNestedRule(node, frame, e, imp, source, appliesPlacement ? placement : null, hoist);
          if (isThenable(emitted)) {
            return emitted.then(() => {
              if (appliesPlacement) {
                placement = null;
              }
              markAfterRootStatement(node);
              return run(index + 1);
            });
          }
          if (appliesPlacement) {
            placement = null;
          }
          markAfterRootStatement(node);
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
        case 'While': {
          flushBuf();
          const emitted = runWhile(node, frame, e, rules => emitNestedBody(rules, frame, e, hoist, imp, source, placement, undefined, applyExpansion));
          if (isThenable(emitted)) {
            return emitted.then(() => run(index + 1));
          }
          break;
        }
        case 'AtRuleBlock':
          flushBuf();
          emitBeforeRootStatement(node);
          {
            const emitted = emitNestedAtRuleBlock(node, frame, e, source);
            if (isThenable(emitted)) {
              return emitted.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
          }
          markAfterRootStatement(node);
          break;
        case 'AtRuleStatement':
          flushBuf();
          emitBeforeRootStatement(node);
          emitAtRuleStatement(node, frame, e);
          markAfterRootStatement(node);
          break;
        case 'StyleImport':
          flushBuf();
          emitBeforeRootStatement(node);
          {
            const imported = emitStyleImport(
              node,
              frame,
              e,
              e.importDocument,
              (document, importFrame) => emitNestedBody(document.rules, importFrame, e, hoist, imp)
            );
            if (isThenable(imported)) {
              return imported.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
          }
          markAfterRootStatement(node);
          break;
        case 'ModuleImport':
          flushBuf();
          emitBeforeRootStatement(node);
          emitModuleImport(node, frame, e);
          markAfterRootStatement(node);
          break;
        case 'OpaqueAtRuleBlock':
          flushBuf();
          emitBeforeRootStatement(node);
          emitOpaqueAtRuleBlock(node, e);
          markAfterRootStatement(node);
          break;

          // a bare value-position call statement (`e('/* … */');`): evaluate + emit.
        case 'FunctionCall':
          flushBuf();
          emitBeforeRootStatement(node);
          {
            const emitted = emitCallStatement(node, frame, e);
            if (isThenable(emitted)) {
              return emitted.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
          }
          markAfterRootStatement(node);
          break;
        case 'MixinDefinition':
          publishSelectedMixinDefinition(frame, node);
          if (rootTriviaCursor !== undefined) {
            rootTriviaSuppressedByDefinition = true;
          }
          break;
        case 'VariableDeclaration':
          activateVariableDeclaration(node, frame, e);
          markSilentStatementBlockCommentTrivia(node, e);
          if (
            rootTriviaCursor !== undefined
            && !isValueSlotArray(node.value)
            && 'type' in node.value
            && isValueBlock(node.value)
          ) {
            rootTriviaSuppressedByDefinition = true;
          }
          break;
      }
    }
    if (!sharedLeaves) {
      flushBuf();

      /*
       * [G28] Comments after the LAST statement but still inside the block.
       * The per-statement walk above only reaches comments that precede a
       * statement, so without this a trailing `a { b: c; /* z *\/ }` is lost.
       */
      if (bodyOwner !== undefined) {
        emitBlockCommentTriviaBetween(e, bodyTriviaCursor, bodyEndOf(bodyOwner), INDENT.repeat(e.depth));
      }
      emitTrailingRootTrivia();
    }
  };
  return run(0);
}

/** A `name: value;` / comment leaf at exactly the current `e.depth` level. */
function emitNestedLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';
  for (const comment of leaf.leadingBlockComments ?? []) {
    if (idt) {
      put(e, idt);
    }
    put(e, comment);
    put(e, '\n');
  }
  if (node.type === 'Declaration') {
    assertDeclarationValueIsNotRuleset(node, frame, e);
    const mark = dropMark(e);
    if (idt) {
      put(e, idt);
    }
    put(e, declName(node, frame, e)); // resolve interpolated property name
    put(e, declarationHeadTriviaText(node, e));
    const onNewLine = node.valueOnNewLine === true;
    put(e, onNewLine ? ':' : ': ');
    const valStart = e.off;
    const important = node.important === true || leaf.important === true;
    const prevElide = e.elideSink;
    e.elideSink = mark.sink; // [null] this declaration's elision, not an enclosing one
    const deferred = putValue(e, node.value, frame, isValueSlotArray(node.value) ? undefined : node.value, idt + INDENT, important, onNewLine) === null; // [whitespace] continuation indent
    e.elideSink = prevElide;
    markSilentStatementBlockCommentTrivia(node, e);
    if (e.positions) {
      if (!isValueSlotArray(node.value)) {
        e.positions.push({ node: node.value, type: node.value.type, start: valStart, end: e.off });
      }
      e.positions.push({ node, type: node.type, start, end: e.off });
    }
    emitInlineBlockCommentTriviaAfter(node, e);
    put(e, ';\n');
    finishDrop(e, mark, deferred);
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
  readonly rule: Ruleset;
  readonly call: MixinCall;
  readonly def: MixinDefinition;
  readonly bindings: Map<string, CallValue> | null;
  readonly home: Frame;
}

/**
 * A deliberately narrow Less compatibility projection.  It admits only the
 * `mi-test-c` shape: a parent containing immediate `&` shells, each shell
 * containing exactly one call whose sole selected target is a synthesized
 * ruleset-mixin.  Anything less exact remains authored nested output.
 */
function transparentShells(rule: Ruleset, frame: Frame, e: Emit): MaybePromise<TransparentShell[] | null> {
  if (rule.rules.length === 0) {
    return null;
  }
  const shells: TransparentShell[] = [];

  /*
   * Nested output is the v5 default, so this probe carries real documents and
   * cannot be a synchronous island: candidate lookup and dispatch may await.
   * Children are examined in order and the walk stays synchronous until one does.
   */
  const step = (index: number): MaybePromise<TransparentShell[] | null> => {
    for (let i = index; i < rule.rules.length; i++) {
      const child = rule.rules[i]!;
      if (child.type !== 'Ruleset' || !selectorListHasAmpersand(child.selector) || child.rules.length !== 1) {
        return null;
      }
      const call = child.rules[0];
      if (call?.type !== 'MixinCall') {
        return null;
      }
      const shellFrame: Frame = {
        parent: frame,
        mixins: collectMixins(child.rules),
        declIndex: collectDeclIndex(child.rules), cells: null, reassign: null,
        statements: child.rules
      };
      const homes = new Map<MixinDefinition, Frame>();
      const at = i;
      const take = (selected: Selection[]): MaybePromise<TransparentShell[] | null> => {
        if (selected.length !== 1 || selected[0]!.def.ruleMixin !== true) {
          return null;
        }
        const selectedOne = selected[0]!;
        shells.push({
          rule: child,
          call,
          def: selectedOne.def,
          bindings: selectedOne.bindings,
          home: homes.get(selectedOne.def) ?? shellFrame
        });
        return step(at + 1);
      };
      const candidates = call.path.length > 0
        ? findPathCandidates(shellFrame, call, e, homes)
        : lookupCandidates(shellFrame, call.name, e, homes);
      if (isThenable(candidates)) {
        return candidates.then(list => mapMaybe(dispatch(list, call, shellFrame, e, homes), take));
      }
      const selected = dispatch(candidates, call, shellFrame, e, homes);
      if (isThenable(selected)) {
        return selected.then(take);
      }
      const outcome = take(selected);
      if (isThenable(outcome)) {
        return outcome;
      }
      if (outcome === null) {
        return null;
      }
      return outcome;
    }
    return shells;
  };
  return step(0);
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
        mixins: collectMixins(shell.def.rules),
        declIndex: collectDeclIndex(shell.def.rules, shell.bindings), cells: cellsForParams(shell.bindings), reassign: null,
        statements: shell.def.rules,
        sourceOwner: sourceOwnerForBody(shell.def.rules, frame, e)
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
      const emitted = emitNestedBody(shell.def.rules, callFrame, e, undefined, imp, source);
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
  rule: Ruleset,
  frame: Frame,
  e: Emit,
  imp = false,
  source: NestedHeaderSource | null = null,
  placement: NestedRuleMixinPlacement | null = null,

  /*
   * [extend] the ENCLOSING block's hoist queue: a crossing child that must rise more
   * than one level (`bubble > 1`) is re-pushed here (decremented) instead of emitted
   * at this rule's level, so it keeps bubbling up the ancestor chain until it lands.
   */
  outerHoist?: HoistEntry[]
): MaybePromise<void> {
  /*
   * [guards] a guarded ruleset emits its block only when the guard is true (the
   * flattened path applies the same gate in `flatten`).
   */
  return mapMaybe(ruleGuardPasses(rule, frame, e), passes => passes
    ? emitNestedRuleGuarded(rule, frame, e, imp, source, placement, outerHoist)
    : undefined);
}

function emitNestedRuleGuarded(
  rule: Ruleset,
  frame: Frame,
  e: Emit,
  imp: boolean,
  source: NestedHeaderSource | null,
  placement: NestedRuleMixinPlacement | null,
  outerHoist?: HoistEntry[]
): MaybePromise<void> {
  if (!e.collapse) {
    return mapMaybe(transparentShells(rule, frame, e), shells => (shells !== null
      ? emitTransparentShells(
          shells,
          { parent: source, selector: rule.selector, frame },
          frame,
          e,
          imp
        )
      : emitNestedRuleAuthored(rule, frame, e, imp, source, placement, outerHoist)));
  }
  return emitNestedRuleAuthored(rule, frame, e, imp, source, placement, outerHoist);
}

function emitNestedRuleAuthored(
  rule: Ruleset,
  frame: Frame,
  e: Emit,
  imp: boolean,
  source: NestedHeaderSource | null,
  placement: NestedRuleMixinPlacement | null,
  outerHoist?: HoistEntry[]
): MaybePromise<void> {
  const plan = extendProjection(frame, e)?.nestedPlan.get(rule);
  if (plan?.collapseTransparent) {
    /*
     * [extend] decl-less `&&` self-collapse: emit the body (the pure-`&` child,
     * which carries its composed header via its own plan) at THIS level, dropping
     * this rule's wrapper.
     */
    const childFrame: Frame = {
      parent: frame,
      mixins: collectMixins(rule.rules),
      declIndex: collectDeclIndex(rule.rules), cells: null, reassign: null
    };
    return emitNestedBody(rule.rules, childFrame, e, undefined, imp, source, placement, undefined, false, rule);
  }
  if (plan?.flatten && !plan.hoistNested) {
    /*
     * Fallback (a top-level rule never flattens; a body-nested one is deferred by
     * emitNestedBody's hoist queue). Emit via the flat path with compaction.
     */
    return emitHoisted(rule, frame, e);
  }

  /*
   * A `hoistNested` rule falls through: it is emitted NESTED here (at the hoist
   * position), its `plan.header` already carrying the composed cross-`&` sibling
   * list; children stay literal-nested.
   */
  const markChunks = e.chunks.length;
  const markOff = e.off;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.off;
  const idt = e.depth > 0 ? INDENT.repeat(e.depth) : '';

  /*
   * [extend] nested header uses the projected own-local branch list; children
   * stay literal (nested mode composes nothing).
   * `placement` only originates at a selected synthesized ruleset mixin.  Its
   * header is composed structurally from the original selector nodes and their
   * render frames; it does not rewrite selector strings or re-render a body.
   * The nested header may name a value that must be awaited (an interpolated
   * selector built from an async function). Nested output is the v5 DEFAULT, so
   * this path carries the plugin corpus and cannot be a synchronous island.
   */
  const ownMaybe = plan
    ? plan.header
    : placement === null
      ? ownStrings(rule.selector, frame, e)
      : compose(nestedSourceStrings(placement.source, e), rule.selector, placement.callFrame, e);
  return mapMaybe(ownMaybe, (ownAll) => {
    /*
     * [placeholder] Nested output is the v5 DEFAULT and never reaches
     * `visibleHeader`, so the branch filter is applied here too — otherwise a
     * placeholder would emit nothing when a rule happened to flatten and emit
     * invalid CSS when it did not. A rule left with no visible branch drops
     * WITH its subtree: an un-extended `%ph { … .nested { … } }` contributes
     * nothing at all, while an extended one reaches output through the
     * extender's own header, which `plan.header` already carries.
     */
    const own = withoutPlaceholders(ownAll);
    if (own === null) {
      return;
    }
    const authoredHeader = plan === undefined && placement === null && source === null
      ? authoredSelectorHeaderWithTrivia(rule.selector, own, e)
      : null;
    const header = authoredHeader ?? (idt ? own.join(',\n' + idt) : own.join(',\n'));

    /*
     * Less only coalesces this nested-output root seam after an authored header
     * has been evaluated. Static same-selector root rules remain distinct.
     */
    const rootSibling = frame.parent === null && e.depth === 0
      && rule.selector.selectors.some(selectorBranchHasInterp);
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
      mixins: collectMixins(rule.rules),
      declIndex: collectDeclIndex(rule.rules), cells: null, reassign: null,
      statements: rule.rules
    };
    const childSource: NestedHeaderSource = { parent: source, selector: rule.selector, frame };

    /*
     * Nested output owns the same lexical placement facts as flattened output:
     * a later namespace call must enter this exact child frame to see imports that
     * executed inside the Ruleset.
     */
    (frame.rulePlacements ??= new Map()).set(rule, childFrame);

    /*
     * [extend] children that flatten (extend crossed the `&`) bubble out to this
     * rule's depth; collect them and emit flat after the block closes.
     */
    const hoist: HoistEntry[] = [];
    e.depth++;
    const finish = (): MaybePromise<void> => {
      e.depth--;
      if (e.chunks.length === afterHeader) {
        if (hasBodyBlockCommentTrivia(rule, e)) {
          emitBodyBlockCommentTrivia(rule, e, INDENT.repeat(e.depth + 1));
        } else {
          // Nothing emitted in the block: drop the header/braces (rewind).
          e.chunks.length = markChunks;
          e.off = markOff;
          if (e.positions) {
            e.positions.length = markPos;
          }
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

      /*
       * [extend] split-out exact extenders (target has surviving nested children):
       * sibling rules carrying only the target's DIRECT declarations (empty → drop).
       */
      const direct: Leaf[] = [];
      if (plan && plan.splits.length > 0) {
        for (const st of rule.rules) {
          if (st.type === 'Declaration' || st.type === 'Comment') {
            direct.push({ node: st, frame: childFrame });
          }
        }
      }
      const emitSplits = (index: number): MaybePromise<void> => {
        if (!plan || direct.length === 0) {
          return;
        }
        for (let splitIndex = index; splitIndex < plan.splits.length; splitIndex++) {
          const emitted = flushBlock(plan.splits[splitIndex]!, direct, e);
          if (isThenable(emitted)) {
            return emitted.then(() => emitSplits(splitIndex + 1));
          }
        }
      };

      /*
       * [extend] hoisted (flattened) children at this rule's depth: a `renest` child
       * emits NESTED (composed cross-`&` header, children literal); a `collapse` child
       * emits FLAT. A `bubble > 1` child must rise FURTHER: re-push it (decremented) to
       * THIS rule's enclosing hoist queue so it keeps bubbling up the ancestor chain,
       * landing exactly `bubble` blocks above its origin (its stripped header re-nests
       * under the wrapper ancestors it lands inside). When there is no outer queue (an
       * outermost block), it lands here — the highest reachable level.
       */
      const runHoist = (index: number): MaybePromise<void> => {
        for (let hoistIndex = index; hoistIndex < hoist.length; hoistIndex++) {
          const h = hoist[hoistIndex]!;
          if (h.bubble > 1 && outerHoist) {
            outerHoist.push({ rule: h.rule, frame: h.frame, bubble: h.bubble - 1 });
            continue;
          }
          const emitted = extendProjection(h.frame, e)?.nestedPlan.get(h.rule)?.hoistNested
            ? emitNestedRule(h.rule, h.frame, e, imp)
            : emitHoisted(h.rule, h.frame, e);
          if (isThenable(emitted)) {
            return emitted.then(() => runHoist(hoistIndex + 1));
          }
        }
      };
      return mapMaybe(emitSplits(0), () => runHoist(0));
    };
    return mapMaybe(emitNestedBody(rule.rules, childFrame, e, hoist, imp, childSource, null, undefined, false, rule), finish);
  });
}

/** Emit a flattened rule (and its descendants) via the flat path at `e.depth`,
 * using the nested-mode hoist header (flat composition + `:is()`-compaction). */
function emitHoisted(rule: Ruleset, frame: Frame, e: Emit): MaybePromise<void> {
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
  /*
   * Candidate resolution mirrors the flat-path {@link expandCall}: a bare `.m()`
   * walks the scope chain accumulating same-name overloads (explicit `MixinDefinition`s
   * AND paren-less rulesets callable as zero-arg mixins), a namespaced/compound
   * call descends by element value; both record each candidate's DEFINITION frame
   * in `homes` so the body + guards resolve free variables in the mixin's CLOSURE
   * scope, not the call site (`mixins-closure`).
   */
  const namespaced = call.path.length > 0;
  const homes = new Map<MixinDefinition, Frame>();

  /*
   * Candidate lookup builds each frame index as it reaches it, which can await
   * when a rule's mixin key is interpolated from an awaitable value.
   */
  return mapMaybe(namespaced
    ? findPathCandidates(frame, call, e, homes)
    : lookupCandidates(frame, call.name, e, homes), (rawCandidates) => {
  /*
   * [parent-exclusion] a paren-less ruleset-mixin does not re-enter its own body
   * while it is on the active expansion stack (see `expandCall`).
   */
    const candidates = rawCandidates.some(d => d.ruleMixin === true)
      ? rawCandidates.filter(d => d.ruleMixin !== true || !parentExcludes(frame, d.rules))
      : rawCandidates;
    if (rawCandidates.length === 0) {
      unresolvedMixinCall(call, e);
    }
    if (candidates.length === 0) {
      return;
    }
    const queueComments = sharedLeaves === undefined
      ? undefined
      : queueCommentOnlyMixinBodies(candidates, call, frame, e, sharedLeaves.leaves);
    const runDispatch = (): MaybePromise<void> => mapMaybe(dispatch(candidates, call, frame, e, homes, true), (selected) => {
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

          /*
           * [closure] free variables resolve in the mixin's DEFINITION scope first, with
           * the call-site scope as a fallback (a namespaced call is confined to the
           * namespace, so it takes no caller fallback) — the same layering `expandCall`
           * builds for the flat path.
           */
          const homeFrame = homes.get(def) ?? frame;
          const callFrame: Frame = {
            parent: homeFrame,
            mixins: collectMixins(def.rules),
            declIndex: collectDeclIndex(def.rules, bindings), cells: cellsForParams(bindings), reassign: null,
            statements: def.rules,
            sourceOwner: sourceOwnerForBody(def.rules, frame, e),
            ...(namespaced || homeFrame === frame ? {} : { fallback: frame })
          };
          captureArgDefFrames(bindings, frame, callFrame, e);
          const placement = def.ruleMixin === true && source !== null
            ? { source, callFrame } satisfies NestedRuleMixinPlacement
            : null;
          const executeBody = () => mapMaybe(
            prepareBodyPlugins(def.rules, callFrame, e),
            () => {
              return emitNestedBody(def.rules, callFrame, e, undefined, bodyImp, source, placement, sharedLeaves, applyExpansion);
            }
          );
          const emitted = withSourceOwner(e, callFrame.sourceOwner, executeBody);
          if (isThenable(emitted)) {
            return emitted.then(() => {
              leakBodyVars(frame, def.rules, callFrame, e);
              publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
              if (def.ruleMixin !== true) {
                publishExplicitRulesets(frame, def.rules, callFrame);
              }
              return run(index + 1);
            });
          }

          /*
           * [scope-leak] the mixin's own `@x:` declarations and nested rulesets unlock
           * into the caller scope for later siblings (less@4 splices evaluated rules as
           * siblings of the call), matching the flat path.
           */
          leakBodyVars(frame, def.rules, callFrame, e);
          publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
          if (def.ruleMixin !== true) {
            publishExplicitRulesets(frame, def.rules, callFrame);
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
    });
    return mapMaybe(queueComments, runDispatch);
  });
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
  const selected: Array<{ rule: Ruleset; home: Frame }> = [];

  /*
   * [guards] Selecting which ruleset-mixin bodies apply may need an awaitable
   * guard value, so candidates are gathered first and their guards folded in
   * order — the fold stays fully synchronous until a guard actually awaits.
   */
  const candidates: Array<{ rule: Ruleset; home: Frame }> = [];
  for (const selector of node.selectors) {
    const key = selectorTermCanonical(selector);
    for (let scope: Frame | null = frame; scope; scope = scope.parent) {
      const matches = frameRulesets(scope)?.get(key);
      if (!matches) {
        continue;
      }
      for (const rule of matches) {
        if (!parentExcludes(frame, rule.rules)) {
          candidates.push({ rule, home: scope });
        }
      }
    }
  }
  const gather = serialForEach(candidates, ({ rule, home }) =>
    mapMaybe(ruleGuardPasses(rule, home, e), (passes) => {
      if (passes) {
        selected.push({ rule, home });
      }
    }));
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < selected.length; index++) {
      const { rule, home } = selected[index]!;
      const applyFrame: Frame = {
        parent: home,
        mixins: collectMixins(rule.rules),
        declIndex: collectDeclIndex(rule.rules), cells: null, reassign: null,
        statements: rule.rules,
        sourceOwner: sourceOwnerForBody(rule.rules, frame, e),
        ...(home === frame ? {} : { fallback: frame })
      };
      const emitted = withSourceOwner(e, applyFrame.sourceOwner, () => mapMaybe(
        prepareBodyPlugins(rule.rules, applyFrame, e),
        () => emitNestedBody(rule.rules, applyFrame, e, undefined, imp, source, null, sharedLeaves, true)
      ));
      if (isThenable(emitted)) {
        return emitted.then(() => run(index + 1));
      }
    }
  };
  return mapMaybe(gather, () => run(0));
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
  /*
   * A variable bound to a MIXIN CALL (`@alias: .something(foo); @alias();`) is
   * dispatched as that call, not spliced as a detached ruleset.
   */
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
  const dr = resolveValueBlock(resolved.value, resolved.frame, e);
  if (!dr) {
    return;
  }
  const r = referenceCallFrame(dr, frame, resolved.frame, resolved.sourceOwner);
  const drBody = valueBlockBody(r.dr);
  const executeBody = () => mapMaybe(
    prepareBodyPlugins(drBody, r.callFrame, e),
    () => emitNestedBody(drBody, r.callFrame, e, undefined, imp, source, null, sharedLeaves, applyExpansion)
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
  return mapMaybe(forItems(node.iterable, frame, e), (items) => {
    const run = (start: number): MaybePromise<void> => {
      for (let i = start; i < items.length; i++) {
        const item = items[i]!;
        const { value, key } = item;
        const index = dimension(i + 1);
        const bindings = bindForEntry(node, value, key, index);
        const bindingValueFrames = bindingValueFramesForItem(bindings, item);
        const extendPlacement = e.plannedForExtendPlacements?.get(node)?.[i];
        const loopFrame: Frame = {
          parent: frame,
          mixins: collectMixins(node.rules),
          declIndex: collectDeclIndex(node.rules, bindings), cells: cellsForParams(bindings, bindingValueFrames), reassign: null,
          statements: node.rules,
          sourceOwner: frame.sourceOwner ?? null,
          ...(bindingValueFrames ? { bindingValueFrames } : {}),
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
  });
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
  return mapMaybe(atRulePreludeBytes(node, frame, e), prelude =>
    emitNestedAtRuleBlockResolved(node, frame, e, source, prelude));
}

function emitNestedAtRuleBlockResolved(
  node: AtRuleBlock,
  frame: Frame,
  e: Emit,
  source: NestedHeaderSource | null,
  prelude: string
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
  if (prelude.length > 0) {
    put(e, ' ');
    put(e, prelude);
  }
  put(e, ' {\n');
  const afterHeader = e.chunks.length;
  const bodyFrame: Frame = {
    parent: frame,
    mixins: collectMixins(node.rules),
    declIndex: collectDeclIndex(node.rules), cells: null, reassign: null,
    statements: node.rules
  };
  e.depth++;
  const finish = (): void => {
    e.depth--;
    if (e.chunks.length === afterHeader) {
      if (hasBodyBlockCommentTrivia(node, e)) {
        emitBodyBlockCommentTrivia(node, e, INDENT.repeat(e.depth + 1));
      } else {
        e.chunks.length = markChunks;
        e.off = markOff;
        if (e.positions) {
          e.positions.length = markPos;
        }
        return;
      }
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
    prepareBodyPlugins(node.rules, bodyFrame, e),
    () => mapMaybe(emitNestedBody(node.rules, bodyFrame, e, undefined, false, source, null, undefined, false, node), finish)
  );
}
