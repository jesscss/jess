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
  collection,
  collectionEntry,
  decl,
  dimension,
  funcCall,
  importOptionWords,
  interpolation,
  mixinCall,
  operation,
  keyword,
  list,
  NULL_NODE,
  spaced,
  variableDeclaration,
  variableReference,
  anonymousMixin,
  isLiteralNode,
  isTypedLiteral,
  isStaticQuoted,
  quoted,
  isValueBlock,
  valueBlockBody,
  compoundCanonical,
  compoundHasInterp,
  complexCanonical,
  complexHasInterp,
  complexHasAmpersand,
  isLanguageRange,
  pseudoCanonical,
  pseudoHasAmpersand,
  pseudoHasInterp,
  pseudoJoin,
  relativeSelector,
  selectorBranchCanonical,
  selectorBranchHasAmpersand,
  selectorBranchHasInterp,
  selectorBranchOf,
  selectorTermCanonical,
  selectorTermHasInterp,
  selectorTermOf,
  selist,
  simpleSelector,
  simpleTokenHasInterp,
  textHoldsParentRef,
  branchTextIsPlaceholder,
  isCssColorCall
} from './nodes.js';
import type {
  Any,
  Apply,
  AuthoredCallSlot,
  Block,
  Collection,
  NestedPropertyBlock,
  Color,
  Comment,
  ComplexSelector,
  CompoundSelector,
  Declaration,
  Expression,
  AnonymousMixin,
  ValueBlock,
  Dimension,
  ExtendInstruction,
  For,
  If,
  While,
  IfValue,
  FunctionCall,
  Interpolation,
  Keyword,
  Reference,
  ReferenceCall,
  MixinCall,
  MixinDefinition,
  ModuleImport,
  Operation,
  PseudoArgument,
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
  StyleImportConfig,
  ValueNode,
  ValueSlot,
  VariableDeclaration,
  VariableLookup,
  Lookup,
  Url
} from './nodes.js';

// [atrule] block + statement at-rule node types
import type { AtRuleBlock, AtRuleStatement, UnknownAtRuleBlock, Plugin } from './at-rule.js';
import { isDiagnosticStatement } from './at-rule.js';

// typed synchronous value evaluator seam + boundary-clean value domain.
import {
  DEFAULT_MODES,
  DivisionByZeroError,
  EmptyOperandError,
  IncomparableOperandsError,
  emitValue,
  delimiterClose,
  delimiterOpen,
  isValueGroup,
  isValueGroupArray,
  authoredSpace,
  isElided,
  isLiteral,
  itemBoundary,
  joinGroup,
  literal,
  runReplays,
  sepGlue,
  writtenArgument,
  type EvalModes,
  type FnScope,
  type PluginCallCtx,
  type PluginHost,
  type PluginRawArgument,
  type PluginVariableHit,
  type Collection as ValueCollection,
  type CollectionEntry as ValueCollectionEntry,
  type EvalValue,
  type ValueEvaluator,
  type ValueGroup,
  type Value,
  type WrittenArguments
} from './value-eval.js';
import type { Fn, FnCtx, FnIo } from './functions/types.js'; // [plugin/P1] scoped-fn registry; [io] file-read seam
import { defineFunction, FunctionDeclined } from './value-dispatch.js';
import { type MaybePromise, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { colorFromSrc, dimensionFromFields, quotedFromFields, sniffLiteral } from './literal-tag.js'; // [value node model]
import { namedColor } from './color-names.js';
import { compressDimensionBytes, compressSelectorHeader, emitCompressed, shortestColorFromHex } from './compress.js';
import { UnitArithmeticError, calcInner, findFinalValue, groupAsWritten, isKeptOperation, isUnexpressible, keepAsWritten, keptMathOf, operandAsWritten, preservedUnitClashes, validateFinalUnits, writtenCalc } from './value-operate.js'; // [calc/unit validation]
import { makeAny, makeBlock, makeCollection, makeDimension, makeKeyword, makeBool, makeList, makeNull, makeQuoted, makeSpelledDimension, makeUrlValue, NULL } from './value-factory.js'; // [calc]
import { CollectionOverlay, isCollection } from './value-collection.js';
import { groupItems } from './value-list.js';
import { DefaultGuardAmbiguityError, bindArgs, isTypedCallValue, isValueSlot, selectDefinitions, type Selection, type DefaultResolver, type BoundSourceResolver, type BoundSourceResolvers, type RestBoundSourceResolver, type BoundSourceTracker, type CallArg, type CallValue } from './mixin-dispatch.js'; // [guards]
import { evalGuard, guardUsesDefault, type GuardNode, type ValueResolver, type TypedResolver } from './guard.js'; // [guards]
import { isTruthy } from './value-truth.js'; // [§4.4] the one typed truthiness predicate
import { computeExtends, type ExtendPlacementResults, type ExtendResults } from './extend.js'; // [extend]
import { atRuleScope, recordAstExtendProfile } from './extend/plan.js'; // [extend/selector-interp]
import type { AtRuleScopes, ExtendBoundary, PlanInstruction, PlanOverlay, PlanReferenceAtRule, PlanSubject } from './extend/plan.js';
import type { Branch, Level } from './extend/ir.js';
import { branchFromSelector, branchSharesAtom, collectBranchAtoms, descendantBranch, levelFromSelectorList, textSimple } from './extend/ir.js';
import { mayCarryPseudoElement, nestingGroupKey, partitionGroups } from './is-grouping.js'; // [nesting] the shared `:is()` grouping
import { DocumentContext, documentTriviaOf, type Context, type SourceContext } from '../context.js';
import type { ModuleConfigRejection } from '../plugin.js';
import { Deprecation } from '../deprecation.js';
import { ERR, WARN, toDiagnostic } from '../error/diagnostics.js';
import { JessError, type TreeContextLike } from '../error/jess-error.js';
import { INJECTED_TEXT_NOTE, fileAt, lineColAt } from '../error/code-frame.js';
import { NO_SPAN, bodyEndOf, bodySpanOf, bodyStartOf, generalEnclosedSourceOf, hasAmbientFunctions, isGeneralEnclosedTemplate, sourceEndOf, sourceSpanOf, sourceStartOf, triviaMapOf, valueBoundaryTriviaOf, valueLayoutOf, withValueLayout, type AstSourceSpan } from './provenance.js';
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

  /**
   * The source file active when this chunk was emitted. Populated only when
   * `trackPositions` is on, from `context.sourceContext.file` — which
   * `withSourceOwner`/`withDocument` re-scope while emitting imported documents,
   * so a position from an imported file carries THAT file's identity (its
   * `_s`/`_e` offsets index into `source`), not the entry file's. This is what
   * lets a multi-file source map attribute each mapping to the right file.
   */
  source?: SourceContext['file'];

  /** The authored offset in `source`, when the chunk has no node of its own (inlined text). */
  sourceStart?: number;
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
   *
   * When flattening, the STYLE is `'native'` (default) — parent `:is()`, and
   * child branches of equal specificity fold into one `:is(…)` (native
   * specificity and matching, not the byte-exact CSS Nesting desugaring) — or
   * `'compact'`, which folds every descendant child branch into a single `:is(…)`
   * (group-max specificity). Extend's own `:is()` groups are guarded like
   * `'native'` in every mode.
   */
  collapseNesting?: false | 'native' | 'compact';

  /**
   * [compress] Minified output (`output.compress`). `true` removes all
   * non-significant whitespace and comments (except `/*! … *&#47;` bang comments)
   * and re-spells each value in its shortest still-valid form — driven by the
   * value's CLASSIFICATION, never by re-scanning serialized bytes. Default (unset)
   * is pretty output, byte-identical to before this option existed. See
   * docs/less/advanced/compressed-output.md.
   */
  compress?: boolean;

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
 * The bytes are spliced at this StyleImport's lexical position. A media query on
 * a legacy `@import (inline)` is not carried here: the less grammar desugars it
 * into a `@media` `AtRuleBlock` that wraps the StyleImport, so the bytes splice
 * INSIDE that media block. A `supports(...)`/`layer` tail is still a parse error.
 */
export interface ImportDocumentInline {
  readonly inline: string;

  /** The inlined file, so source maps can point each spliced line back into it. */
  readonly file?: SourceContext['file'];
}

export type ImportDocument = ImportDocumentTree | ImportDocumentInline;

interface PlannedImportDocument {
  request: ImportDocumentRequest;
  loaded: ImportDocument | undefined;
}

type PreparedModule = Readonly<Record<string, unknown>>;

interface PreparedImportState {
  documents: WeakMap<StyleImport, PlannedImportDocument>;
  modules: Map<ModuleImport, PreparedModule>;
}

declare const PREPARED_IMPORTS_BRAND: unique symbol;

/** Opaque compile-time import plan. Its mutable document records are internal
 * render machinery, not a public graph for callers to inspect or modify. */
export interface PreparedImports {
  readonly [PREPARED_IMPORTS_BRAND]: true;
}

type PreparedImportsReader = () => PreparedImportState;

function makePreparedImports(
  documents: WeakMap<StyleImport, PlannedImportDocument>,
  modules: Map<ModuleImport, PreparedModule>
): PreparedImports {
  const state: PreparedImportState = { documents, modules };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the callable is the private runtime carrier for this nominal token.
  return (() => state) as PreparedImportsReader & PreparedImports;
}

function preparedImportDocuments(prepared: PreparedImports): WeakMap<StyleImport, PlannedImportDocument> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only makePreparedImports constructs this nominal token.
  return (prepared as unknown as PreparedImportsReader)().documents;
}

function preparedModules(prepared: PreparedImports): Map<ModuleImport, PreparedModule> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only makePreparedImports constructs this nominal token.
  return (prepared as unknown as PreparedImportsReader)().modules;
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
 * Import-once covers a `(reference)` re-import (ledger J14, X18): a `(reference)` import of
 * a document any `@import` already placed — plain, `(multiple)` or `(reference)` — is
 * dropped, so the sheet is placed once and stays as visible as it was. A plain import after
 * a `(reference)` one is not a re-import: it renders the sheet the author asked to see. A
 * plain import after a visible `(multiple)` one is (a plain import is `once`: any later
 * import of a file already included is ignored; {@link isVisibleMultiple}). A `(multiple)`
 * import, or one inside a `(multiple)` sheet, places its own copy and is never dropped.
 * The import planner and the render walk both ask this, in document order, an import
 * inside a ruleset included, so they agree on which imports place a sheet.
 */
function isReferenceReimport(node: StyleImport, options: string | null, inMultiple: boolean, placed: boolean): boolean {
  return placed && !inMultiple && node.mode !== 'compose'
    && importHasOption(options, 'reference') && !importHasOption(options, 'multiple');
}

/**
 * A `(multiple)` import that places its sheet visibly — not `(reference)`, not inside a
 * `(reference)` sheet — includes the file, so a later plain import of it is a no-op, as
 * after a plain import (ledger X18: the sheet is shown, so nothing the author asked to see
 * is hidden; orchestrator judgment under owner delegation 2026-10-06).
 */
function isVisibleMultiple(node: StyleImport, options: string | null, hidden: boolean): boolean {
  return !hidden && node.mode !== 'compose' && importHasOption(options, 'multiple') && !importHasOption(options, 'reference');
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
    const location = callSiteLocation(request.node, { context });
    if (error instanceof JessError && error.code === 'import/not-found') {
      throw ERR.importNotFound({
        node: request.node,
        ...location,
        meta: {
          specifier: request.specifier,
          from: location.ctx.file?.path ?? process.cwd()
        }
      });
    }
    throw ERR.importLoadFailed({
      node: request.node,
      ...location,
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
        const file = await context.readInlineImport(specifier);
        return { inline: file.source, file };
      } catch (error) {
        importError(request, error);
      }
    }

    /*
     * Parse-mode selection remains Context/plugin-owned. The typed Less `(less)`
     * flag asks the existing dispatcher for its `less` plugin even when the path
     * ends in `.css`; core never chooses or invokes a parser itself. An import
     * with no CSS meaning — `(less)`, `@-import`, `(reference)`, `@compose` —
     * must load, so a plugin refuses rather than leaves it a CSS terminal.
     */
    const less = importHasOption(options, 'less') || node.name.toLowerCase() === '@-import';
    const mustLoad = less || node.mode === 'compose' || importHasOption(options, 'reference');
    let loaded: Awaited<ReturnType<Context['loadImport']>>;
    try {
      loaded = await context.loadImport(specifier, less ? { type: 'less', mustLoad } : { mustLoad });
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

/* Typed collection entries have no authored AST value node. Their mandatory
 * `evaluated` slot carries the value; this inert singleton only satisfies the
 * existing binding/declaration shape without allocating one wrapper per item. */
const EVALUATED_BINDING: ValueNode = any('');

/**
 * The source-fold position of one fact inside a frame's body: the path of
 * statement indexes that reaches it. An authored top-level statement is `[i]`; a
 * statement inside a selected `$if` arm is `[i, j]`; a fact published by the
 * `@import` at `[i]` is `[i, j]` where `j` is its index in the imported
 * document, so an imported fact sorts AT its import's lexical position — Less
 * folds an `@import`'s statements in where the `@import` is written, so a local
 * fact after it overrides the imported one and a local fact before it does not.
 *
 * **An AUTHORED statement's rank is always SINGLE-ELEMENT**, and the whole
 * byte-unchanged argument rests on it: against `[i]` the comparator decides on
 * the first element alone unless the first elements are equal, and they are equal
 * only for the facts of the `@import` that IS statement `i`. So no ordering
 * between two authored statements, and none between an authored statement and the
 * facts of a different `@import`, can change. Authored ranks are never
 * materialized as arrays — {@link compareSourceRankToIndex} compares against the
 * index directly (multi-element ranks belong to published facts and to `$if`-arm
 * definitions, which carry their own rank).
 */
type SourceRank = readonly number[];

/**
 * The rank of a fact whose import site this frame never learned (the A10
 * `@media`-wrapped `@import` desugar): it keeps the position publication order
 * gave it. In the ordered merges that is AHEAD of every ranked fact (the
 * historical import-first prefix); in the last-wins declaration stack
 * ({@link publishImportedVariableDeclaration}) the unranked path appends, which
 * is the LAST slot. Opposite directions, same effect — the import wins, exactly
 * as it did before ranks existed.
 */
const UNRANKED_FACT: SourceRank = [];

/** {@link UNRANKED_FACT}'s site: before authored statement `0`. */
const UNRANKED_SITE = -1;

/**
 * Compare a rank against the single-element rank `[index]` of an authored
 * top-level statement, WITHOUT materializing that array. `[index, …]` — the facts
 * of the `@import` that is statement `index` — sorts after it; any other rank is
 * decided by its first element, and an absent one ({@link UNRANKED_FACT}) sorts
 * first.
 */
function compareSourceRankToIndex(rank: SourceRank, index: number): number {
  const head = rank[0];
  if (head === undefined) {
    return -1;
  }
  return head !== index ? head - index : rank.length - 1;
}

interface OrderedMixinCandidate {
  readonly definition: MixinDefinition;
  readonly rank: SourceRank;
}

interface OrderedMixinIndex {
  readonly byName: Map<string, OrderedMixinCandidate[]>;
}

interface SelectedMixinPath {
  readonly node: If;
  readonly rules: Statement[];
}

interface MixinDefinitionMeta {
  readonly rank: SourceRank;
  readonly selectedPath: readonly SelectedMixinPath[];
}

/** Shared, source-order declaration facts for one lexical body. Never mutated. */
interface DeclIndex {
  readonly byName: Map<string, VariableDeclaration[]>;

  /**
   * Whether the body holds a `$if`/`if()`/`$while`, whose selected body
   * {@link collectSelectedDeclIndex} splices into the stacks by position. Read
   * off the statements the index is built from, so no frame re-scans its body.
   */
  readonly controlFlow: boolean;
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
  valueFrame: Frame | null;
  evaluated: ValueGroup | null;
  prev: BindingCell | null;
}

interface BindingHit {
  value: Binding;
  frame: Frame;
  evaluated: ValueGroup | null;
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
   * Identity of one executed `$for`/`each()` iteration or mixin call when this frame
   * descends from it, issued while walk-time extend recording is armed. This is
   * render-local placement state, never a property of the canonical `For` or
   * `Ruleset` AST: the same rule body may execute repeatedly with distinct bindings
   * and selectors and therefore needs distinct extend-plan facts.
   */
  extendPlacement?: object;

  /**
   * [extend/splice] Set on a mixin-call body frame. A ruleset called as a mixin
   * (`.b { .z(); }`) splices the ruleset's OWN nested `Ruleset` nodes by identity,
   * so those nodes are in the static extend plan (`flatByRule`) under their
   * DEFINITION selector (`.z .c`). At this call-site placement their header is the
   * composed call-site selector (`.b .c`), not the static plan's — the `.z`-targeted
   * extend must not leak onto the splice. Emit uses `headerComposed` for a static
   * extend-target rule reached through such a placement (see `flattenWithHeader`).
   */
  mixinSplice?: boolean;

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

  /**
   * The direct `if()`/`$if` statements {@link preselectControlFlow} decided for
   * this activation, each with its arm or `null` for none. Execution reuses a
   * decision instead of evaluating the condition again. Absent until the frame's
   * control flow is first selected.
   */
  preselectedIfs?: ReadonlyMap<If, Statement[] | null>;

  /**
   * Source-ordered direct + selected-branch declaration index for this
   * activation. `undefined` until the frame's control flow is first selected
   * ({@link preselectControlFlow}), and again after an imported fact joins the
   * frame, until the next scoped read rebuilds it ({@link selectControlFlow}).
   */
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
   * [R16] This frame's `fallback` is the ambient CALL SITE (a mixin body,
   * detached ruleset, value-lambda, or dispatch overlay — not a detached-closure
   * member scope). Plain VARIABLE reads treat it as invisible unless
   * `allowCallerScope` is on; `parentExcludes`, path/namespace lookups, and
   * mixin-visibility publishing traverse `fallback` regardless, so recursion,
   * member access, and caller-published mixins keep working.
   */
  callerFallback?: boolean;

  /*
   * rulesets visible at this level, keyed by their own-local selector
   * string (namespace path descent). Lazily built only when a namespaced call or
   * map/namespace accessor needs it, and dropped by the next import publication —
   * so this is memoized PER PUBLICATION EPOCH, not once per frame, and publication
   * interleaves with emission. That is why its builder must stay linear.
   */
  rulesets?: Map<string, Ruleset[]> | null;

  /**
   * Root rulesets published from the static import graph, kept SITE-ASCENDING by
   * {@link insertRankedFact} so the source-fold merge can two-cursor them.
   */
  importedRules?: Ruleset[] | null;

  /**
   * [import-fold] The source-fold SITE of `importedRules[i]` — the statement index
   * of the `@import` that folded it in, or `-1` for a fact whose site is unknown
   * ({@link UNRANKED_FACT}). A parallel INT array, not a rank per entry and not a
   * node-keyed map: the merges need only this first element (`site < index` IS the
   * whole comparison, see {@link compareSourceRankToIndex}), so the one reader on a
   * lookup path compares integers and touches nothing else.
   */
  importedRuleSites?: number[] | null;

  /**
   * Imported callable statements, kept SITE-ASCENDING by
   * {@link insertRankedFact} (which for ordinary ascending publication is one
   * integer comparison and a push). Static planning makes document-root import facts
   * visible before output evaluation; namespaced descent must see imported
   * definitions as well as rulesets, and two-cursors this list against
   * {@link statements} with no merged array to cache or invalidate.
   */
  importedCallables?: Array<MixinDefinition | Ruleset> | null;

  /** [import-fold] Source-fold site of `importedCallables[i]`; see
   *  {@link importedRuleSites}. */
  importedCallableSites?: number[] | null;

  /**
   * [import-fold] {@link SourceRank} of each published import DECLARATION — the
   * `@import`'s own position extended by the declaration's index in the imported
   * document. Declarations only, because the ordered declaration stack is the only
   * consumer that must compare a published fact to another fact or to a statement
   * position (the `$if`/`$while` splice in `collectSelectedDeclIndex`); the ordered
   * merges carry a site int per entry instead, and dispatch candidates carry their
   * rank on the candidate. Authored statements are deliberately absent: their rank
   * IS their index in {@link statements}. Written at PUBLICATION time and read
   * there or when a control-block selection rebuilds the index — no lookup path
   * reaches it.
   */
  factRanks?: Map<VariableDeclaration, SourceRank>;

  /**
   * [import-fold] Authored position of each top-level statement, built ONCE and
   * only on the paths that must resolve a position from the statement itself
   * rather than from a loop cursor: a published declaration colliding with an
   * existing stack entry, an import that reaches publication without its index in
   * hand, and a control-block body spliced into the declaration stacks. Integer
   * values — never a tuple per statement.
   */
  statementIndex?: Map<Statement, number>;

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

  /**
   * Rank-bearing definitions PUBLISHED into this frame rather than authored
   * directly in its body: definitions reached while walking selected `$if` arms
   * in this activation, and definitions an `@import` folded in.
   * {@link frameCandidatesInOrder} merges them into the authored candidate list
   * BY RANK, so a published definition dispatches at its source position instead
   * of after every authored one.
   */
  publishedMixinEvents?: Map<string, OrderedMixinCandidate[]>;

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
   * [lookup-memo] Render-scoped memo of member-lookup `DeclMap`s built for a PURE
   * base resolved in THIS frame, keyed by the base value node identity. A repeated
   * `BASE[member]` on the same binding rebuilt the index (or re-dispatched) per
   * access; caching it on the resolving frame makes repeated reads O(1). Plain
   * `Map` (not a WeakMap): the frame owns the lifetime and disposes it with the
   * render; a node-keyed WeakMap would pin DeclMaps for the AST's whole cross-render
   * lifetime. Assigned lazily only on a frame that performs a lookup, and populated
   * ONLY for the pure builders (collection / namespace-selector / detached-ruleset
   * body) — never a mixin-call dispatch (which mutates the caller frame) nor while an
   * alias cycle is being resolved (`e.excluded` non-empty). See
   * `docs/design/MIXIN-SCOPING-AND-LOOKUP-MEMO.md` §4.
   */
  declMapMemo?: Map<object, DeclMap> | null;

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

  /** Functions imported by `@-use` / `@-from`, keyed by their explicit
   * reference path. They are deliberately separate from `fns`: importing a
   * module must never change the meaning of a CSS-shaped `name(...)` call. */
  moduleFns?: Map<string, Fn>;

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

  /** Per-activation lexical owners for values carried by parameter declarations. */
  bindingValueFrames?: Map<Binding, Frame>;

  /** Typed URL-bearing values for eager byte snapshots owned by this activation. */
  mixinUrlBindings?: Map<Binding, ValueGroup>;

  /** Non-URL structural values for function/plugin snapshots owned by this activation. */
  mixinValueBindings?: Map<Binding, ValueGroup>;

  /** Opaque Context source identity that authored this activation's body. */
  sourceOwner?: object | null;
}

function sourceOwnerForBody(rules: object, frame: Frame, e: EvalCtx): object | null {
  return e.context?.sourceOwnerForBody?.(rules) ?? frame.sourceOwner ?? null;
}

function withSourceOwner<T>(e: EvalCtx, owner: object | null | undefined, run: () => T): T;
function withSourceOwner<T>(e: EvalCtx, owner: object | null | undefined, run: () => Promise<T>): Promise<T>;
function withSourceOwner<T>(e: EvalCtx, owner: object | null | undefined, run: () => T | Promise<T>): T | Promise<T>;
function withSourceOwner<T>(e: EvalCtx, owner: object | null | undefined, run: () => T | Promise<T>): T | Promise<T> {
  const context = e.context;
  if (!context?.withSourceOwner) {
    return run();
  }

  /* The overwhelmingly common case needs no Context option recomputation. */
  if (owner === context.documentContext) {
    return run();
  }

  /* Context owns resolver/plugin identity; the same document identity now
   * restores its parser-owned trivia for output deferred beyond expansion. */
  if (!(owner instanceof DocumentContext)) {
    return context.withSourceOwner(owner, run);
  }
  const trivia = documentTriviaOf(owner);
  if (trivia === e.trivia) {
    return context.withSourceOwner(owner, run);
  }
  return withTrivia(e, trivia, () => context.withSourceOwner(owner, run));
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

function isModuleFn(value: unknown): value is Fn {
  return typeof value === 'function'
    && 'params' in value
    && Array.isArray(value.params);
}

type ModuleCallable = (...args: unknown[]) => unknown;

function isModuleCallable(value: unknown): value is ModuleCallable {
  return typeof value === 'function';
}

function moduleFunctionResult(value: unknown, name: string): ValueGroup {
  if (isValueGroup(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return makeDimension(value);
  }
  if (typeof value === 'string') {
    // A JS module function's plain string never passed through a parser; its text is its only fact.
    return sniffLiteral(value);
  }
  if (typeof value === 'boolean') {
    return makeBool(value);
  }
  if (value === null || value === undefined) {
    return NULL;
  }
  throw new TypeError(`Module function "${name}" returned an unsupported value.`);
}

function bindModuleFunction(value: ModuleCallable | Fn, name: string): Fn {
  if (isModuleFn(value)) {
    return defineFunction(name, {
      params: value.params,
      variadic: true,
      body: (args, context) => value(args, context)
    });
  }
  return defineFunction(name, {
    params: [],
    variadic: true,
    body: args => mapMaybe(
      value(...groupItems(args)),
      result => moduleFunctionResult(result, name)
    )
  });
}

function moduleAstValue(value: unknown, name: string, seen: Set<object> | null = null): ValueSlot {
  if (value === null) {
    return NULL_NODE;
  }
  if (typeof value === 'string') {
    return keyword(value);
  }
  if (typeof value === 'number') {
    return dimension(value);
  }
  if (typeof value === 'boolean') {
    return keyword(value ? 'true' : 'false');
  }
  if (typeof value === 'object') {
    if (seen?.has(value)) {
      throw new TypeError(`Module export "${name}" is cyclic.`);
    }
    seen ??= new Set();
    seen.add(value);
    if (Array.isArray(value)) {
      const result = list(value.map((item, index) => moduleAstValue(item, `${name}[${index}]`, seen)));
      seen.delete(value);
      return result;
    }
    const entries = Object.entries(value).map(([key, member]) =>
      collectionEntry(keyword(key), moduleAstValue(member, `${name}.${key}`, seen))
    );
    seen.delete(value);
    return collection(entries);
  }
  throw new TypeError(`Module export "${name}" is not a supported stylesheet value.`);
}

function addModuleFunction(frame: Frame, fn: Fn, e: EvalCtx): void {
  (frame.moduleFns ??= new Map()).set(fn.name.toLowerCase(), fn);
  if (e.context?.sourceContext?.plugin?.supportedExtensions?.includes('.scss') === true) {
    addScopedFns(frame, [fn], e);
    (e.moduleFns ??= new Set()).add(fn);
  }
}

function lookupModuleFunction(frame: Frame | null, lowerName: string): Fn | undefined {
  for (let current = frame; current; current = current.parent) {
    const fn = current.moduleFns?.get(lowerName);
    if (fn !== undefined) {
      return fn;
    }
  }
  return undefined;
}

function bindModuleValue(frame: Frame, name: string, value: unknown, e: EvalCtx): ValueSlot {
  const binding = moduleAstValue(value, name);
  const declaration = variableDeclaration(name, binding, { mode: 'declare' });
  publishImportedVariableDeclaration(frame, declaration);
  activateVariableDeclaration(declaration, frame, e);
  return binding;
}

function bindModuleCallable(
  frame: Frame,
  name: string,
  value: ModuleCallable | Fn,
  e: EvalCtx
): void {
  const fn = bindModuleFunction(value, name);
  addModuleFunction(frame, fn, e);

  /*
   * A callable import is also a real lexical `$name` binding, so ordinary
   * shadowing decides whether `$name(...)` still reaches this function. The
   * value is an inert marker whose identity is meaningful only to the sparse
   * render-local module-reference map.
   */
  const marker = keyword(`$${name}`);
  const declaration = variableDeclaration(name, marker, { mode: 'declare' });
  publishImportedVariableDeclaration(frame, declaration);
  activateVariableDeclaration(declaration, frame, e);
  (e.moduleReferenceValues ??= new Map()).set(marker, name.toLowerCase());
}

function requireModuleExport(module: Readonly<Record<string, unknown>>, name: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(module, name)) {
    throw new TypeError(`Module has no export named "${name}".`);
  }
  return module[name];
}

function bindModuleNamespace(
  module: Readonly<Record<string, unknown>>,
  namespace: string,
  frame: Frame,
  e: EvalCtx
): void {
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(module)) {
    if (isModuleCallable(value)) {
      addModuleFunction(frame, bindModuleFunction(value, `${namespace}.${name}`), e);
    } else {
      values[name] = value;
    }
  }
  const binding = bindModuleValue(frame, namespace, values, e);
  if (!isValueSlotArray(binding)) {
    (e.moduleReferenceValues ??= new Map()).set(binding, null);
  }
}

function bindModuleImport(
  node: ModuleImport,
  module: Readonly<Record<string, unknown>>,
  frame: Frame,
  e: EvalCtx
): void {
  if (node.mode === 'use') {
    const namespace = node.namespace ?? deriveModuleNamespace(node.path.value);
    if (namespace === null) {
      throw new TypeError(`@-use "${node.path.value}" cannot derive a namespace; add an explicit "as <name>".`);
    }
    if (namespace === '*') {
      for (const [name, value] of Object.entries(module)) {
        if (isModuleCallable(value)) {
          bindModuleCallable(frame, name, value, e);
        } else {
          bindModuleValue(frame, name, value, e);
        }
      }
      return;
    }
    bindModuleNamespace(module, namespace, frame, e);
    return;
  }

  if (node.namespace !== null) {
    bindModuleNamespace(module, node.namespace, frame, e);
  }
  if (node.defaultImport !== null) {
    const value = requireModuleExport(module, 'default');
    if (isModuleCallable(value)) {
      bindModuleCallable(frame, node.defaultImport, value, e);
    } else {
      bindModuleValue(frame, node.defaultImport, value, e);
    }
  }
  for (const specifier of node.imports) {
    const value = requireModuleExport(module, specifier.name);
    const localName = specifier.alias ?? specifier.name;
    if (isModuleCallable(value)) {
      bindModuleCallable(frame, localName, value, e);
    } else {
      bindModuleValue(frame, localName, value, e);
    }
  }
}

/**
 * Activate module bindings and plugin dependencies in one scan of exactly one lexical
 * body before evaluating it. This deliberately scans only direct statements
 * (historic Less evaluates dependencies before the rest of that same Ruleset),
 * never descends, and never recovers source syntax.
 */
function activateBodyDependencies(
  statements: readonly Statement[],
  frame: Frame,
  e: EvalCtx,
  bindModules = true
): MaybePromise<void> {
  const context = e.context;
  const load = e.pluginHost?.loadPlugin;
  const plannedModules = bindModules ? e.plannedModuleImports : null;
  const hasPendingPlannedModule = bindModules
    && e.pendingPlannedModuleImports !== undefined
    && e.pendingPlannedModuleImports > 0;
  const mayLoadUnplannedModule = bindModules
    && !e.preparedImportsOwnedByCaller
    && context !== undefined;
  if (!hasPendingPlannedModule && !mayLoadUnplannedModule && !load) {
    return;
  }
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const statement = statements[index]!;
      if (statement.type === 'ModuleImport') {
        if (!bindModules) {
          continue;
        }
        const prepared = plannedModules?.get(statement);
        if (prepared !== undefined) {
          bindModuleImport(statement, prepared, frame, e);
          if (e.preparedImportsOwnedByCaller) {
            e.pendingPlannedModuleImports!--;
          }
          continue;
        }
        if (!mayLoadUnplannedModule) {
          continue;
        }
        return context.getModule(statement.path.value).catch(moduleLoadFailed(statement, e)).then(({ module }) => {
          plannedModules?.set(statement, module);
          bindModuleImport(statement, module, frame, e);
          return run(index + 1);
        });
      }
      if (statement.type !== 'Plugin') {
        continue;
      }
      if (!load) {
        continue;
      }
      const targetString = statement.target.type === 'Url' ? statement.target.value : statement.target;
      const specifier = targetString.type === 'Quoted'
        ? quotedContentSync(targetString, frame, e)
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
          ? error.attributeTo(callSiteLocation(statement, e))
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
  params: Map<string, Binding> | null = null,
  cells: ReadonlyMap<string, BindingCell> | null = null
): DeclIndex | null {
  const byName = new Map<string, VariableDeclaration[]>();
  if (params) {
    for (const [name, value] of params) {
      const stack = byName.get(name);
      const declaration = cells?.get(name)?.declaration
        ?? variableDeclaration(name, value, { mode: 'declare' });
      if (stack) {
        stack.push(declaration);
      } else {
        byName.set(name, [declaration]);
      }
    }
  }
  let controlFlow = false;
  for (const s of statements) {
    if (s.type === 'VariableDeclaration') {
      const stack = byName.get(s.name);
      if (stack) {
        stack.push(s);
      } else {
        byName.set(s.name, [s]);
      }
    } else if (s.type === 'If' || s.type === 'While') {
      controlFlow = true;
    }
  }
  return byName.size === 0 && !controlFlow ? null : { byName, controlFlow };
}

/**
 * Augment this frame's ordinary declaration index with the control-flow bodies
 * selected by this activation. The ordinary stacks are already in source-fold
 * order — parameter cells first, then authored declarations with each imported
 * fact spliced at its `@import` (N10) — so a body's declarations are spliced into
 * that order at the position of the `$if`/`$while` that holds them, never
 * appended after a prefix of everything that is not a direct statement.
 */
function collectSelectedDeclIndex(frame: Frame, selected: ReadonlyMap<If, Statement[]>): DeclIndex | null {
  const byName = new Map<string, VariableDeclaration[]>();
  if (frame.declIndex) {
    for (const [name, stack] of frame.declIndex.byName) {
      byName.set(name, stack.slice());
    }
  }
  const statements = frame.statements ?? [];

  /*
   * The authored position of an entry already in a stack, or `-1` when it has
   * none to compare: a parameter cell, an unranked import, or a declaration this
   * pass spliced in from an EARLIER control block. Each of those sits at or
   * before the block being placed, so it stops the backward walk.
   */
  const positionOf = (declaration: VariableDeclaration): number => {
    const rank = frame.factRanks?.get(declaration);
    return rank === undefined ? frameStatementIndex(frame).get(declaration) ?? -1 : factSite(rank);
  };
  const place = (declaration: VariableDeclaration, at: number): void => {
    const stack = byName.get(declaration.name);
    if (!stack) {
      byName.set(declaration.name, [declaration]);
      return;
    }
    let slot = stack.length;
    while (slot > 0 && positionOf(stack[slot - 1]!) > at) {
      slot--;
    }
    stack.splice(slot, 0, declaration);
  };
  const visit = (rules: Statement[], at: number): void => {
    for (const statement of rules) {
      if (statement.type === 'VariableDeclaration') {
        place(statement, at);
      } else if (statement.type === 'If') {
        const branch = selected.get(statement);
        if (branch) {
          visit(branch, at);
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
        visit(statement.rules, at);
      }
    }
  };
  for (let at = 0; at < statements.length; at++) {
    const statement = statements[at]!;
    if (statement.type === 'If') {
      const branch = selected.get(statement);
      if (branch) {
        visit(branch, at);
      }
    } else if (statement.type === 'While') {
      visit(statement.rules, at);
    }
  }
  return byName.size === 0 ? null : { byName, controlFlow: true };
}

/** Seed one activation's live cells from mixin/function parameters.
 * A call-valued argument keeps its caller on the existing `valueFrame` slot;
 * constructing the complete cell here avoids a later hidden-class transition. */
function cellsForParams(
  params: Map<string, Binding> | null,
  valueFrames?: ReadonlyMap<Binding, Frame>,
  mixinCallFrame?: Frame,
  forBinding?: For['binding'],
  collectionEntry?: ValueCollectionEntry,
  destructured: readonly ValueGroup[] | null = null,
  evaluatedItem: ValueGroup | null = null
): Map<string, BindingCell> | null {
  if (!params) {
    return null;
  }
  const cells = new Map<string, BindingCell>();
  let parameterIndex = 0;
  for (const [name, value] of params) {
    const declaration = variableDeclaration(name, value, { mode: 'declare' });
    const valueFrame = valueFrames?.get(value)
      ?? (!isValueSlotArray(value) && value.type === 'MixinCall' ? mixinCallFrame : undefined);
    let evaluated: ValueGroup | null = null;
    if (forBinding !== undefined && (collectionEntry !== undefined || evaluatedItem !== null)) {
      if (forBinding.kind === 'single') {
        evaluated = collectionEntry?.value ?? evaluatedItem;
      } else if (forBinding.kind === 'comma') {
        evaluated = parameterIndex === 0
          ? collectionEntry?.value ?? evaluatedItem
          : parameterIndex === 1 ? collectionEntry?.key ?? null : null;
      } else if (forBinding.kind === 'bracket') {
        evaluated = parameterIndex === 0
          ? collectionEntry?.key ?? null
          : collectionEntry?.value ?? evaluatedItem;
      } else {
        evaluated = destructured?.[parameterIndex] ?? null;
      }
    }
    cells.set(name, {
      declaration,
      value,
      valueFrame: valueFrame ?? null,
      evaluated,
      prev: null
    });
    parameterIndex += 1;
  }
  return cells;
}

/*
 * collect the rulesets defined directly in a scope, keyed by own-local
 * selector string (namespace-path descent). Built lazily on first path lookup.
 */
function collectRulesets(statements: readonly Statement[]): Map<string, Ruleset[]> | null {
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

/**
 * [import-fold] One frame's published import facts merged with its authored
 * statements in source-fold order, for the one reader that needs an ARRAY
 * ({@link collectRulesets} consumes a statement list, and did already before ranks
 * existed). `published` is kept site-ascending by {@link insertRankedFact} and
 * `statements` is index-ordered, so two cursors merge them in
 * O(published + statements) INTEGER comparisons — no sort, no comparator closure,
 * and no Map on the path. Its only caller memoizes it in {@link Frame.rulesets},
 * which the next publication drops: it runs once per publication EPOCH, not once,
 * so linear is the requirement, not a nicety.
 */
function factsInSourceOrder(
  published: readonly Statement[] | null | undefined,
  sites: readonly number[] | null | undefined,
  statements: readonly Statement[]
): readonly Statement[] {
  if (!published?.length || !sites) {
    return statements;
  }
  const merged: Statement[] = [];
  let next = 0;
  for (let index = 0; index < statements.length; index++) {
    while (next < published.length && sites[next]! < index) {
      merged.push(published[next]!);
      next++;
    }
    merged.push(statements[index]!);
  }
  for (; next < published.length; next++) {
    merged.push(published[next]!);
  }
  return merged;
}

function frameRulesets(frame: Frame): Map<string, Ruleset[]> | null {
  if (frame.rulesets !== undefined) {
    return frame.rulesets;
  }
  const built = collectRulesets(
    factsInSourceOrder(frame.importedRules, frame.importedRuleSites, frame.statements ?? [])
  );
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
  const add = (name: string, definition: MixinDefinition, rank: SourceRank): void => {
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
        type: 'MixinDefinition', name: key, params: [], rules: rule.rules,
        extendInstructions: rule.extendInstructions, ruleMixin: true,
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

function compareSourceRanks(a: SourceRank, b: SourceRank): number {
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
  const visit = (rules: Statement[], rank: SourceRank, selectedPath: readonly SelectedMixinPath[]): void => {
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
  if (frame.publishedMixinEvents?.get(definition.name)?.some(c => c.definition === definition)) {
    return;
  }
  publishRankedMixinEvent(frame, definition, meta.rank);
}

/** File one published definition in this frame's rank-ordered event list. */
function publishRankedMixinEvent(frame: Frame, definition: MixinDefinition, rank: SourceRank): void {
  const events = frame.publishedMixinEvents ??= new Map<string, OrderedMixinCandidate[]>();
  const candidate = { definition, rank };
  const list = events.get(definition.name);
  if (!list) {
    events.set(definition.name, [candidate]);
    return;
  }
  let index = list.length;
  while (index > 0 && compareSourceRanks(candidate.rank, list[index - 1]!.rank) < 0) {
    index--;
  }
  list.splice(index, 0, candidate);
}

/**
 * [import-fold] Authored position of each top-level statement. Built ONCE per
 * frame and ONLY for the callers that hold a statement but no cursor for it;
 * every ordered merge steps a cursor and never comes here.
 */
function frameStatementIndex(frame: Frame): Map<Statement, number> {
  const existing = frame.statementIndex;
  if (existing) {
    return existing;
  }
  const positions = new Map<Statement, number>();
  const statements = frame.statements;
  if (statements) {
    for (let index = 0; index < statements.length; index++) {
      positions.set(statements[index]!, index);
    }
  }
  return (frame.statementIndex = positions);
}

/**
 * [import-fold] The source-fold position of one `@import` that reached publication
 * WITHOUT its statement index in hand — the render-time path, which is entered
 * only for an import static planning did not already publish. Resolved from
 * {@link frameStatementIndex}, so repeated imports in one frame share a single
 * O(statements) pass instead of each scanning the body.
 *
 * `null` when the statement is not a direct member of this frame's body. The
 * reachable case is ledger **A10**'s owner-authorised desugar (`@import "lib"
 * screen;` becomes an `@media` block wrapping the import), which plan-time walks
 * with the SAME scope; those facts keep publication order, exactly as they did
 * before ranks existed.
 */
function importSiteRank(frame: Frame, node: Statement): SourceRank | null {
  const at = frameStatementIndex(frame).get(node);
  return at === undefined ? null : [at];
}

/** [import-fold] The rank one imported fact takes in the importing frame: the
 *  `@import`'s own position extended by the fact's index in the imported
 *  document. `null` when the import site is unknown, which keeps the fact's
 *  historical publication order. Pure — the callers that must remember a rank
 *  store it themselves. */
function importedFactRank(site: SourceRank | null, index: number): SourceRank | null {
  return site === null ? null : [...site, index];
}

/** [import-fold] The site of a rank — the statement index of the `@import` that
 *  folded the fact in — or {@link UNRANKED_SITE}. */
function factSite(rank: SourceRank | null): number {
  return rank?.[0] ?? UNRANKED_SITE;
}

/**
 * [import-fold] Add one published fact to a SITE-ASCENDING list and record its
 * site in the parallel int array, so both ordered merges can two-cursor integers
 * instead of sorting or consulting a map. Publication normally runs in ascending
 * order (imports execute in source order, and one import's facts publish in
 * document order), which costs one integer comparison and a push; the backward walk
 * exists for the out-of-order cases — a deferred import retried after the body
 * walk, and an unranked fact, which belongs in the leading publication-order
 * prefix. Facts sharing a site keep publication order, which is their order in the
 * imported document. Publication-time work: no lookup reaches this.
 */
function insertRankedFact<T extends Statement>(list: T[], sites: number[], fact: T, site: number): void {
  let at = list.length;
  while (at > 0 && site < sites[at - 1]!) {
    at--;
  }
  if (at === list.length) {
    list.push(fact);
    sites.push(site);
    return;
  }
  list.splice(at, 0, fact);
  sites.splice(at, 0, site);
}

/** Publish an imported definition into the importing frame's existing lookup
 * map. Static planning exposes document-root facts before output evaluation;
 * lexical import execution still owns the imported document's body and CSS.
 * `rank` files it at its `@import`'s source position for dispatch ordering. */
function publishImportedMixinDefinition(
  frame: Frame,
  definition: MixinDefinition,
  recordCallable = true,
  rank: SourceRank | null = null
): void {
  const mixins = frame.mixins ??= new Map();
  const candidates = mixins.get(definition.name);
  if (candidates) {
    candidates.push(definition);
  } else {
    mixins.set(definition.name, [definition]);
  }
  if (recordCallable) {
    insertRankedFact(
      frame.importedCallables ??= [],
      frame.importedCallableSites ??= [],
      definition,
      factSite(rank)
    );
  }

  /*
   * `frameCandidatesInOrder` merges ranked events into the authored candidate
   * list and then appends only the `mixins` entries it has not already placed,
   * so this is a POSITION for the same definition, never a second candidate.
   */
  if (rank !== null && !frame.publishedMixinEvents?.get(definition.name)?.some(c => c.definition === definition)) {
    publishRankedMixinEvent(frame, definition, rank);
  }
}

/** Publish an imported declaration into the current frame's existing scoped
 * index. `rank` splices it at its `@import`'s source position, so a later local
 * declaration of the same name still wins the backward scoped read.
 *
 * KNOWN LIMIT, `(multiple)` only: {@link Frame.factRanks} is keyed by the
 * declaration NODE, so importing one document `(multiple)` times into the same
 * frame leaves every occurrence remembered at the LAST site. Each occurrence is
 * still spliced at its own correct position when it is published, and occurrences
 * of one document keep their relative order, so this is observable only when a
 * `(multiple)`-imported NAME collides with a local declaration written BETWEEN two
 * of those imports. Both directions were already wrong before ranks existed. A
 * per-occurrence fix needs a rank slot per stack entry (the site-array shape the
 * ordered merges use), which is a wider change than this one. */
function publishImportedVariableDeclaration(
  frame: Frame,
  declaration: VariableDeclaration,
  rank: SourceRank | null = null
): void {
  const index = frame.declIndex ??= { byName: new Map(), controlFlow: false };
  const declarations = index.byName.get(declaration.name);

  /* A stack's first entry needs a rank only to be placed against a `$if`/`$while` body. */
  if (rank !== null && (declarations !== undefined || index.controlFlow)) {
    (frame.factRanks ??= new Map()).set(declaration, rank);
  }
  if (!declarations) {
    index.byName.set(declaration.name, [declaration]);
  } else if (rank === null) {
    declarations.push(declaration);
  } else {
    /*
     * The stack is already rank-sorted (authored declarations in source order,
     * earlier imports spliced at their own positions), so one backward walk finds
     * the slot. An entry with no position at all is a parameter cell, which stops
     * the walk: it belongs ahead of every body fact.
     */
    let at = declarations.length;
    while (at > 0) {
      const previous = declarations[at - 1]!;
      const publishedRank = frame.factRanks?.get(previous);
      if (publishedRank !== undefined) {
        if (compareSourceRanks(rank, publishedRank) >= 0) {
          break;
        }
      } else {
        const authoredAt = frameStatementIndex(frame).get(previous);
        if (authoredAt === undefined || compareSourceRankToIndex(rank, authoredAt) >= 0) {
          break;
        }
      }
      at--;
    }
    declarations.splice(at, 0, declaration);
  }

  /*
   * A frame that has already selected its control-flow bodies reads the stacks
   * rebuilt around them, so the new fact must join those too. They are rebuilt
   * once, at the next scoped read ({@link selectControlFlow}), never once per
   * published fact: an `@import` publishes a whole document. Only a frame with
   * a direct `$if`/`if()`/`$while` ever has a selection.
   */
  if (frame.selectedDeclIndex !== undefined) {
    frame.selectedDeclIndex = undefined;
  }
}

/** Publish an imported root ruleset for namespace-path descent. `rank` places it
 * among the importing document's own facts: its SITE is recorded per list entry, so
 * one document imported `(multiple)` times contributes one correctly-placed entry
 * per occurrence. */
function publishImportedRuleset(frame: Frame, rule: Ruleset, rank: SourceRank | null = null): void {
  const site = factSite(rank);
  insertRankedFact(frame.importedRules ??= [], frame.importedRuleSites ??= [], rule, site);
  insertRankedFact(frame.importedCallables ??= [], frame.importedCallableSites ??= [], rule, site);

  /*
   * It may have been materialized before this import; rebuild lazily with the
   * newly published fact in source-fold position on the next namespace lookup.
   * Namespace descent needs no such invalidation: it two-cursors the published
   * list live.
   */
  frame.rulesets = undefined;
}

type PrepublishedImportFacts = Statement | Set<Statement> | null;

function hasPrepublishedImportFact(e: Emit, statement: Statement): boolean {
  const facts = e.prepublishedImportFacts;
  return facts === statement || (facts instanceof Set && facts.has(statement));
}

/** Claim one render-local import fact without allocating a collection until a
 * second distinct fact exists. Canonical statement identity makes repeated
 * `(multiple)` document occurrences publish definitions once while their bodies
 * and CSS still execute at every authored splice. */
function claimPrepublishedImportFact(e: Emit, statement: Statement): boolean {
  const facts = e.prepublishedImportFacts;
  if (facts === statement || (facts instanceof Set && facts.has(statement))) {
    return false;
  }
  if (facts === null) {
    e.prepublishedImportFacts = statement;
  } else if (facts instanceof Set) {
    facts.add(statement);
  } else {
    const set = new Set<Statement>();
    set.add(facts);
    set.add(statement);
    e.prepublishedImportFacts = set;
  }
  return true;
}

/** Claim one `@import` whose facts the planner publishes into a `@compose` module's activation. */
function claimModulePrepublishedImport(e: Emit, activation: Frame, statement: StyleImport): boolean {
  const byFrame = e.prepublishedModuleImports ??= new Map();
  const claimed = byFrame.get(activation);
  if (claimed === undefined) {
    byFrame.set(activation, new Set([statement]));
    return true;
  }
  if (claimed.has(statement)) {
    return false;
  }
  claimed.add(statement);
  return true;
}

/** Publish one imported document's direct lookup facts without executing or
 * copying its body. Static planning and lexical emission share this owner so a
 * definition is never classified through two different paths.
 *
 * `site` is the `@import`'s own {@link SourceRank} in `frame`. Every fact is
 * filed at `site` + its index in the imported document, which is what makes
 * `@import` a SOURCE FOLD rather than an append: a local fact written after the
 * `@import` outranks the imported one, and one written before it does not. */
function publishImportedDocumentFacts(
  statements: readonly Statement[],
  frame: Frame,
  e: Emit,
  prepublish = false,
  site: SourceRank | null = null,
  from = 0
): MaybePromise<void> {
  for (let index = from; index < statements.length; index++) {
    const child = statements[index]!;
    if (child.type === 'MixinDefinition') {
      if (prepublish && !claimPrepublishedImportFact(e, child)) {
        continue;
      }
      publishImportedMixinDefinition(frame, child, true, importedFactRank(site, index));
      continue;
    }
    if (child.type === 'VariableDeclaration') {
      if (prepublish && !claimPrepublishedImportFact(e, child)) {
        continue;
      }
      publishImportedVariableDeclaration(frame, child, importedFactRank(site, index));
      continue;
    }
    if (child.type !== 'Ruleset') {
      continue;
    }
    if (prepublish && !claimPrepublishedImportFact(e, child)) {
      continue;
    }
    const rank = importedFactRank(site, index);
    publishImportedRuleset(frame, child, rank);

    /* A plain imported ruleset is also a zero-argument Less mixin. Its
     * canonical Ruleset remains the namespace fact; publish only its
     * synthesized callable fact for bare `.name()` lookup. */
    const built = orderedMixinsForStatements([child], frame, e);
    if (isThenable(built)) {
      const next = index + 1;
      return built.then((mixins) => {
        publishImportedRuleMixins(frame, mixins, rank);
        return publishImportedDocumentFacts(statements, frame, e, prepublish, site, next);
      });
    }
    publishImportedRuleMixins(frame, built, rank);
  }
}

/** The zero-argument callables synthesized for ONE imported ruleset, published at
 *  that ruleset's own source-fold position. The Ruleset itself is already the
 *  namespace fact, so these are not recorded as callables a second time. */
function publishImportedRuleMixins(frame: Frame, index: OrderedMixinIndex | null, rank: SourceRank | null): void {
  if (!index) {
    return;
  }
  for (const candidates of index.byName.values()) {
    for (const candidate of candidates) {
      publishImportedMixinDefinition(frame, candidate.definition, false, rank);
    }
  }
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
 * interleaved parametric-def/ruleset-mixin list, merged BY RANK with the defs
 * published into this frame (`$if`-selected arms, `@import` folds), then any
 * remaining `mixins` entry that carries no rank (detached-ruleset scope unlocking
 * via `@rs()`, which pushes into `mixins` without touching `statements`)
 * appended. The merge is why a rank is assigned at PUBLICATION time: this runs on
 * every dispatch and may not compute one.
 */
function frameCandidatesInOrder(f: Frame, name: string, e: EvalCtx): MixinDefinition[] {
  const mapDefs = f.mixins?.get(name);
  if (!f.statements) {
    return mapDefs?.slice() ?? [];
  }
  const base = frameOrderedMixins(f, e)?.byName.get(name) ?? [];
  const events = f.publishedMixinEvents?.get(name) ?? [];
  const out: MixinDefinition[] = [];
  let baseIndex = 0;
  let eventIndex = 0;
  while (baseIndex < base.length || eventIndex < events.length) {
    const direct = base[baseIndex];
    const selected = events[eventIndex];
    if (!selected || (direct !== undefined && compareSourceRanks(direct.rank, selected.rank) <= 0)) {
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

  /* Append the rest: a def in `mixins` that neither `statements` authored nor a
   * ranked event placed. An imported def is already positioned above. */
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
 * bare name (`:is` → `is`), then its non-selector argument's leaves (an `An+B`,
 * each `:lang()` range, a `:dir()` direction), then the atoms of each argument
 * branch, which is what its inline spelling used to yield; an opaque token
 * contributes its retained leaf `text`. An interp-only token (`text: null`)
 * contributes nothing, matching `simpleTokenText`'s `''`.
 */
function pushTokenAtoms(sim: SimpleToken, out: string[]): void {
  if (sim.type === 'PseudoSelector' && (sim.args !== null || sim.arg !== null)) {
    pushLeafAtoms(sim.name, out);
    if (sim.arg !== null) {
      pushArgumentAtoms(sim.arg, out);
    }
    if (sim.args !== null) {
      for (const branch of sim.args.selectors) {
        pushBranchAtoms(branch, out);
      }
    }
    return;
  }
  if (sim.text !== null) {
    pushLeafAtoms(sim.text, out);
  }
}

/** [mixin-match] [C2] A non-selector pseudo argument's atoms, from its parsed leaves. */
function pushArgumentAtoms(arg: PseudoArgument, out: string[]): void {
  if (arg.type !== 'List') {
    pushLeafAtoms(arg.src, out);
    return;
  }
  for (const range of arg.value) {
    if (isLanguageRange(range)) {
      pushLeafAtoms(range.src, out);
    }
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
 *
 * [mixin-interp-fuse] A compound term's adjacent plain tokens are ONE element
 * leaf whose boundary interpolation moves: `.generated-@{name}` parses as a
 * literal token `.generated-` FUSED with an interp token `@{name}`, and the
 * resolved element is the single atom `.generated-first` — not `.generated-`
 * followed by `first`. So the plain (non-pseudo) tokens of a term are joined
 * into one string and atomized ONCE; `pushLeafAtoms`' own split still re-derives
 * the internal atom boundaries of a genuine multi-class compound (`.a.b`). A
 * structured pseudo is its own atom boundary: it flushes the pending leaf, then
 * contributes its name + argument atoms.
 */
function resolvedBranchAtoms(c: SelectorBranch, frame: Frame | null, e: EvalCtx): string[] {
  const out: string[] = [];
  for (const term of selectorBranchTerms(c)) {
    let pending = '';
    for (const sim of termTokens(term)) {
      if (sim.type === 'PseudoSelector') {
        if (pending !== '') {
          pushLeafAtoms(pending, out);
          pending = '';
        }
        pushResolvedTokenAtoms(sim, frame, e, out);
        continue;
      }
      if (sim.interp !== null) {
        pending += resolveSimpleTextSync(sim, frame, e);
      } else if (sim.text !== null) {
        pending += sim.text;
      }
    }
    if (pending !== '') {
      pushLeafAtoms(pending, out);
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
    if (sim.arg !== null) {
      pushArgumentAtoms(sim.arg, out);
    }
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
        const namespaceCall = mixinCall(s.name);
        const selected = settledDispatch(
          dispatch([s], namespaceCall, scope, e),
          namespaceCall,
          e
        );
        if (selected.length === 0) {
          return;
        }
        for (const selection of selected) {
          /*
           * Namespace descent uses dispatch only as an admission test; it does
           * not execute the selected activation. Release any typed snapshots
           * that dispatch transferred for that otherwise-unowned binding map.
           */
          discardSelectedBoundSources(selection.boundSourceKeys, e);
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
            params: [], rules: s.rules, extendInstructions: s.extendInstructions, ruleMixin: true,
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
   * Imported root rules are lexical splices in this scope. They must take part in
   * element-value namespace descent just like authored rules, AT the position of
   * the `@import` that folded them in — an imported `#ns` precedes a local `#ns`
   * only when its `@import` was written first.
   *
   * This is a LOOKUP path, so it allocates nothing, caches nothing, and reads no
   * map: both inputs are already ordered (`importedCallables` site-ascending by
   * construction, `statements` by index), so two cursors visit them in source-fold
   * order in O(published + statements) INTEGER comparisons. An import-free scope
   * takes the same single `for` loop over `statements` it always did. A cache here
   * would be worse than useless — every import publication invalidates it, so it
   * would re-merge once per publication epoch while this pays the same linear walk
   * it already owed for visiting the facts.
   */
  const published = scope.importedCallables ?? scope.importedRules;
  const sites = scope.importedCallables ? scope.importedCallableSites : scope.importedRuleSites;
  if (!published?.length || !sites) {
    for (const s of st ?? []) {
      visit(s);
    }
  } else {
    const total = st?.length ?? 0;
    let next = 0;
    for (let index = 0; index < total; index++) {
      while (next < published.length && sites[next]! < index) {
        visit(published[next]!);
        next++;
      }
      visit(st![index]!);
    }
    for (; next < published.length; next++) {
      visit(published[next]!);
    }
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
 * and uses the first that `find`s the selector). A one-key-per-segment descent
 * could not match a compound def (`.jo.ki()`), an `&`-nested step (`.amp.support()`), or a
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

/*
 * [R16] The `&& (e === undefined || e.allowCallerScope || f.callerFallback !== true)`
 * guard on each `fallback` capture below is the hermetic caller-read gate: a plain
 * VARIABLE read skips a frame whose `fallback` is the ambient call site (a
 * `callerFallback` frame — mixin body / detached ruleset / value-lambda / dispatch
 * overlay) unless `allowCallerScope` restores the legacy Less dynamic caller-read.
 * Reads WITHOUT an `EvalCtx` (the `lookupVar`/path/chain walks) keep traversing, so
 * `parentExcludes`, member access, and namespace descent are untouched. It is one
 * boolean sub-expression — no cost on the default path beyond that field read.
 */

/**
 * The nearest last-wins binding for `name` (top of the nearest non-empty stack).
 * Used by the value-block / namespace paths that need the CURRENT value node
 * (e.g. to test for an `AnonymousMixin` / `Collection`); it does not honor exclusion
 * because those callers resolve a name to a concrete ruleset binding, not a lazy
 * self-referential value. The regular value read uses `resolveVarRef` instead.
 */
function lookupLiveCell(frame: Frame | null, name: string, e?: EvalCtx): BindingHit | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    /* Newest binding first, then the ones it shadowed — the live-store twin of
     * `lookupScopedBinding`'s backward walk over the per-name declaration stack. */
    for (let hit: BindingCell | null | undefined = f.cells?.get(name); hit; hit = hit.prev) {
      if (!e?.excluded.has(hit.value)) {
        return { value: hit.value, frame: hit.valueFrame ?? f, evaluated: hit.evaluated };
      }
    }
    if (f.fallback && !fb && (e === undefined || e.allowCallerScope || f.callerFallback !== true)) {
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
    if (f.fallback && !fb && (e === undefined || e.allowCallerScope || f.callerFallback !== true)) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedLiveCell(fb, name, e) : false;
}

function lookupLeakedBinding(frame: Frame | null, name: string, e?: EvalCtx): BindingHit | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const stack = f.leaked?.get(name);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const value = stack[i]!;
        if (!e?.excluded.has(value)) {
          return { value, frame: f, evaluated: null };
        }
      }
    }
    if (f.fallback && !fb && (e === undefined || e.allowCallerScope || f.callerFallback !== true)) {
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
    if (f.fallback && !fb && (e === undefined || e.allowCallerScope || f.callerFallback !== true)) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedLeakedBinding(fb, name, e) : false;
}

function lookupScopedBinding(frame: Frame | null, name: string, e?: EvalCtx): BindingHit | undefined {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    const replacement = f.reassign?.get(name);
    if (replacement && (!e?.excluded.has(replacement.value))) {
      return { value: replacement.value, frame: f.bindingValueFrames?.get(replacement.value) ?? f, evaluated: null };
    }
    if (f.selectedDeclIndex === undefined && f.declIndex?.controlFlow === true) {
      selectControlFlow(f, e);
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
          /* A self-reading redeclaration can sit ahead of the synthetic
           * parameter cell. This rare branch is bounded by distinct same-name
           * declarations, never by render iteration count. Parameter cells
           * also own typed collection values that have no AST representation.
           *
           * Older activation sites still synthesize their parameter declaration
           * separately from the cell. Preserve the call-valued argument's caller
           * closure there by matching its unique MixinCall value, while typed
           * collection cells use declaration identity (their shared inert value
           * cannot safely identify one parameter). */
          for (let cell: BindingCell | null | undefined = f.cells?.get(name); cell; cell = cell.prev) {
            if (cell.declaration === declaration
              || (isMixinCallValue(declaration.value) && cell.value === declaration.value)) {
              return { value: cell.value, frame: cell.valueFrame ?? f, evaluated: cell.evaluated };
            }
          }
          return {
            value: declaration.value,
            frame: f.bindingValueFrames?.get(declaration.value) ?? f,
            evaluated: null
          };
        }
      }
    }
    if (f.fallback && !fb && (e === undefined || e.allowCallerScope || f.callerFallback !== true)) {
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
    if (f.fallback && !fb && (e === undefined || e.allowCallerScope || f.callerFallback !== true)) {
      fb = f.fallback;
    }
  }
  return fb ? hasExcludedScopedBinding(fb, name, e) : false;
}

/** {@link lookupVar} keeping the OWNING frame, for chain walks that must keep
 *  resolving in the scope each link came from rather than the scope they started in. */
/*
 * [R16] Pass `e` ONLY when this resolves a BODY's free reference (a member-access
 * base `@p[k]`, a chain-follow `@a: @b`, an `isdefined`/`isruleset` probe): it
 * threads the hermetic caller-read gate into the three lookup fns, so a
 * `callerFallback` frame's `fallback` is skipped unless `allowCallerScope`. Leave
 * `e` OFF for shape/candidate/arg probes (empty-variadic drop, closure-arg
 * substitution) where the caller fallback IS the intended scope (R15).
 */
function lookupVarIn(frame: Frame | null, name: string, e?: EvalCtx): BindingHit | undefined {
  return lookupScopedBinding(frame, name, e)
    ?? lookupLiveCell(frame, name, e)
    ?? lookupLeakedBinding(frame, name, e);
}

function lookupVar(frame: Frame | null, name: string, e?: EvalCtx): Binding | undefined {
  return lookupVarIn(frame, name, e)?.value;
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
function resolveVarRef(frame: Frame | null, name: string, lookup: 'live' | 'scoped', e: EvalCtx): BindingHit | undefined {
  return lookup === 'live'
    ? lookupLiveCell(frame, name, e)
    : lookupScopedBinding(frame, name, e) ?? lookupLeakedBinding(frame, name, e);
}

function hasExcludedVarRef(frame: Frame | null, name: string, lookup: 'live' | 'scoped', e: EvalCtx): boolean {
  return lookup === 'live'
    ? hasExcludedLiveCell(frame, name, e)
    : hasExcludedScopedBinding(frame, name, e) || hasExcludedLeakedBinding(frame, name, e);
}

/**
 * Whether any {@link Lookup} in a value satisfies `test` (called with `context`,
 * so a caller passes a static predicate and allocates no closure). An indirect
 * `@@x` also recurses into the node that NAMES its target.
 */
function callValueHasLookup<C>(value: CallValue, test: (node: Lookup, context: C) => boolean, context: C): boolean {
  if (isValueSlotArray(value)) {
    return value.some(item => callValueHasLookup(item, test, context));
  }
  if (value.type === 'MixinCall') {
    return value.args.some(arg => callValueHasLookup(arg.value, test, context));
  }
  switch (value.type) {
    case 'Lookup':
      return test(value, context) || (typeof value.name !== 'string' && callValueHasLookup(value.name, test, context));
    case 'Url':
      return callValueHasLookup(value.value, test, context);
    case 'Sequence':
      return value.parts.some(part => callValueHasLookup(part, test, context));
    case 'List':
      return value.value.some(part => callValueHasLookup(part, test, context));
    case 'Branch':
      return callValueHasLookup(value.condition, test, context)
        || callValueHasLookup(value.value, test, context);
    case 'Important':
      return callValueHasLookup(value.value, test, context);
    case 'Operation':
      return callValueHasLookup(value.left, test, context)
        || callValueHasLookup(value.right, test, context);
    case 'FunctionCall':
      return value.args.some(arg => callValueHasLookup(arg.value, test, context));
    case 'Block':
      return callValueHasLookup(value.value, test, context);
    case 'Interpolation':
      return value.parts.some(part => 'ref' in part && callValueHasLookup(part.ref, test, context));
    case 'Quoted':
      return value.interp !== null && callValueHasLookup(value.interp, test, context);
    case 'Reference':
      return callValueHasLookup(value.base, test, context)
        || value.steps.some((step) => {
          if (step.type === 'Call') {
            return step.args.some(arg => callValueHasLookup(arg.value, test, context));
          }
          return step.type === 'LookupStep' && typeof step.name !== 'string'
            && typeof step.name !== 'number'
            && callValueHasLookup(step.name, test, context);
        });
    case 'Range':
      return callValueHasLookup(value.start, test, context)
        || callValueHasLookup(value.end, test, context)
        || (value.step !== null && callValueHasLookup(value.step, test, context));
    case 'IfValue':
      /* Arm VALUES only, the same reach a `Condition` gets here: a guard tree is
       * not a value slot, so a self-reference inside one is out of this walk's
       * domain in both nodes alike. */
      return value.branches.some(branch => callValueHasLookup(branch.value, test, context));
    default:
      return false;
  }
}

/** A read of the scoped binding `name` — what a self-reading declaration checks for. */
const readsScoped = (node: Lookup, name: string): boolean =>
  node.kind === 'var' && node.name === name && node.scope === 'scoped';

/**
 * A read whose answer depends on how far execution has got: a live binding,
 * which exists once the write before it has run, or a property accessor, which
 * reads the declarations emitted so far.
 */
const readsInOrder = (node: Lookup): boolean =>
  node.kind === 'prop' || (node.kind === 'var' && node.scope === 'live');

/** Whether a condition reads any binding {@link readsInOrder}. */
function guardReadsInOrder(guard: GuardNode): boolean {
  switch (guard.g) {
    case 'and':
    case 'or':
      return guardReadsInOrder(guard.left) || guardReadsInOrder(guard.right);
    case 'not':
      return guardReadsInOrder(guard.inner);
    case 'cmp':
    case 'match':
      return callValueHasLookup(guard.left, readsInOrder, undefined) || callValueHasLookup(guard.right, readsInOrder, undefined);
    case 'truth':
      return callValueHasLookup(guard.value, readsInOrder, undefined);
    case 'call':
      return guard.args.some(arg => callValueHasLookup(arg, readsInOrder, undefined));
    case 'default':
      return false;
  }
}

/** {@link guardReadsInOrder} per `if()`/`$if`, a fact of its source decided once. */
const ifReadsInOrderCache = new WeakMap<If, boolean>();

function ifReadsInOrder(node: If): boolean {
  let reads = ifReadsInOrderCache.get(node);
  if (reads === undefined) {
    reads = node.branches.some(branch => branch.guard !== null && guardReadsInOrder(branch.guard));
    ifReadsInOrderCache.set(node, reads);
  }
  return reads;
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

/**
 * The frame whose live cells currently OWN `name` — the reassign target for an
 * optional-shadow write. Unlike {@link lookupLiveCell}, this returns the frame that
 * HOLDS the binding, never a cell's value frame, so a re-executed loop write always
 * lands in the same store and the shadow chain accumulates there.
 */
function liveCellOwnerFrame(frame: Frame | null, name: string, e: EvalCtx): Frame | null {
  let fb: Frame | null | undefined;
  for (let f = frame; f; f = f.parent) {
    for (let hit: BindingCell | null | undefined = f.cells?.get(name); hit; hit = hit.prev) {
      if (!e.excluded.has(hit.value)) {
        return f;
      }
    }
    if (f.fallback && !fb) {
      fb = f.fallback;
    }
  }
  return fb ? liveCellOwnerFrame(fb, name, e) : null;
}

/**
 * A `reassign-or-declare` (`::=`) live write snapshots a plain value node with a
 * FRESH identity, so a loop that re-runs the same declaration accumulates instead
 * of collapsing: identity drives both the shadow chain ({@link liveCellPredecessor})
 * and the exclusion walk. Arrays keep identity (their value-layout side table is
 * keyed on it) and detached rulesets / mixin calls keep identity ({@link bindDetached}
 * keys the binding on it), so only a scalar value node is copied — the accumulator case.
 */
function snapshotLiveWrite(value: ValueSlot | MixinCall): ValueSlot | MixinCall {
  if (isValueSlotArray(value) || isValueBlock(value) || value.type === 'MixinCall') {
    return value;
  }
  return { ...value };
}

function activateVariableDeclaration(node: VariableDeclaration, frame: Frame, e: EvalCtx): void {
  if (
    node.write.mode === 'declare'
    && callValueHasLookup(node.value, readsScoped, node.name)
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
    cells.set(node.name, {
      declaration: node, value: node.value, valueFrame: null, evaluated: null,
      prev: liveCellPredecessor(cells, node)
    });
    (frame.reassign ??= new Map()).set(node.name, node);
    return;
  }
  if (node.write.mode === 'reassign') {
    if (node.write.scope === 'live') {
      /* The cell's OWNER frame, not the frame its value evaluates in: a module
       * configuration seeds a cell whose value belongs to the importer. */
      const owner = liveCellOwnerFrame(frame, node.name, e);
      if (!owner) {
        throw new ReferenceError(`live variable $${node.name} is undefined`);
      }
      const cells = owner.cells!;
      cells.set(node.name, {
        declaration: node, value: node.value, valueFrame: null, evaluated: null,
        prev: liveCellPredecessor(cells, node)
      });
      return;
    }
    const found = lookupScopedBinding(frame, node.name, e);
    if (!found) {
      throw new ReferenceError(`scoped variable $^${node.name} is undefined`);
    }
    (found.frame.reassign ??= new Map()).set(node.name, node);
    return;
  }
  if (node.write.mode === 'reassign-or-declare') {
    /*
     * Optional shadow (jess `::=`; SCSS `$x:` inside a control-flow block). Reassign
     * the nearest existing binding; when none exists anywhere outer, declare a
     * block-local shadow in the CURRENT frame — same target the `declare`/`reassign`
     * arms write, chosen by whether a binding was found.
     */
    if (node.write.scope === 'live') {
      const owner = liveCellOwnerFrame(frame, node.name, e) ?? frame;
      const cells = owner.cells ??= new Map();

      /*
       * A loop re-executes the SAME declaration node each iteration, so an
       * accumulator (`$i: $i + $x`) must write a value with a FRESH identity and
       * remember the frame it evaluates in: fresh identity makes each write chain
       * onto the previous one (see liveCellPredecessor) and lets the exclusion set
       * — keyed on node identity — walk the chain rather than collapse it, and the
       * value frame keeps the loop variable resolvable when the value is read after
       * the loop. ponytail: read walks the write chain, so a very long accumulator
       * loop is O(n^2) at read — snapshot eagerly if a hot loop ever needs it.
       */
      cells.set(node.name, {
        declaration: node,
        value: snapshotLiveWrite(node.value),
        valueFrame: frame,
        evaluated: null,
        prev: liveCellPredecessor(cells, node)
      });
      return;
    }
    const found = lookupScopedBinding(frame, node.name, e);
    ((found?.frame ?? frame).reassign ??= new Map()).set(node.name, node);
    return;
  }
  const cells = frame.cells ??= new Map();
  cells.set(node.name, {
    declaration: node, value: node.value, valueFrame: null, evaluated: null,
    prev: liveCellPredecessor(cells, node)
  });
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

/**
 * A `$name` property accessor resolves the winning declaration. Its
 * declaration-level `!important` is carried through the caller's existing
 * importance sink, so `$color` of `color: red !important` yields
 * `red !important` only at a declaration emission site. A miss is a Less
 * semantic error. `functionMode` applies only after a registered function has
 * actually been invoked and failed.
 */
function resolvePropAccessor(node: Lookup, frame: Frame | null, e: EvalCtx): NonNullable<ReturnType<typeof resolvePropRef>> {
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
  return hit;
}

/** The bytes of a merged (`+:` / `+_:`) property: its members joined by their merge separators. */
function mergedPropertyBytes(merged: readonly PropertyDeclarationFact[], e: EvalCtx): MaybePromise<EvalValue> {
  const values = merged.map(member =>
    withExcluded(e, member.node.value, () => evalValueSlot(member.node.value, member.frame, e)));
  return combineAll(values, (resolved) => {
    let bytes = emitValueC(resolved[0]!, e);
    for (let i = 1; i < resolved.length; i++) {
      const separator = merged[i]!.node.merge === ',' ? sepGlue(',', e.compress === true) : ' ';
      bytes += separator + emitValueC(resolved[i]!, e);
    }
    return literal(bytes);
  });
}

/**
 * The typed value of a merged (`+:` / `+_:`) property: its members' own parsed
 * values. One member is its value; several are listed — a `+:` member opens a
 * comma item, a `+_:` member joins the current space run — the structure
 * {@link mergedPropertyBytes} spells.
 */
function mergedPropertyValue(
  merged: readonly PropertyDeclarationFact[],
  e: EvalCtx,
  projectMixinValues: boolean,
  argument: ArgumentMode
): MaybePromise<ValueGroup> {
  const values = merged.map(member => withExcluded(e, member.node.value,
    () => evalTypedSlot(member.node.value, member.frame, e, projectMixinValues, argument)));
  return combineAll(values, (resolved) => {
    const items: ValueGroup[] = [];
    let run: ValueGroup[] = [resolved[0]!];
    for (let i = 1; i < resolved.length; i++) {
      if (merged[i]!.node.merge === ',') {
        items.push(run.length === 1 ? run[0]! : run);
        run = [resolved[i]!];
      } else {
        run.push(resolved[i]!);
      }
    }
    items.push(run.length === 1 ? run[0]! : run);
    return items.length === 1 ? items[0]! : makeList(items, ',');
  });
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
    if (f.fallback && !fb && (e.allowCallerScope || f.callerFallback !== true)) {
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
    if (f.fallback && !fb && (e.allowCallerScope || f.callerFallback !== true)) {
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
 * falsely block each other). `run` returns whatever the caller's fold produces.
 *
 * [paren-group] `reached` marks the binding as one a reference reached — a
 * variable, an `@@name`, a property, and so an interpolation of one — and sets
 * {@link EvalCtx.reached} over the same span: a paren group around one value in
 * it evaluates to its value, Less grouping (`@a: (10px)` → `.x-@{a}` is
 * `.x-10px`, `margin: @a @a` is `10px 10px`), while one written directly in a
 * declaration value, or inside a math function, keeps its parens (ledger J16;
 * orchestrator judgment under owner delegation 2026-10-06).
 *
 * ponytail: a group the binding evaluates only after an await keeps its parens;
 * carry the flag through the continuation if a plugin value needs it.
 */
function withExcluded<T>(e: EvalCtx, node: Binding, run: () => T, reached = false): T {
  e.excluded.add(node);
  const was = e.reached;
  if (reached) {
    e.reached = true;
  }
  try {
    return run();
  } finally {
    e.excluded.delete(node);
    e.reached = was;
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
function evalBinding(
  b: Binding,
  frame: Frame | null,
  e: EvalCtx,
  evaluated: ValueGroup | null = null
): MaybePromise<EvalValue> {
  return evaluated ?? ('type' in b && b.type === 'MixinCall' ? literal('') : evalValueSlot(b, frame, e));
}

function unresolvedSymbol(node: object, symbol: string, e: EvalCtx): never {
  throw ERR.nameNotFound({ node, ...callSiteLocation(node, e), meta: { symbol } });
}

function recursiveReference(node: object, symbol: string, kind: 'Variable' | 'Property', e: EvalCtx): never {
  throw ERR.recursiveReference({ node, ...callSiteLocation(node, e), meta: { kind, symbol } });
}

/**
 * A {@link Lookup}'s target NAME. A plain `@x` carries it literally; an indirect
 * `@@x` carries the NODE whose resolved bytes name the target, which is the one
 * fact that used to justify a separate `VarIndirect` kind. Both paths land here,
 * so every caller reads one name and never re-derives the distinction.
 */
function lookupName(node: Lookup, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  if (typeof node.name === 'string') {
    return node.name;
  }

  /* A string names by its content, read from the typed string, never by stripping quotes. */
  return mapMaybe(evalTyped(node.name, frame, e), value =>
    !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value));
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
  /* An argument's bytes are its own spelling, whatever the output policy (see eagerSnapshot). */
  return (v: ValueSlot) => evalBytes(v, frame, spliceCtx(e));
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
  return (v: ValueSlot) => {
    const value = evalTypedSlot(v, frame, e);
    if (isThenable(value)) {
      return value.then((settled) => {
        warnConsumedOperand(settled, v, e);
        return settled;
      });
    }
    warnConsumedOperand(value, v, e);
    return value;
  };
}

/** A guard reads its operands and emits none of them, so it consumes a kept operation (§4.7). */
function warnConsumedOperand(value: ValueGroup, slot: ValueSlot, e: EvalCtx): void {
  warnConsumedKept(value, undefined, isValueSlotArray(slot) ? (slot[0] ?? {}) : slot, e);
}

/* ---------------------------------------------------- typed value eval */

/** The evaluator + modes carried through the value lane (a slim view of Emit). */
interface EvalCtx {
  ev: ValueEvaluator | null;
  modes: EvalModes;

  /**
   * Set on the non-evaluating byte lane of an F5 color call
   * ({@link preserveCall}): the evaluating context that lane was derived from.
   * The call's arguments keep their authored bytes, but a condition written in
   * them is still decided — `rgb(if((true), 1, 2), 2, 3)` is `rgb(1, 2, 3)` — so
   * {@link guardDeps} evaluates it here.
   */
  writtenFrom?: EvalCtx;

  /**
   * [compress] `output.compress` — minified output. Read on both the value lane
   * (folds Color/Dimension to shortest form; tightens list commas) and the
   * structural lane (drops whitespace/comments). Optional so every non-compress
   * EvalCtx construction is unchanged; a falsy read is the pretty path.
   */
  compress?: boolean;

  /**
   * [compress] Set by each `;`-terminator emission to whether it belonged to a
   * CUSTOM-PROPERTY (`--*`) declaration. `emitBlockClose` reads it so the last-`;`
   * drop skips a custom property (whose value region — `: value;` — is emitted
   * verbatim, because trailing whitespace/`}` would otherwise be absorbed into the
   * opaque value). Optional: unset (falsy) is the regular-declaration path.
   */
  lastDeclCustom?: boolean;

  /**
   * [R16] Resolved ONCE per render: `true` restores the legacy Less dynamic
   * caller-read (a body resolves free variables in the ambient call site);
   * `false` (default) is lexical/hermetic — the variable-read functions skip a
   * frame's `callerFallback`, so a body sees only its definition scope + params.
   * A single boolean read on the hot lookup path, never re-derived per lookup.
   */
  allowCallerScope: boolean;

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

  /**
   * [paren-group] Set while a binding a reference reached is evaluated
   * ({@link withExcluded}): a paren group around one value evaluates to its
   * value there, while one written directly in a declaration value keeps its
   * parens (ledger J16; orchestrator judgment under owner delegation 2026-10-06).
   */
  reached?: boolean;

  /**
   * [nesting] Composed selector branches that may carry a pseudo-element
   * ({@link mayCarryPseudoElement}), recorded from the parser's tokens where a
   * branch is composed ({@link rootStrings}, {@link compose}): flattening never
   * factors one into a parent `:is()` ({@link parentUnits}). One set per render,
   * shared by every context of it.
   */
  pseudoElementParents: Set<string>;

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

  /** SCSS module functions also use the dialect's qualified `name.member()`
   * call shape; mark them so the legacy raw-plugin ABI does not intercept them. */
  moduleFns?: Set<Fn>;

  /** Imported callable markers map to their function path; imported namespace
   * collection identities map to `null`. This lets explicit references dispatch
   * without admitting module functions into bare CSS call lookup. */
  moduleReferenceValues?: Map<object, string | null>;

  /** Compile-loaded script/data modules keyed by their canonical import fact. */
  plannedModuleImports?: Map<ModuleImport, PreparedModule> | null;

  /** Unactivated entries in a caller-owned module plan; zero skips every body scan. */
  pendingPlannedModuleImports?: number;

  /** True when module facts came from the reusable compiler dependency plan. */
  preparedImportsOwnedByCaller?: boolean;

  /*
   * [plugin/A9] The ordinary mixin binding remains its eager Less byte snapshot.
   * When that binding came directly from a parser-owned typed value, retain the
   * source only for the legacy raw-plugin ABI. The map is render-local, sparse,
   * and consulted exclusively after a plugin function has been selected.
   */
  pluginRawBindings: Map<Binding, Binding | null> | null;

  /** URL provenance remains visible at every typed consumer under OPEN V15. */
  mixinUrlBindings: Map<Binding, ValueGroup> | null;

  /* Non-URL structure is visible only at function/plugin argument boundaries. */
  mixinValueBindings: Map<Binding, ValueGroup> | null;

  /*
   * [compress] The typed value an eager argument snapshot was evaluated to, when
   * compress spells it differently from the snapshot's own bytes (ledger O3).
   * The bytes stay the value as written, which every splice writes; a
   * declaration under compress folds this value instead, and a structural
   * consumer (a function argument, `each()`, a spread) reads its items. Created
   * with the render, so every derived context shares it; absent when compress
   * is off.
   */
  compressedBindings?: WeakMap<Binding, ValueGroup>;

  /**
   * The typed value an eager argument snapshot was evaluated to
   * ({@link eagerSnapshot}). A typed position reads a scalar one instead of
   * re-reading the snapshot's bytes, so an argument keeps the type the parser
   * gave it across the mixin boundary; a structured one (a list, a block, a
   * map) still reads there as its bytes ({@link carrySnapshot}). Created with
   * the render, so every derived context shares it.
   */
  snapshotValues?: WeakMap<Binding, ValueGroup>;

}

/**
 * Force an internal eval value to a typed value node/group; an already-typed
 * value passes through. A bare string here is bytes something was KEPT as —
 * a preserved call or computation, a joined property value, an unresolved
 * reference's spelling — so it is a keyword of those bytes. It is never re-read
 * as a number, colour or boolean: whatever the parser typed was typed through
 * {@link evalTyped}, and reading the bytes again would re-derive it (ledger V3;
 * SEMANTIC-INVARIANTS P0).
 */
function force(v: EvalValue): ValueGroup {
  return isLiteral(v) ? makeKeyword(v) : v;
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
 * (`Color`/`Dimension`/`Quoted`), never re-classifying `src`; the `Any` leaf is
 * opaque bytes (ledger V3) — an eager mixin-argument snapshot's typed value is
 * read before this, from `snapshotValues`. When no evaluator is injected every
 * leaf degrades to a bare keyword of its `src` (the former `forceLiteral` no-`ev`
 * behavior).
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

  /* Likewise a string is a string, so an interpolation unquotes it by its content ({@link unquotedRef}). */
  if (node.type === 'Quoted') {
    return quotedFromFields(node.value, node.quote, node.escaped, node.src);
  }
  if (!e.ev) {
    return { type: 'Keyword', text: src, bytes: src };
  }
  switch (node.type) {
    case 'Keyword': return { type: 'Keyword', text: node.src, bytes: node.src };
    case 'Color': return colorFromSrc(node.src);
    case 'Dimension': return dimensionFromFields(node.number, node.unit, node.src);
    case 'Any': return makeAny(node.src);
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

  const values = slot.map(value => evalValueSlot(value, frame, e));
  return combineAll(values, (resolved) => {
    validateItemUnits(resolved, slot, slot[0] ?? {}, e);
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
        /* [compress] one space; the authored (possibly multi-line) run is pretty-only. */
        bytes += e.compress === true ? ' ' : authoredSpace(separators?.[index - 1]);
      }
      bytes += emitValueC(item, e);
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

function evalTypedSlot(
  slot: ValueSlot,
  frame: Frame | null,
  e: EvalCtx,
  projectMixinValues = false,
  argument: ArgumentMode = ARG_NONE
): MaybePromise<ValueGroup> {
  if (!isValueSlotArray(slot)) {
    return evalTyped(slot, frame, e, projectMixinValues, argument);
  }
  const values = slot.map(value => evalTypedSlot(value, frame, e, projectMixinValues, argument));
  if (!replaysLayout(argument)) {
    return combineAll(values, resolved => resolved);
  }

  /* The authored line breaks and comments between the items ride along ({@link emitAsWritten}). */
  const layout = replayedLayoutOf(slot);
  return combineAll(values, resolved => layout === undefined ? resolved : withValueLayout(resolved, layout));
}

/**
 * The authored layout of a group when pretty output replays a run of it (a
 * line break or a block comment), else `undefined`: a binding carries only the
 * layout that changes its written bytes ({@link emitAsWritten}).
 */
function replayedLayoutOf(node: object): readonly string[] | undefined {
  const layout = valueLayoutOf(node);
  if (layout !== undefined) {
    for (const run of layout) {
      if (runReplays(run)) {
        return layout;
      }
    }
  }
  return undefined;
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

function rememberUnitOwner(value: Value, node: Operation): Value {
  if (isUnexpressible(value)) {
    unitOwners.set(value, node);
  }
  return value;
}

function isOperationNode(node: object): node is Operation {
  return 'type' in node && node.type === 'Operation';
}

/** True when a `+`/`-` operator is GLUED to the right operand in source (a leading
 *  sign, no whitespace after the operator), inferred from spans: an Operation's
 *  span is `left <one space> op <ws?> right`, so the glued width is exactly
 *  `leftWidth + 1 + operator.length + rightWidth`. Each operand's SOURCE width is
 *  its span when present (variables/nested ops), else its literal token length
 *  (`Keyword`/`Dimension`/`Color`/`Quoted`/`Any` carry `src` = the authored bytes). */
const operationSignGlued = (node: Operation): boolean => {
  const width = (n: ValueNode): number | null => {
    const start = sourceStartOf(n);
    const end = sourceEndOf(n);
    if (start !== NO_SPAN && end !== NO_SPAN) {
      return end - start;
    }
    return 'src' in n && typeof n.src === 'string' ? n.src.length : null;
  };
  const opStart = sourceStartOf(node);
  const opEnd = sourceEndOf(node);
  const leftWidth = width(node.left);
  const rightWidth = width(node.right);
  if (leftWidth === null || rightWidth === null || opStart === NO_SPAN || opEnd === NO_SPAN) {
    return false;
  }
  return opEnd - opStart === leftWidth + 1 + node.operator.length + rightWidth;
};

function arithmeticSiteLocation(node: object, e: EvalCtx): ReturnType<typeof callSiteLocation> {
  const location = callSiteLocation(node, e);
  if (!isOperationNode(node)) {
    return location;
  }
  const source = location.ctx.file?.source;
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
  const operatorLocation = lineColAt(source, operatorOffset, location.ctx.file);
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
  const context = e.context;
  if (context === undefined) {
    return;
  }

  /*
   * One kept operation, one warning. A kept operation reaches every boundary
   * its value or a chain built on it crosses — a mixin argument and the
   * declaration that reads it — but it is one thing the author wrote.
   */
  const kept = preservedUnitClashes.get(value) ?? value;
  if (warnedUnitValues.has(kept)) {
    return;
  }
  warnedUnitValues.add(kept);
  const site = unitOwners.get(value) ?? unitOwners.get(kept) ?? owner;
  context.warn(WARN.unexpressibleUnit({
    node: site,
    ...arithmeticSiteLocation(site, e),
    meta: { expr: (value.type === 'Dimension' ? value.preserved : undefined) ?? value.bytes }
  }));
}

function throwUnitArithmetic(error: unknown, node: object, e: EvalCtx): never {
  if (error instanceof DivisionByZeroError) {
    throw ERR.divisionByZero({
      node,
      ...arithmeticSiteLocation(node, e),
      meta: { expr: error.expr }
    });
  }
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
  if (error instanceof EmptyOperandError) {
    throw ERR.emptyOperand({
      node,
      ...arithmeticSiteLocation(node, e),
      meta: { reason: error.message }
    });
  }
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
  if (!demandExpressible && modes.unitMode !== 'strict' && !modes.inCalc) {
    const unexpressible = findFinalValue(value, isUnexpressible);
    if (unexpressible !== undefined) {
      warnUnexpressibleUnit(unexpressible, owner, e);
    }
  }
}

/**
 * §4.7 — a list item is a final typed value too. The declaration boundary
 * (`evalBytes`) validates the value it is handed, but a `List`, a `Sequence`
 * and a space-separated value slot emit their items to bytes themselves, so
 * without this an item carrying an unexpressible unit (`$(2px * 3px) / 1px`,
 * `1px (1px * 3em) 2`) would skip the `unitMode` ladder that the same operation
 * meets on its own.
 */
function validateItemUnits(items: readonly EvalValue[], sources: readonly (ValueSlot | undefined)[], owner: object, e: EvalCtx): void {
  if (!e.ev) {
    return;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!isLiteral(item)) {
      const source = sources[index];
      validateValueGroupUnits(item, e.modes, source === undefined || isValueSlotArray(source) ? owner : source, e, false);
    }
  }
}

/** The values {@link warnUnexpressibleUnit} has reported, each once. */
const warnedUnitValues = new WeakSet<Value>();

/**
 * §4.7 where a value is CONSUMED rather than emitted. An operation `preserve`
 * kept unevaluated (`1px + 3em`) has no value to compute with, so a call or a
 * guard that takes one as an operand reads nothing from it: `percentage(1px + 3em)`
 * is written out as-is, a guard comparing it does not match. Unless the
 * consumer hands the kept value on to a later boundary, this is the last place
 * that can say so.
 */
function warnConsumedKept(operands: ValueGroup, passedOn: EvalValue | undefined, owner: object, e: EvalCtx): void {
  if (e.modes.unitMode === 'strict' || e.modes.inCalc
    || (passedOn !== undefined && !isLiteral(passedOn) && findFinalValue(passedOn, isKeptOperation) !== undefined)) {
    return;
  }
  if (!isValueGroupArray(operands)) {
    const kept = findFinalValue(operands, isKeptOperation);
    if (kept !== undefined) {
      warnUnexpressibleUnit(kept, owner, e);
    }
    return;
  }
  for (const operand of operands) {
    warnConsumedKept(operand, undefined, owner, e);
  }
}

/** A typed value that is no function argument. */
const ARG_NONE = 0;

/** An argument handed to a callable: a call in it yields its value. */
const ARG_INPUT = 1;

/**
 * An argument of a call written out as-is, which has no callable (ledger F11):
 * only the call is inert, the argument is a value like a declaration value, so
 * an F5 color call in it keeps its authored bytes.
 */
const ARG_WRITTEN = 2;

/**
 * A mixin argument evaluated for its binding: no function argument, but the
 * authored line breaks and comments between its items ride on the groups it
 * builds, so the bound bytes keep them ({@link writtenBytes}).
 */
const ARG_BINDING = 3;

/**
 * A value an interpolation splices ({@link unquotedRef}): written as a
 * declaration writes it — a group keeps its parens, an F5 color call its
 * authored bytes, as in {@link ARG_WRITTEN}, and the line breaks and comments
 * between its items ride along, as in {@link ARG_BINDING}, while a ruleset
 * writes nothing — but typed, so a string is read by its content.
 */
const ARG_SPLICE = 4;
type ArgumentMode = typeof ARG_NONE | typeof ARG_INPUT | typeof ARG_WRITTEN | typeof ARG_BINDING | typeof ARG_SPLICE;

/** Whether a typed value is written as authored: no callable reads it ({@link ARG_WRITTEN}, {@link ARG_SPLICE}). */
const writtenAsAuthored = (argument: ArgumentMode): boolean => argument === ARG_WRITTEN || argument === ARG_SPLICE;

/**
 * Whether the authored layout between a group's items rides on the value
 * ({@link ARG_BINDING}, {@link ARG_SPLICE}): only these modes write the value
 * out as bytes, so no other typed evaluation reads the layout table.
 */
const replaysLayout = (argument: ArgumentMode): boolean => argument === ARG_BINDING || argument === ARG_SPLICE;

function evalTyped(
  node: ValueNode,
  frame: Frame | null,
  e: EvalCtx,
  projectMixinValues = false,
  argument: ArgumentMode = ARG_NONE
): MaybePromise<ValueGroup> {
  switch (node.type) {
    case 'AnonymousMixin':
      /*
       * [P37] A ruleset passed to a function is evaluated and kept: the function
       * receives it as the raw text of its evaluated block, so a call written out
       * as-is (unknown, not in scope, or failed and preserved) never loses it.
       * Anywhere else it has no value, exactly as before.
       */
      return argument === ARG_INPUT || argument === ARG_WRITTEN
        ? writtenRulesetArgument(node, frame, e)
        : mapMaybe(evalValue(node, frame, e), v => force(v));

    /* An AUTHORED `null` — provenance explicit, so `null` and an unbound value
     * stay distinguishable downstream while remaining the same value. */
    case 'Null':
      return makeNull(true);
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Comment':
      return materializeNode(node, e);
    case 'Any':
      /*
       * Eager mixin binding stores evaluated bytes in the canonical Any
       * snapshot, with a scalar's typed value beside it (`snapshotValues`), so
       * the argument keeps the type it was evaluated to. URL-bearing activations
       * keep the typed value beside that exact identity for OPEN V15. Other
       * retained grouping is exposed only by the function/plugin argument
       * projections, so guards and declarations retain their established
       * eager-byte semantics.
       */
      if (projectMixinValues) {
        const carried = frame?.mixinValueBindings?.get(node)
          ?? e.mixinValueBindings?.get(node)
          ?? e.compressedBindings?.get(node);
        if (carried !== undefined) {
          return carried;
        }
      }
      {
        const snapshot = e.snapshotValues?.get(node);
        return (snapshot !== undefined && !isStructuredGroup(snapshot) ? snapshot : undefined)
          ?? frame?.mixinUrlBindings?.get(node)
          ?? e.mixinUrlBindings?.get(node)
          ?? materializeNode(node, e);
      }
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
       * and `1px > red` the same pair, and they are not. The quote rides along
       * as provenance only, for a legacy plugin's `tree.Quoted`.
       *
       * A string that interpolates is the same string (ledger V3, owner
       * 2026-10-06): its spliced content lands as the same `Any` when escaped,
       * the same quoted string otherwise — never re-read as a number, colour or
       * keyword.
       */
      if (node.interp !== null) {
        return mapMaybe(evalInterp(node.interp, frame, e), content => !isLiteral(content)
          ? content
          : node.escaped ? makeAny(content, node.quote) : makeQuoted(content, node.quote, false));
      }
      return node.escaped ? makeAny(node.value, node.quote) : materializeNode(node, e);
    case 'Url':
      /*
       * A URL becomes a typed value only when a typed consumer asks for it.
       * Ordinary URL emission stays in evalValue's bare-string lane; function
       * predicates receive the parser-owned Url fact without inspecting bytes.
       */
      return mapMaybe(evalValue(node, frame, e), v => makeUrlValue(emitValue(v)));
    case 'Lookup':
      /*
       * A `$name` property accessor is the declaration's own value, typed as the
       * parser typed it — the same reading a variable gets — not its joined
       * bytes read back; a merged (`+:`) property is its members' typed values.
       * An `entry` lookup keeps its authored spelling.
       */
      if (node.kind === 'prop') {
        const hit = resolvePropAccessor(node, frame, e);
        return hit.merged
          ? mergedPropertyValue(hit.merged, e, projectMixinValues, argument)
          : withExcluded(e, hit.value, () => evalTypedSlot(hit.value, hit.frame, e, projectMixinValues, argument), true);
      }
      if (node.kind !== 'var') {
        return mapMaybe(evalValue(node, frame, e), v => force(v));
      }
      return mapMaybe(lookupName(node, frame, e), (nm) => {
        const hit = resolveVarRef(frame, nm, node.scope, e);
        if (!hit) {
          if (hasExcludedVarRef(frame, nm, node.scope, e)) {
            recursiveReference(node, `@${nm}`, 'Variable', e);
          }
          return force(unresolvedRef(node, nm, e));
        }
        const bound = hit.value;
        return hit.evaluated ?? withExcluded(e, bound, () =>
          isMixinCallValue(bound)
            ? force(literal(''))
            : evalTypedSlot(bound, hit.frame, e, projectMixinValues, argument), true);
      });
    case 'Reference': {
      const moduleCall = evalModuleReferenceCall(node, frame, e);
      if (moduleCall !== undefined) {
        return mapMaybe(moduleCall, value => force(value));
      }

      /*
       * A typed guard comparison must retain the matched member's AST tag.
       * Falling through `evalValue` turns a typed `Keyword('true')` into an
       * untagged computed string before the value evaluator compares it.
       */
      const resolved = resolveReferenceResult(node, frame, e);
      if (resolved === null) {
        return force(unresolvedReference(node, frame, e));
      }
      return isMixinCallValue(resolved.value)
        ? force(literal(node.raw))
        : resolved.evaluated
          ?? evalTypedSlot(resolved.value, resolved.frame, e, projectMixinValues);
    }
    case 'Block':
      /*
       * A typed function argument still needs the surrounding-parenthesis math
       * context.  `round((@r / 3))` and `unit((4px * 4em / 2cm))` consume the
       * inner value through this path; dropping the paren frame made their
       * operations look like top-level parens-division math and left the whole
       * registered function call verbatim after its typed signature rejected it.
       */
      if (node.delimiter !== 'paren') {
        return mapMaybe(
          evalTypedSlot(node.value, frame, e, projectMixinValues),
          value => makeBlock(value, node.delimiter, node.escaped)
        );
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
       *
       * An inert group has nothing for the frame to compute, so it is not
       * consumed and keeps its parens ({@link isInertGroup}); nor is a group in
       * an argument of a call written out as-is, which no callable reads, unless
       * what it holds computes ({@link groupComputes}). Such an argument keeps
       * the written-out policy inside a group that computes, so an F5 color
       * call there is still written as authored.
       */
      if (e.reached === true && (e.calcDepth ?? 0) === 0 && groupsOneValue(node) && !groupComputes(node, frame, e)) {
        return evalTypedSlot(node.value, frame, e, projectMixinValues, argument);
      }
      if (isInertGroup(node) || (writtenAsAuthored(argument) && !groupComputes(node, frame, e))) {
        return mapMaybe(evalTypedSlot(node.value, frame, e, projectMixinValues, argument), v => makeKeyword(`(${emitValue(v)})`));
      }
      return mapMaybe(evalTypedSlot(
        node.value,
        frame,
        { ...e, parenFrames: pushParenFrame(e, true) },
        projectMixinValues,
        writtenAsAuthored(argument) ? argument : ARG_NONE
      ), keepAuthoredGroup);
    case 'Collection':
      /*
       * A map reaching a TYPED position (a function argument, an operation) is
       * the value-domain map, not the bytes it renders to — that is the whole
       * point of the representation. Explicit rather than left to `default:`, so
       * a map argument can never silently regress to a sniffed keyword.
       */
      return evalCollection(node, frame, e, projectMixinValues);
    case 'NestedPropertyBlock':
      return node.base === null
        ? force(literal(''))
        : evalTypedSlot(node.base, frame, e, projectMixinValues);
    case 'List': {
      /*
       * A comma-list materializes to the value-domain `List`, its items materialized
       * LAZILY here (only now that the list is actually consumed typed — indexed by
       * `extract`, counted by `length`, or compared). The structure the parser owns
       * is handed to the value layer directly — no re-splitting a joined string.
       */
      const typed = node.value.map(it => evalTypedSlot(it, frame, e, projectMixinValues, argument));
      const layout = replaysLayout(argument) ? replayedLayoutOf(node) : undefined;
      return combineAll(typed, vals => layout === undefined ? makeList(vals, node.sep) : withValueLayout(makeList(vals, node.sep), layout));
    }
    case 'Branch':
      /*
       * [P38] A branch argument, typed: its condition and value are materialized
       * like any argument — a ruleset value (`if(c: { v: 1; })`) written out as
       * a ruleset argument is — and the branch is its authored `cond: value`.
       */
      return combineAll([
        evalTypedSlot(node.condition, frame, e, projectMixinValues, argument),
        evalTypedSlot(node.value, frame, e, projectMixinValues, argument)
      ], (parts) => {
        const condition = emitValueC(parts[0]!, e);
        const value = emitValueC(parts[1]!, e);
        return makeAny(value === '' ? `${condition}:` : `${condition}: ${value}`);
      });
    case 'Sequence': {
      /*
       * A structured SPACE-list (`@v: a b c` / `1px solid @c`) materializes to the
       * value-domain `List` with a space separator, so `extract` / `length` index
       * its structure directly (each part resolved) instead of re-splitting a joined
       * string. Typed consumption only — the emit path (`evalValue`) still joins the
       * parts to bytes, so an un-consumed space value serializes exactly as before.
       */
      const parts = node.parts.map(p => evalTyped(p, frame, e, projectMixinValues));
      return combineAll(parts, vals => vals);
    }
    case 'FunctionCall':
      /*
       * Typed consumers deliberately bypass any direct-output preservation
       * policy. An operation or typed function argument needs the callable's
       * result, not its authored bytes. An argument of a call written out as-is
       * feeds no callable, so it keeps that policy (ledger F11). A call that
       * comes back as the bytes it was written with is kept as written, so a
       * group around it keeps its parens ({@link groupComputation}).
       */
      return mapMaybe(evalCall(node, frame, e, !writtenAsAuthored(argument)), v => isLiteral(v) ? keepAsWritten(makeKeyword(v)) : v);
    case 'Condition':
      return mapMaybe(withUnitErrors(node, e, () => evalGuard(node.guard, guardDeps(frame, e))), makeBool);
    case 'IfValue': {
      const unlowered = unloweredCall(node);
      if (unlowered !== null) {
        return mapMaybe(evalCall(unlowered, frame, e, true), v => force(v));
      }

      /* The taken arm is consumed TYPED — `if(@c, 1px, 2px) * 2` operates on the
       * branch value, not on its bytes. An unmatched chain has no value. */
      return mapMaybe(pickIfValue(node, frame, e), taken => taken === undefined
        ? NULL
        : evalTypedSlot(taken, frame, e, projectMixinValues, argument));
    }
    case 'Range':
      /*
       * Ranges are consumed structurally by `forItems`; a value-position use
       * retains authored range syntax rather than inventing a flattened list.
       */
      return mapMaybe(evalValue(node, frame, e), v => force(v));
    case 'Expression': {
      /*
       * A computation boundary opens the math context and hands on its value as
       * the parser typed it — `$(#fff)` is a colour, `$("a")` a string — the same
       * frame `evalValue` opens, without folding the value to bytes first.
       */
      const unlowered = unloweredCall(node);
      if (unlowered !== null) {
        return mapMaybe(evalCall(unlowered, frame, e, true), v => force(v));
      }
      if (!e.ev) {
        return mapMaybe(evalValue(node, frame, e), v => force(v));
      }
      const computed = evalTypedSlot(node.value, frame, { ...e, parenFrames: pushParenFrame(e, true), exprBoundary: true }, projectMixinValues, argument);
      return isAuthoredGroupExpression(node) ? mapMaybe(computed, keepAuthoredGroup) : computed;
    }
    case 'Interpolation': {
      /*
       * A template in a typed position is typed by what the parser built, never
       * by re-reading the bytes it splices to. A string is never one: every
       * quoted template is a `Quoted` (see above).
       * - `.jess` `$( … )` (a lone `Expression` ref) is the computation's own
       *   value — unquoted, as the splice is, so a string result is opaque text
       *   (ledger V3);
       * - any other template (Less `@{n}px`, an interpolated custom-property
       *   value) is opaque bytes, exactly as its `.jess` spelling `~"…"` is (V3).
       */
      const first = node.parts[0];
      if (node.parts.length === 1 && first !== undefined && 'ref' in first && first.ref.type === 'Expression') {
        const ref = first.ref;
        return mapMaybe(evalTyped(ref, frame, e), (value) => {
          validateValueGroupUnits(value, e.modes, ref, e, true);
          return first.unquote && !isValueGroupArray(value) && value.type === 'Quoted' ? makeAny(value.value) : value;
        });
      }
      return mapMaybe(evalInterp(node, frame, e), bytes => isLiteral(bytes) ? makeAny(bytes) : bytes);
    }
    default:
      /*
       * Computed / joined shapes (Operation, Expression, …): fold to a Value,
       * then force the bytes a preserved computation was kept as (see `force`).
       */
      return mapMaybe(evalValue(node, frame, e), v => force(v));
  }
}

const isParenGroup = (slot: ValueSlot): slot is Block =>
  !isValueSlotArray(slot) && slot.type === 'Block' && slot.delimiter === 'paren' && slot.escaped !== true;

/*
 * A paren group is consumed when what it holds computes — math (`(1px + 2px)` is
 * `3px`), a comparison (`.jess` `$((1 > 0))` is `true`), a call a callable
 * computes (`(percentage(0.5))` is `50%`, `.jess` `($percentage(0.5))` too), or
 * anything a reference names that is one of those: a variable (`@a`, `@@name`),
 * a mixin parameter, a property (`$w`) or a member (`@m[v]`, `#ns[@v]`,
 * `.m()[@r]`) (ledger F4: once computed, the parens do not survive). A `.jess`
 * `$( … )` computes when what it holds does, so `($(10px))` keeps its parens as
 * `(10px)` does. Every other group keeps its parens
 * wherever it is written — around one value (`c: (10vh)`, `(@w)` with `@w:
 * 10px`), around a call written out as-is (`(var(--a))`) or a CSS colour call
 * (`(rgb(1, 2, 3))`), around math kept as written, or around raw bytes — in
 * every dialect, so valid CSS emits the bytes css does
 * (SEMANTIC-INVARIANTS 4; orchestrator judgment under owner delegation
 * 2026-10-06). Inside a math function every authored paren is kept (ledger
 * P35). A computing consumer — an operand of math that operates, an argument a
 * callable reads — still reads the value inside the group, through the typed
 * lane, and an operand of math kept as written keeps the group's spelling
 * ({@link spelledOperand}).
 */

/**
 * What computes in the group (see above), or `null`: the operation, comparison,
 * `$( … )`, call or conditional it holds, directly or through what its
 * references name. A call counts here, and one no callable computed comes back
 * marked as written out as-is, which {@link keepAuthoredGroup} keeps in its
 * parens.
 */
function groupComputation(node: Block, frame: Frame | null, e: EvalCtx): ValueNode | null {
  return (e.calcDepth ?? 0) > 0 ? null : slotComputation(node.value, frame, e);
}

const groupComputes = (node: Block, frame: Frame | null, e: EvalCtx): boolean => groupComputation(node, frame, e) !== null;

/**
 * What computes in `slot` (see {@link groupComputation}), past its parens and
 * through the references it reads. A reference is resolved by the resolver its
 * evaluation uses, so every way of reading a value classifies it alike. A
 * `$( … )` or authored group expression stands for what it holds, and is
 * returned when that computes, so the group reads the splice typed.
 */
function slotComputation(slot: ValueSlot, frame: Frame | null, e: EvalCtx): ValueNode | null {
  let inner = slot;
  let scope = frame;

  /* ponytail: a reference cycle raises when the group evaluates; the cap only bounds this walk. */
  for (let hops = 0; hops < 32; hops += 1) {
    while (isParenGroup(inner)) {
      inner = inner.value;
    }
    if (isValueSlotArray(inner)) {
      return null;
    }
    let named: { value: Binding; frame: Frame | null } | null | undefined;
    switch (inner.type) {
      case 'Lookup':
        named = lookupBinding(inner, scope, e);
        break;
      case 'Reference':
        /* A reference ending in a call (`.jess` `$fn()`) is a call. */
        if (inner.steps[inner.steps.length - 1]?.type === 'Call') {
          return inner;
        }
        named = resolveReferenceResult(inner, scope, e);
        break;
      case 'Expression':
        return slotComputation(inner.value, scope, e.exprBoundary === true ? e : { ...e, exprBoundary: true }) === null ? null : inner;

      /* A comparison computes where a value-position one is evaluated: at a `.jess` `$( … )` boundary (§7.1). */
      case 'Condition':
        return e.exprBoundary === true ? inner : null;
      case 'Interpolation': {
        const first = inner.parts[0];
        return isComputationSplice(inner) && first !== undefined && 'ref' in first
          && slotComputation(first.ref, scope, e) !== null
          ? inner
          : null;
      }
      default:
        return computationIn(inner);
    }
    if (named === null || named === undefined || isMixinCallValue(named.value)) {
      return null;
    }
    inner = named.value;
    scope = named.frame;
  }
  return null;
}

/**
 * What a lookup names — a variable, an `@@name` one included, or a property —
 * by the resolvers its evaluation uses, or `undefined`. A merged property is
 * the bytes of its members, and an `@@name` whose name awaits a plugin is read
 * only when it evaluates.
 */
function lookupBinding(node: Lookup, frame: Frame | null, e: EvalCtx): { value: Binding; frame: Frame | null } | undefined {
  if (node.kind === 'var') {
    const name = lookupName(node, frame, e);
    if (isThenable(name)) {
      observeRejectedThenable(name);
      return undefined;
    }
    return resolveVarRef(frame, name, node.scope, e);
  }
  if (node.kind === 'prop' && typeof node.name === 'string') {
    const hit = resolvePropRef(frame, node.name, e);
    return hit === undefined || hit.merged !== undefined ? undefined : hit;
  }
  return undefined;
}

/**
 * The mixin arguments whose authored value computed ({@link eagerSnapshot}): a
 * parameter stands for its argument, so a group around it is consumed exactly
 * as a group around the argument would be.
 */
const computedArguments = new WeakSet<Any>();

/** `inner` when it computes as it is evaluated, or `null` (see {@link groupComputation}); no reference or wrapper reaches here ({@link slotComputation}). */
function computationIn(inner: ValueNode): ValueNode | null {
  switch (inner.type) {
    case 'Operation':
      /*
       * A query relation (`min-width: 640px`, `width < 500px`) is a feature, not
       * math: only a query grammar builds one as an `Operation`, and it is
       * written as is. A value comparison is a `Condition`.
       */
      return inner.inMathFunction || isQueryRelation(inner.operator) ? null : inner;
    case 'FunctionCall':
      /* A CSS colour written as a call is one CSS value in every dialect (ledger F5, SEMANTIC-INVARIANTS 4). */
      return isCssColorCall(inner) ? null : inner;
    case 'IfValue':
      return inner;
    case 'Any':
      return computedArguments.has(inner) ? inner : null;
    default:
      return null;
  }
}

/** A `.jess` `$( … )` in a value: a template that splices one computation. */
function isComputationSplice(node: Interpolation): boolean {
  const first = node.parts[0];
  return node.parts.length === 1 && first !== undefined && 'ref' in first && first.ref.type === 'Expression';
}

/**
 * Whether a paren group holds one value — not a list, a sequence, a feature
 * (`(min-width: 640px)`) or an operation — past any parens around it.
 */
function groupsOneValue(node: Block): boolean {
  let inner: ValueSlot = node.value;
  while (isParenGroup(inner)) {
    inner = inner.value;
  }
  return !isValueSlotArray(inner) && inner.type !== 'Operation' && inner.type !== 'List' && inner.type !== 'Sequence'
    && inner.type !== 'Condition' && inner.type !== 'Branch';
}

/** A paren group around math kept as written or around raw bytes: nothing in it computes. */
function isInertGroup(node: Block): boolean {
  let inner: ValueSlot = node.value;
  while (isParenGroup(inner)) {
    inner = inner.value;
  }
  return !isValueSlotArray(inner) && (inner.type === 'Any' || (inner.type === 'Operation' && inner.inMathFunction));
}

/**
 * How many paren levels the author wrote around `calc()`'s argument that its
 * typed evaluation drops, or 0 when the argument is not a group around one
 * value. A group whose operation computes is consumed by it, and an inert group
 * writes its own parens.
 */
function unconsumedParens(slot: ValueSlot): number {
  let depth = 0;
  let inner = slot;
  while (isParenGroup(inner)) {
    inner = inner.value;
    depth += 1;
  }
  return !isValueSlotArray(inner) && (inner.type === 'Operation' || inner.type === 'Any') ? 0 : depth;
}

const wrapParens = (bytes: string, depth: number): string => depth === 0 ? bytes : `${'('.repeat(depth)}${bytes}${')'.repeat(depth)}`;

/**
 * How many paren levels the author wrote around `slot` when it is a group that
 * nothing in computes ({@link groupComputes}), or 0. The typed lane hands a
 * consumer the value inside; this is the spelling it keeps when nothing
 * computes it.
 */
function writtenParens(slot: ValueSlot, frame: Frame | null, e: EvalCtx): number {
  return isParenGroup(slot) && !groupComputes(slot, frame, e) ? unconsumedParens(slot) : 0;
}

/**
 * An operand as `operate` sees it: a group around one value keeps its spelling,
 * so math kept as written keeps the parens (`(10px) + 1` under `unitMode:
 * 'preserve'`), while math that computes reads only the value. A named-colour
 * keyword stays bare, since `operate` reads it as a colour.
 */
function spelledOperand(node: ValueNode, value: Value, frame: Frame | null, e: EvalCtx): Value {
  const depth = writtenParens(node, frame, e);
  return depth === 0 || (value.type === 'Keyword' && namedColor(value.bytes) !== undefined)
    ? value
    : { ...value, bytes: wrapParens(value.bytes, depth) };
}

/**
 * The bytes of one operand of an operation that is kept as written. The value
 * lane already wrote back a group's own parens ({@link writtenParens}); an
 * operand that is itself an operation kept as written (a variable holding
 * `foo + 1`) is grouped by precedence ({@link operandAsWritten}). Inside a math
 * function, kept math is its arithmetic, never a nested `calc()`
 * (`calc(@x * 2)` with `@x: 1px + 1em` is `calc((1px + 1em) * 2)`).
 */
function keptOperand(parent: Operation, child: ValueNode, value: EvalValue, e: EvalCtx): string {
  const bytes = emitValue(value);
  return isLiteral(value) || isValueGroupArray(value)
    ? bytes
    : operandAsWritten(value, parent.operator, child === parent.right, bytes, parent.inMathFunction || (e.calcDepth ?? 0) > 0);
}

/**
 * An `Expression` the author spelled as a paren group — its span opens at the
 * `(` before its value does. A `.jess` `$( … )` carries no span of its own and a
 * bare Less computation starts where its value starts, so neither prints parens.
 */
function isAuthoredGroupExpression(node: Expression): boolean {
  const start = sourceStartOf(node);
  return start !== NO_SPAN && !isValueSlotArray(node.value) && start < sourceStartOf(node.value);
}

/**
 * An authored paren group's value once its math has run. A computed inner is
 * one value and sheds the parens; an operation `operate` kept as written
 * (`foo + 1`) is still an expression and keeps
 * them, or `(foo + 1) * 2` would print as `foo + 1 * 2`.
 */
function keepAuthoredGroup<T extends EvalValue>(v: T): T | Value {
  return isLiteral(v) || isValueGroupArray(v) ? v : groupAsWritten(v);
}

/** The relations a query grammar builds as `Operation`s: a feature `name: value` and a range comparison. */
const isQueryRelation = (operator: string): boolean =>
  operator === ':' || operator === '<' || operator === '>' || operator === '<=' || operator === '>=' || operator === '=';

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
    /*
     * [compress] A value CLASSIFIED `Color` (an AST `Color` node — always a `#hex`
     * literal; named colors are `Keyword`, function colors are `FunctionCall`) folds
     * to the shortest of {folded hex, named color}. The fold is selected by the node
     * TYPE, never by sniffing bytes — a `Keyword` in this switch is left verbatim.
     */
    case 'Color':
      return literal(e.compress ? shortestColorFromHex(node.src) : node.src);

    case 'Any':
      /*
       * [compress] A mixin argument binds as its evaluated bytes, spelled as
       * written. When the binding kept the typed value beside them, that value
       * folds by its type, as the same value reaching the declaration directly
       * does. A splice evaluates with compress off, so it writes the bytes as
       * written.
       */
      if (e.compress === true) {
        const carried = frame?.mixinValueBindings?.get(node) ?? e.mixinValueBindings?.get(node) ?? e.compressedBindings?.get(node);
        if (carried !== undefined) {
          return carried;
        }
      }
      return literal(node.src);
    case 'Keyword':
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
       *
       * [compress] The byte lane (`ev === null`, the preserved-call arg path) keeps
       * a dimension's authored spelling — EXCEPT that `output.compress` folds it by
       * its CLASSIFICATION here, exactly as `emitValueC` does for the typed lane. A
       * `Dimension` is a `Dimension` whatever position it lands in, so `rgba(…,0.1)`
       * trims to `.1` off the node type, never by re-scanning the joined arg string.
       */
      return e.ev
        ? dimensionFromFields(node.number, node.unit, node.src)
        : literal(e.compress === true ? compressDimensionBytes(node.src) : node.src);
    case 'Quoted':
      if (node.interp !== null) {
        return mapMaybe(evalInterp(node.interp, frame, e), content => isLiteral(content) && !node.escaped
          ? literal(`${node.quote}${content}${node.quote}`)
          : content);
      }
      return literal(node.escaped ? node.value : node.src);
    case 'Url': {
      /*
       * Quoting is syntax, not a URL-path inference problem. Preserve it
       * structurally while giving the owning plugin only the target bytes.
       */
      const body = node.value;
      if (body.type === 'Quoted') {
        return mapMaybe(body.interp === null ? body.value : evalInterp(body.interp, frame, e), (content) => {
          if (!isLiteral(content)) {
            return content;
          }

          /*
           * Less `~"…"` / `~'…'` is an escaped string value: inside a URL it
           * deliberately strips both the escape marker and its quote wrapper.
           * Its content is opaque (ledger V3), so no URL rewrite reaches into
           * it: `url(~"'b.png'")` stays `url('b.png')` under a rootpath, where
           * a rewrite wrote the bad-url token `url(root/'b.png')` (orchestrator
           * judgment under owner delegation 2026-10-06).
           */
          if (body.escaped) {
            return literal(`url(${content})`);
          }
          const target = e.context?.transformUrl(content, true) ?? content;
          return literal(`url(${body.quote}${target}${body.quote})`);
        });
      }
      if (body.type === 'Any') {
        const target = e.context?.transformUrl(body.src, false) ?? body.src;
        return literal(`url(${target})`);
      }
      return mapMaybe(evalTyped(body, frame, e), (value) => {
        /*
         * Dynamic URL content — `url(@var)` / any non-literal — gets the same URL
         * transform (rootpath/rewriteUrls/urlArgs) an authored `url("…")` gets. A
         * string's quote is syntax, read from the typed string: transform its
         * content and keep the quote around it. An escaped string is opaque
         * (ledger V3) and is written as is, as `url(~"…")` written directly is.
         * Anything else is transformed whole.
         */
        if (!isValueGroupArray(value) && value.type === 'Quoted' && !value.escaped) {
          const target = e.context?.transformUrl(value.value, true) ?? value.value;
          return literal(`url(${value.quote}${target}${value.quote})`);
        }
        if (!isValueGroupArray(value) && (value.type === 'Quoted' || (value.type === 'Any' && value.escapedQuote !== ''))) {
          return literal(`url(${emitValue(value)})`);
        }
        const raw = emitValue(value);
        const target = e.context?.transformUrl(raw, false) ?? raw;
        return literal(`url(${target})`);
      });
    }
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
          return hit.evaluated ?? withExcluded(
            e,
            hit.value,
            () => evalBinding(hit.value, hit.frame, e, hit.evaluated),
            true
          );
        });
      }

      const hit = resolvePropAccessor(node, frame, e);
      return hit.merged
        ? mergedPropertyBytes(hit.merged, e)
        : withExcluded(e, hit.value, () => evalBinding(hit.value, hit.frame, e), true);
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
    case 'Sequence':
      return joinSpacedBytes(node, frame, e);
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
        validateItemUnits(vals, node.value, node, e);

        const compress = e.compress === true;
        const glue = sepGlue(node.sep, compress);
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
          const bytes = emitValueC(item, e);
          if (!empty) {
            out += itemBoundary(authored?.[index - 1], glue, compress, bytes);
          }
          out += bytes;
          empty = false;
        }
        return empty && vals.length > 0 ? NULL : literal(out);
      });
    }
    case 'Branch':
      /*
       * [P38] A branch argument (`style(--x: @v): @c`) keeps its shape: the
       * condition and value are evaluated like any value, and the colon is the
       * branch's own syntax. An omitted value keeps the bare colon (`cond:`).
       */
      return combineAll([evalValueSlot(node.condition, frame, e), evalValueSlot(node.value, frame, e)], (parts) => {
        const condition = emitValueC(parts[0]!, e);
        const value = emitValueC(parts[1]!, e);
        return literal(value === '' ? `${condition}:` : `${condition}: ${value}`);
      });
    case 'Block': {
      /*
       * Less `~(...)` retains its typed inner value for list operations but
       * escapes the delimiters at emission time.
       */
      if (node.escaped) {
        return evalValueSlot(node.value, frame, e);
      }
      const computation = node.delimiter === 'paren' ? groupComputation(node, frame, e) : null;
      const ctx = node.delimiter === 'paren' ? { ...e, parenFrames: pushParenFrame(e, true) } : e;

      /* A `.jess` `$( … )` splice is read typed, so math it kept as written is still the kept expression. */
      const inner = computation !== null && computation.type === 'Interpolation' && e.ev
        ? evalTypedSlot(node.value, frame, ctx)
        : evalValueSlot(node.value, frame, ctx);

      /*
       * §12.6c: a bracketed value emits VERBATIM. Balanced `[ … ]` is a valid
       * CSS simple block in any declaration value (css-syntax-3), so the emitter
       * never rejects one — grid `<line-names>` validity (`'[' <custom-ident>* ']'`,
       * the one property-value grammar that gives `[ … ]` meaning) is a
       * PROPERTY-specific concern that belongs in the lint/diagnostic layer, not
       * here where the property is unknown.
       *
       * A paren group is consumed only by what computes in it
       * ({@link groupComputation}): `(1px + 2px)` is `3px`, while math `operate`
       * kept and a call written out as-is keep the parens
       * ({@link keepAuthoredGroup}), and so does every group nothing computes in.
       * Bytes from a call or an operation are what nothing computed — a call
       * re-emitted as written, math on the non-evaluating lane; a conditional or
       * a computed mixin argument computes to its bytes.
       */
      return mapMaybe(inner, (v) => {
        if (node.delimiter !== 'paren') {
          return isLiteral(v)
            ? literal(`${delimiterOpen(node.delimiter)}${v}${delimiterClose(node.delimiter)}`)
            : makeBlock(v, node.delimiter, node.escaped);
        }
        if (computation === null && e.reached === true && (e.calcDepth ?? 0) === 0 && groupsOneValue(node)) {
          return v;
        }
        if (isLiteral(v)) {
          return computation === null || !e.ev || computation.type === 'FunctionCall' || computation.type === 'Operation'
            ? literal(`(${v})`)
            : v;
        }
        return computation === null ? makeKeyword(`(${emitValue(v)})`) : keepAuthoredGroup(v);
      });
    }
    case 'Expression': {
      const unlowered = unloweredCall(node);
      if (unlowered !== null) {
        return evalCall(unlowered, frame, e, false);
      }

      /*
       * A `$( … )` COMPUTATION BOUNDARY opens the math context but owns no output
       * delimiters — the `$(` and `)` are the marker, not a value's syntax. It stays
       * transparent even when the inner folds to bytes, which an authored group does
       * not (`$(foo)` -> `foo`, but `$((foo))` -> `(foo)`). `exprBoundary` marks the
       * position for a value-position `Condition` (§7.1).
       */
      if (!e.ev && isAuthoredGroupExpression(node)) {
        /*
         * Not evaluated here (a preserved call re-emits its arguments), so the
         * boundary does not compute — and a boundary the author spelled as a
         * paren group (Less `(a + b)`, ledger P35) keeps its parens, or
         * `percentage((20 / 20))` and `(a + b) * c` would change meaning.
         */
        return mapMaybe(evalValueSlot(node.value, frame, e), v => literal(`(${emitValue(v)})`));
      }
      const computed = evalValueSlot(node.value, frame, { ...e, parenFrames: pushParenFrame(e, true), exprBoundary: true });
      return isAuthoredGroupExpression(node) ? mapMaybe(computed, keepAuthoredGroup) : computed;
    }
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

      /*
       * [P38] A query RELATION — `width > 600px`, `display: grid` — reaches a
       * value position only inside an `<if-test>` call (`media()`,
       * `supports()`, `style()`), where the query grammar built it. It is a
       * condition the browser evaluates, never math or a comparison to fold:
       * its operands are evaluated (a Less variable substitutes) and the
       * relation is emitted as written, spelled as a query prelude spells it.
       * A value comparison is a `Condition`, never an `Operation`.
       */
      if (isQueryRelation(node.operator)) {
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], values =>
          literal(`${emitValue(values[0]!)}${node.operator === ':' ? ': ' : ` ${node.operator} `}${emitValue(values[1]!)}`));
      }

      /*
       * [value] A `+`/`-` GLUED to a right-hand custom-ident (`5px auto
       * -webkit-focus-ring-color`) is a SIGN on that ident, not subtraction: the
       * parser splits the leading `-` off the keyword into an operator, but the
       * value is a space list whose last item is `-webkit-focus-ring-color`. Only
       * a keyword right operand reaches here glued — a glued numeric (`5px -3px`)
       * parses as a negative Dimension in a List, never an Operation. Non-numeric
       * operands would hit `operate`'s keyword-preserve guard anyway (which has no
       * source span and always spaces the operator); emit the authored glued form
       * here where the spans still exist. `namedColor` right operands stay on the
       * arithmetic path (V13 color coercion). ponytail: "glued" is span-width
       * (one authored space before the sign); a rare double-space before falls
       * back to the spaced form, which Less would collapse anyway.
       */
      if ((node.operator === '-' || node.operator === '+')
        && node.right.type === 'Keyword'
        && namedColor(node.right.src) === undefined
        && operationSignGlued(node)) {
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], values =>
          literal(`${emitValue(values[0]!)} ${node.operator}${emitValue(values[1]!)}`));
      }
      if (!e.ev) {
        // Fallback: un-evaluated, variable-resolved source assembly (no math).
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], values =>
          literal(`${emitValue(values[0]!)} ${node.operator} ${emitValue(values[1]!)}`));
      }

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
       * `node.mathOutsideParens` — the dialect's math policy, also decided at
       * parse (§12.6b) — says whether math happens with no enclosing context,
       * and if it does, `unitMode` decides whether a cross-unit pair folds,
       * preserves as `calc(…)`, or raises (§4.7).
       *
       * BOTH inputs are now node facts, which is the polarity AST v1 had
       * (`OperationOptions`, a parse-time record the evaluator branched on and
       * never re-derived). The ambient `e.modes.mathMode` read this line used
       * to make was the v2 regression: a dialect difference must be carried by
       * what the LOWERED NODE says, never by a mode the evaluator reads from
       * config — the rule that removed `equalityMode` (§5.1).
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
          || node.mathOutsideParens
          || (e.parenFrames?.at(-1) ?? false));
      if (!shouldOperate) {
        const l = evalValue(node.left, frame, e);
        const r = evalValue(node.right, frame, e);
        return combineAll([l, r], (values) => {
          const bytes = `${keptOperand(node, node.left, values[0]!, e)} ${node.operator} ${keptOperand(node, node.right, values[1]!, e)}`;

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
        const lv = spelledOperand(node.left, requireScalarValue(values[0]!, `operator ${node.operator}`), frame, e);
        const rv = spelledOperand(node.right, requireScalarValue(values[1]!, `operator ${node.operator}`), frame, e);
        try {
          return rememberUnitOwner(ev.operate(node.operator, lv, rv, m), node);
        } catch (error) {
          throwUnitArithmetic(error, node, e);
        }
      });
    }
    case 'FunctionCall':
      return evalCall(node, frame, e, false);
    case 'IfValue': {
      const unlowered = unloweredCall(node);
      if (unlowered !== null) {
        return evalCall(unlowered, frame, e, false);
      }

      /* An unmatched chain (`$if` with no `$else`, or Less `if(@c, a)`) is empty
       * bytes, exactly what an absent value emits. */
      return mapMaybe(pickIfValue(node, frame, e), taken => taken === undefined
        ? literal('')
        : evalValueSlot(taken, frame, e));
    }
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
       * An anonymous mixin reaching a value position is not byte-serializable:
       * it can only be *called* (`@dr()`), so it folds to empty bytes here. The
       * one position ruled otherwise is a function argument (ledger P37), which
       * the typed lane writes from the block's evaluated body
       * ({@link writtenRulesetArgument}).
       */
      return literal('');
    case 'Collection':
      return evalCollection(node, frame, e);
    case 'NestedPropertyBlock':
      return node.base === null ? literal('') : evalValueSlot(node.base, frame, e);
  }
}

/**
 * A {@link Collection} reaching a value/arg position — an SCSS map literal
 * (`$m: (a: 1, b: 2)`, lowered to a Collection at parse) passed to a function, or
 * the authorable Jess collection `$m: { a: 1; b: 2 }` — evaluates to the
 * value-domain map (`value-eval.ts` `Collection`). SCSS nested-property syntax
 * uses a distinct `NestedPropertyBlock`; it never projects structural entries
 * into this data-only value type.
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
 */
function evalCollectionEntries(
  node: Collection | AnonymousMixin,
  frame: Frame | null,
  e: EvalCtx,
  projectMixinValues = false
): MaybePromise<CollectionOverlay<ValueCollectionEntry>> {
  const entries = new CollectionOverlay<ValueCollectionEntry>();
  const addSpread = (spread: ValueGroup): void => {
    if (!isCollection(spread)) {
      const actual = isValueGroupArray(spread) ? 'sequence' : spread.type;
      throw new TypeError(`Collection spread expected Collection, got ${actual}`);
    }
    for (const entry of spread.entries) {
      entries.set(entry.key, entry);
    }
  };
  const addEntry = (important: boolean, key: ValueGroup, value: ValueGroup): void => {
    const entry: ValueCollectionEntry = important
      ? { key, value, important: true }
      : { key, value };
    entries.set(key, entry);
  };
  const run = (start: number): MaybePromise<CollectionOverlay<ValueCollectionEntry>> => {
    const source = node.type === 'AnonymousMixin' ? node.rules : node.entries;
    for (let index = start; index < source.length; index += 1) {
      const item = source[index]!;
      if (item.type === 'CollectionSpread') {
        if (!isValueSlotArray(item.value) && item.value.type === 'Collection') {
          const spreadEntries = evalCollectionEntries(item.value, frame, e, projectMixinValues);
          if (isThenable(spreadEntries)) {
            return spreadEntries.then((resolved) => {
              for (const entry of resolved.items) {
                entries.set(entry.key, entry);
              }
              return run(index + 1);
            });
          }
          for (const entry of spreadEntries.items) {
            entries.set(entry.key, entry);
          }
          continue;
        }
        const spread = evalTypedSlot(item.value, frame, e, projectMixinValues);
        if (isThenable(spread)) {
          return spread.then((resolved) => {
            addSpread(resolved);
            return run(index + 1);
          });
        }
        addSpread(spread);
        continue;
      }

      if (item.type !== 'CollectionEntry' && item.type !== 'Declaration' && item.type !== 'VariableDeclaration') {
        continue;
      }

      const valueSlot = item.value;
      const important = item.type === 'VariableDeclaration' ? false : item.important;
      const directKey = item.type === 'VariableDeclaration'
        ? makeKeyword(item.name)
        : item.type === 'Declaration' && typeof item.name === 'string'
          ? makeKeyword(item.name)
          : undefined;
      let key: MaybePromise<ValueGroup>;
      if (directKey !== undefined) {
        key = directKey;
      } else if (item.type === 'CollectionEntry') {
        key = evalTypedSlot(item.key, frame, e, projectMixinValues);
      } else if (item.type === 'Declaration') {
        key = typeof item.name === 'string'
          ? makeKeyword(item.name)
          : evalTypedSlot(item.name, frame, e, projectMixinValues);
      } else {
        key = makeKeyword(item.name);
      }
      if (isThenable(key)) {
        return key.then((resolvedKey) => {
          const value = isMixinCallValue(valueSlot)
            ? force(literal(''))
            : projectMixinValues && node.type === 'AnonymousMixin'
              && !isValueSlotArray(valueSlot) && valueSlot.type === 'AnonymousMixin'
              ? evalCollection(valueSlot, frame, e, true)
              : evalTypedSlot(valueSlot, frame, e, projectMixinValues);
          return mapMaybe(value, (resolvedValue) => {
            addEntry(important, resolvedKey, resolvedValue);
            return run(index + 1);
          });
        });
      }
      const value = isMixinCallValue(valueSlot)
        ? force(literal(''))
        : projectMixinValues && node.type === 'AnonymousMixin'
          && !isValueSlotArray(valueSlot) && valueSlot.type === 'AnonymousMixin'
          ? evalCollection(valueSlot, frame, e, true)
          : evalTypedSlot(valueSlot, frame, e, projectMixinValues);
      if (isThenable(value)) {
        return value.then((resolvedValue) => {
          addEntry(important, key, resolvedValue);
          return run(index + 1);
        });
      }
      addEntry(important, key, value);
    }
    return entries;
  };
  return run(0);
}

function evalCollection(
  node: Collection | AnonymousMixin,
  frame: Frame | null,
  e: EvalCtx,
  projectMixinValues = false
): MaybePromise<Value> {
  return mapMaybe(
    evalCollectionEntries(node, frame, e, projectMixinValues),
    resolved => makeCollection(resolved.items)
  );
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
  const lone = node.parts.length === 1 ? node.parts[0]! : undefined;
  const ei = lone !== undefined && 'ref' in lone && lone.ref.type === 'Expression' ? e : spliceCtx(e);
  const pieces: Array<MaybePromise<EvalValue>> = [];
  for (const part of node.parts) {
    pieces.push('lit' in part ? part.lit : part.unquote ? unquotedRef(part.ref, frame, ei) : evalValue(part.ref, frame, ei));
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
      bytes += emitSplice(value);
    }
    return elided && values.length > 0
      ? NULL
      : literal(resolveEmergentInterp(bytes, frame, ei));
  });
}

/**
 * [compress] The context an interpolation splice evaluates in. Spliced bytes
 * become part of a larger token — a selector, a string, a property name — and
 * folding them would change that token (`.s-@{c}` with `@c: #ffffff` is not
 * `.s-#fff`), so compressed output spells them exactly as pretty output does
 * (ledger O3: safe-only).
 */
function spliceCtx(e: EvalCtx): EvalCtx {
  return e.compress === true ? { ...e, compress: false, modes: { ...e.modes, compress: false } } : e;
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
 *
 * Why this reads bytes: its input is not parser output. An emergent token is
 * spliced together from evaluated values — `@box: ~"@{box"` + `-large}` in the
 * `strings` fixture's `weird` case — so no parse of the authored source holds
 * it; the parser's own `@{…}` parts were already resolved structurally above.
 * The nested authored form `@{box-@{suffix}}` could parse as a computed name,
 * but the spliced form would still need this pass.
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
          const bound = hit?.value;
          if (hit && bound !== undefined && !isMixinCallValue(bound)) {
            const val = hit.evaluated ?? withExcluded(e, bound, () => evalTypedSlot(bound, hit.frame, e, false, ARG_SPLICE));
            if (!isThenable(val)) {
              out += !isValueGroupArray(val) && val.type === 'Quoted' ? val.value : emitAsWritten(val);
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

/**
 * A ref an interpolation splices UNQUOTED (Less `@{name}`): a string is its
 * content, read from the typed string, and an escaped string already is its
 * content, which is never re-read for a quote (ledger V22). Any other value is
 * spliced as it is written in a declaration ({@link ARG_SPLICE}).
 */
function unquotedRef(ref: ValueNode, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  return mapMaybe(evalTyped(ref, frame, e, false, ARG_SPLICE), value =>
    !isValueGroupArray(value) && value.type === 'Quoted' ? literal(value.value) : value);
}

/** A spliced value's bytes: the declaration's, the authored layout between its items included ({@link ARG_SPLICE}). */
const emitSplice = (value: EvalValue): string => isLiteral(value) ? value : emitAsWritten(value);

/* --------------------------------------------------- map / namespace */

/** One resolved declaration in a map/namespace body (name → value in a frame). */
interface DeclEntry {
  name: string;
  value: Binding;
  frame: Frame | null;
  evaluated: ValueGroup | null;
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
  unified: boolean;
  valueEntries: CollectionOverlay<DeclEntry> | null;

  /**
   * [namespace-accessor] For a mixin-DISPATCH base (`#ns.m[@x]`), the callee's
   * evaluated scope frame(s) — a `@var` member is read lazily via `lookupVar` here,
   * because a mixin's local variables (and nested-call leaked vars) are NOT part of
   * its emitted-declaration output (`byVar` stays empty for this base kind). Frames
   * are in candidate/source order; last match wins (Less per-name last-declaration).
   */
  varFrames: Frame[] | null;

  /**
   * [module namespace] The activation a composed module's members live in. Its
   * `byVar` entries name the members (the module's own declarations); the one a
   * reference selects is then read in this activation ({@link activatedVarMember}).
   */
  activation: Frame | null;
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
      hit = {
        name, value: bound, frame: resolved.frame, evaluated: resolved.evaluated, important: false
      };
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
        hit = {
          name, value: resolved.value, frame: resolved.frame, evaluated: resolved.evaluated, important: false
        };
      }
    }
  }
  return hit;
}

/**
 * [loose-key] Value-equality rescan for a bracket key that no NAME matched.
 *
 * `byProp`/`byVar` are keyed by BYTE identity. That is the right O(1) fast path
 * and the wrong definition of "same key": `$foo[red]` and `$foo["red"]` name
 * the same member on string ground (§1). Lookup is LOOSE — the same `=` the
 * guards compare on — so a quoted key and the value it spells name the same
 * member. Numeric subscripts take P15's positional lane before this helper.
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
  e: EvalCtx,
  valueKey?: ValueGroup
): DeclEntry | undefined {
  /*
   * The key is the caller's typed key; a member NAME is an identifier the
   * parser read as a name. Neither is re-read from its bytes.
   */
  const wanted = valueKey ?? makeKeyword(key);
  if (map.valueEntries !== null) {
    return map.valueEntries.get(wanted);
  }
  const ev = e.ev;
  if (!ev) {
    return undefined;
  }
  const scan = (candidates: Map<string, DeclEntry>): DeclEntry | undefined => {
    for (const [name, entry] of candidates) {
      if (name !== key && ev.compare('=', makeKeyword(name), wanted, e.modes)) {
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
    return {
      name, value: prop.value, frame: prop.frame, evaluated: null, important: prop.important
    };
  }
  return variable === undefined
    ? undefined
    : {
        name, value: variable.value, frame: variable.frame,
        evaluated: variable.evaluated, important: false
      };
}

/** Collect a body's declarations into name→value maps (+ ordered list). */
function evalToDeclMap(statements: Statement[], frame: Frame | null, e: EvalCtx, activation: Frame | null = null): DeclMap {
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
      const entry: DeclEntry = {
        name, value: s.value, frame, evaluated: null, important: s.important
      };
      byProp.set(name, entry); // last-wins
      list.push(entry);
    } else if (s.type === 'VariableDeclaration') {
      const entry: DeclEntry = {
        name: s.name, value: s.value, frame, evaluated: null, important: false
      };
      byVar.set(s.name, entry); // last-wins
      list.push(entry);
    }
  }
  return { byVar, byProp, list, unified: false, valueEntries: null, varFrames: null, activation };
}

/**
 * A composed module's variable member: whatever the module's activation binds
 * the name to — configuration overlay, nested `@import` facts and later writes
 * included (spec R6 §E.1) — never the authored value re-read. The store it is
 * read through is {@link memberLookup}'s.
 */
function activatedVarMember(activation: Frame, name: string, e: EvalCtx): DeclEntry | undefined {
  const bound = resolveVarRef(activation, name, memberLookup(activation, name), e);
  return bound === undefined
    ? undefined
    : { name, value: bound.value, frame: bound.frame, evaluated: bound.evaluated, important: false };
}

/**
 * The store a composed module's member is read through. A name the module
 * writes conditionally or reassigns through the live store (`$x ?: v`,
 * `$x := v`, `!default`) is a live variable, read from the activation's final
 * cell, which a configuration seeds and a later hard write replaces. Every
 * other name is read through the scoped store, where a configuration overlays
 * the declared binding. For a plain declaration both stores agree.
 */
function memberLookup(activation: Frame, name: string): VariableLookup {
  for (const declaration of activation.declIndex?.byName.get(name) ?? []) {
    if (declaration.write.mode !== 'declare' && declaration.write.scope === 'live') {
      return 'live';
    }
  }
  return 'scoped';
}

function valueCollectionToDeclMap(value: ValueCollection, parent: Frame | null): DeclMap {
  const valueEntries = new CollectionOverlay<DeclEntry>();
  const valueFrame: Frame = {
    parent,
    mixins: null,
    declIndex: collectDeclIndex([]),
    cells: null,
    reassign: null
  };
  for (const entry of value.entries) {
    const name = isValueGroupArray(entry.key)
      ? ''
      : entry.key.type === 'Quoted' ? entry.key.value : entry.key.bytes;
    const mapped: DeclEntry = {
      name,
      value: EVALUATED_BINDING,
      frame: valueFrame,
      evaluated: entry.value,
      important: entry.important === true
    };
    valueEntries.set(entry.key, mapped);
  }
  return {
    byVar: new Map(),
    byProp: new Map(),
    list: valueEntries.items,
    unified: true,
    valueEntries,
    varFrames: null,
    activation: null
  };
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
/*
 * [lookup-memo] Negative control: `JESS_NO_DECLMAP_MEMO=1` disables the member-lookup
 * DeclMap memo so a measurement can reproduce the un-memoized rebuild/dispatch counts.
 */
const DECLMAP_MEMO_ENABLED = typeof process === 'undefined' || process.env?.JESS_NO_DECLMAP_MEMO !== '1';

/**
 * [lookup-memo] Cache a PURE base's DeclMap on the resolving frame, keyed by the base
 * node identity, so a repeated `BASE[member]` on the same binding does not rebuild the
 * index per access. Applied ONLY to the pure builders (collection / namespace-selector /
 * detached-ruleset body) — never a mixin-call dispatch, which mutates the caller frame.
 * Stores only when no alias cycle is being resolved (`e.excluded` empty), so a computed
 * key that referenced an actively-excluded alias is never cached, and never caches a
 * `null` (a not-yet-published base may resolve later). See
 * `docs/design/MIXIN-SCOPING-AND-LOOKUP-MEMO.md` §4.
 */
function memoPureDeclMap(base: object, frame: Frame | null, e: EvalCtx, build: () => DeclMap | null): DeclMap | null {
  if (!DECLMAP_MEMO_ENABLED || !frame) {
    return build();
  }
  const hit = frame.declMapMemo?.get(base);
  if (hit) {
    return hit;
  }
  const built = build();
  if (built !== null && e.excluded.size === 0) {
    (frame.declMapMemo ??= new Map()).set(base, built);
  }
  return built;
}

function resolveBaseDeclMap(
  base: Binding,
  frame: Frame | null,
  e: EvalCtx,
  evaluated: ValueGroup | null = null
): DeclMap | null {
  if (isValueSlotArray(base)) {
    return null;
  }
  if (evaluated !== null && isCollection(evaluated)) {
    return memoPureDeclMap(evaluated, frame, e, () => valueCollectionToDeclMap(evaluated, frame));
  }
  if (base.type === 'Reference') {
    const resolved = resolveReferenceResult(base, frame, e);
    return resolved === null
      ? null
      : resolveBaseDeclMap(resolved.value, resolved.frame, e, resolved.evaluated);
  }
  if (base.type === 'Collection') {
    return memoPureDeclMap(base, frame, e, () => {
      const resolved = evalCollection(base, frame, e, true);
      if (isThenable(resolved)) {
        observeRejectedThenable(resolved);
        throw ERR.asyncInSyncPosition({
          node: base,
          ...callSiteLocation(base, e),
          meta: { where: 'collection member lookup' }
        });
      }
      if (!isCollection(resolved)) {
        throw new TypeError('Collection evaluation did not produce a Collection value');
      }
      return valueCollectionToDeclMap(resolved, frame);
    });
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
    return memoPureDeclMap(base, frame, e, () => {
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
    });
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
    /*
     * A composed module's namespace reads its members in the module's own
     * activation, never a second one, and builds that member map once per
     * activation however many compose edges and importers share it.
     * ponytail: the member map is O(own members), built once per activation
     * that is read; a per-name occurrence read needs the activation's declIndex
     * to tell the module's own declarations from facts published into it.
     */
    const module = composedModuleFrame(rs.rules, rs.frame);
    if (module !== null) {
      return memoPureDeclMap(rs.rules, module, e, () => evalToDeclMap(rs.rules, module, e, module));
    }
    return memoPureDeclMap(base, frame, e, () => {
      const bodyFrame: Frame = {
        parent: rs.frame,
        mixins: collectMixins(rs.rules),
        declIndex: collectDeclIndex(rs.rules), cells: null, reassign: null
      };
      return evalToDeclMap(rs.rules, bodyFrame, e);
    });
  }

  /*
   * A base `@var` bound to a mixin CALL (`@p: .mk-map(); @p[text]`): dispatch the
   * call and treat its EMITTED declarations as the map (the same reconstruction the
   * `each(.mixin(), …)` iterable uses — `forItemsFromMixinCall`).
   */
  if (base.type === 'Lookup' && base.kind === 'var' && frame) {
    const bound = lookupVar(frame, literalName(base), e);
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
      evaluated: null,
      important: leaf.important === true || (n.type === 'Declaration' && n.important)
    };
    into.set(name, entry);
    list.push(entry);
  }
  return { byVar, byProp, list, unified: false, valueEntries: null, varFrames, activation: null };
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
    type: 'MixinDefinition', name: '', params: lambda.params ?? [], rules: lambda.rules, extendInstructions: undefined,

    /* a synthetic lambda wrapper carries no source position of its own */
    _s: NO_SPAN, _e: NO_SPAN, _bs: NO_SPAN, _be: NO_SPAN
  };
  const call: MixinCall = { type: 'MixinCall', name: '', args, path: [], important: false, content: null, _s: NO_SPAN, _e: NO_SPAN };
  const resolveCaller = makeResolver(callerFrame, e);
  const resolveDefault: DefaultResolver = (v, boundSoFar) => {
    const overlay: Frame = { parent: defFrame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    const b = eagerSnapshot(v, overlay, e);
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
  const preparedArgs = callerFrame ? substituteClosureVarArgs(call, callerFrame, e, false) : call;
  const boundArgs = bindArgs(
    syntheticDef,
    preparedArgs,
    resolveCaller,
    resolveDefault,
    eagerSources(callerFrame, e)
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
    ...(callerFrame && callerFrame !== defFrame ? { fallback: callerFrame, callerFallback: true } : {})
  };
  return { value: result, frame: activation };
}

/** `statementCall`: the reference is a statement-position call ({@link rejectComposedMemberCall}). */
function resolveReferenceResult(
  node: Reference,
  frame: Frame | null,
  e: EvalCtx,
  statementCall = false
): {
  value: ValueSlot | MixinCall;
  frame: Frame | null;
  evaluated: ValueGroup | null;
  sourceOwner: object | null;
} | null {
  let value: ValueSlot | MixinCall = node.base;
  let valueFrame = frame;
  let evaluated: ValueGroup | null = null;
  let sourceOwner = frame?.sourceOwner ?? null;
  let stepIndex = 0;
  if (
    e.moduleReferenceValues !== undefined
    && !isValueSlotArray(value)
    && value.type === 'Lookup'
    && value.kind === 'entry'
    && node.steps.length > 0
  ) {
    const namespaceStep = node.steps[0]!;
    if (namespaceStep.type === 'LookupStep' && typeof namespaceStep.name === 'string') {
      const binding = resolveVarRef(frame, namespaceStep.name, 'live', e)
        ?? resolveVarRef(frame, namespaceStep.name, 'scoped', e);
      if (
        binding !== undefined
        && !isValueSlotArray(binding.value)
        && e.moduleReferenceValues.get(binding.value) === null
      ) {
        value = binding.value;
        valueFrame = binding.frame;
        evaluated = binding.evaluated;
        stepIndex = 1;
      }
    }
  }
  if (stepIndex === 0 && !isValueSlotArray(value) && value.type === 'Lookup' && value.kind === 'var') {
    if (typeof value.name !== 'string') {
      return null;
    }
    const resolved = resolveVarRef(valueFrame, value.name, value.scope, e);
    if (!resolved) {
      return null;
    }
    value = resolved.value;
    valueFrame = resolved.frame;
    evaluated = resolved.evaluated;
    sourceOwner = detachedBinding(valueFrame, value)?.sourceOwner
      ?? sourceOwnerForBody(!isValueSlotArray(value) && isValueBlock(value) ? valueBlockBody(value) : value, valueFrame, e);
  }
  for (; stepIndex < node.steps.length; stepIndex++) {
    const step = node.steps[stepIndex]!;
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
      evaluated = matched.evaluated;
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
          if (typeof value.name !== 'string') {
            break;
          }
          const name = value.name;
          const scope = value.scope;

          /* Exclude the alias currently being followed so `@call: @call`
           * reaches its prior parameter binding instead of selecting itself. */
          const alias = value;
          const aliasWasExcluded = e.excluded.has(alias);
          if (!aliasWasExcluded) {
            e.excluded.add(alias);
          }
          const aliased = resolveVarRef(valueFrame, name, scope, e);
          if (!aliasWasExcluded) {
            e.excluded.delete(alias);
          }
          if (!aliased) {
            break;
          }
          value = aliased.value;
          valueFrame = aliased.frame;
          evaluated = aliased.evaluated;
          continue;
        }
        if (value.type === 'Reference') {
          const aliased = resolveReferenceResult(value, valueFrame, e);
          if (!aliased) {
            break;
          }
          value = aliased.value;
          valueFrame = aliased.frame;
          evaluated = aliased.evaluated;
          sourceOwner = aliased.sourceOwner ?? sourceOwner;
          continue;
        }
        break;
      }
      if (!isValueSlotArray(value) && value.type === 'AnonymousMixin'
        && lambdaResultValue(value.rules) !== undefined) {
        /*
         * Only a value lambda (a body that yields `result:`) invokes here. A
         * params-carrying block WITHOUT a `result:` is a `using (…)` content
         * block — a ruleset body spliced with its args bound to those params at
         * the STATEMENT level (`expandReferenceCall`), never a value. Invoking it
         * as a lambda threw `invalidFunction` (its body assigns no `result:`).
         */
        const invoked = invokeValueLambda(value, step.args, valueFrame, frame, e);
        if (invoked === null) {
          return null;
        }
        value = invoked.value;
        valueFrame = invoked.frame;
        evaluated = null;
      }
      continue;
    }
    const evaluatedItems = evaluated === null
      ? null
      : isValueGroupArray(evaluated)
        ? evaluated
        : evaluated.type === 'List' ? evaluated.value : null;
    if (step.type === 'LookupStep' && typeof step.name !== 'string' && step.kind === 'index' && typeof step.name === 'number'
      && (evaluatedItems !== null || isValueSlotArray(value)
        || (!isValueSlotArray(value) && (value.type === 'List' || value.type === 'Sequence')))) {
      if (evaluatedItems !== null) {
        const index = step.name < 0
          ? evaluatedItems.length + step.name
          : step.indexBase === 0 ? step.name : step.name - 1;
        const item = evaluatedItems[index];
        if (item === undefined) {
          return null;
        }
        value = EVALUATED_BINDING;
        evaluated = item;
        continue;
      }
      let items: readonly ValueSlot[];
      if (isValueSlotArray(value)) {
        items = value;
      } else if (value.type === 'List') {
        items = value.value;
      } else if (value.type === 'Sequence') {
        items = value.parts;
      } else {
        return null;
      }
      const index = step.name < 0
        ? items.length + step.name
        : step.indexBase === 0 ? step.name : step.name - 1;
      const item = items[index];
      if (item === undefined) {
        return null;
      }
      value = item;
      evaluated = null;
      continue;
    }
    if (isValueSlotArray(value)) {
      return null;
    }
    const map = resolveBaseDeclMap(value, valueFrame, e, evaluated);
    if (!map) {
      return null;
    }

    /*
     * Ledger A8: `.name(args)` on a `@compose` namespace in STATEMENT position is
     * a call of the module's `.name` mixin, dispatched in the module's own
     * activation (its definitions and bindings), exactly like a namespaced
     * `#ns.name()` call. Decided on the activation's mixin table before any
     * member lookup, so the call never pays a scan of the module's members. The
     * Call step that follows is consumed here: its args are the call's, and the
     * call carries the reference's span for its diagnostics.
     */
    if (statementCall && map.activation !== null && step.type === 'LookupStep' && step.kind === 'member'
      && typeof step.name === 'string') {
      const call = node.steps[stepIndex + 1];
      const name = `.${step.name}`;
      if (call?.type === 'Call' && map.activation.mixins?.has(name)) {
        value = {
          type: 'MixinCall', name, args: call.args, path: [], important: false, content: null,
          _s: node._s, _e: node._e
        };
        valueFrame = map.activation;
        evaluated = null;
        stepIndex++;
        continue;
      }
    }
    let matched: DeclEntry | undefined;
    let missingSymbol = node.raw;

    /*
     * [loose-key] The KEY a value-equality rescan would use, captured by the
     * name-keyed branches only. See {@link looseMemberLookup} — this is the
     * fallback arm of a fast path, not a replacement for it.
     */
    let looseKey: string | undefined;
    let looseValueKey: ValueGroup | undefined;
    let looseKind: 'var' | 'prop' | 'member' | undefined;
    if (step.type === 'LookupStep' && typeof step.name === 'string') {
      missingSymbol = step.name;
      looseKey = step.name;
      looseValueKey = makeKeyword(step.name);
      looseKind = 'member';
      const prop = map.valueEntries === null
        ? map.byProp.get(step.name)
        : map.valueEntries.get(looseValueKey);
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
        const name = syncValue(lookupName(step.name, frame ?? valueFrame, e), step.name, e, 'map member name');
        missingSymbol = `@${name}`;
        matched = map.valueEntries?.get(makeKeyword(name))
          ?? mapForKind(map, 'var').get(name)
          ?? lookupVarMember(map, name, e);
      } else if (step.kind === 'prop' && typeof step.name === 'object' && step.name.type === 'Lookup'
        && step.name.kind === 'prop' && typeof step.name.name === 'string') {
        const propKey = step.name.name;
        missingSymbol = `$${propKey}`;

        /*
         * In a map bracket, `$name` selects the property member named `name`.
         * It is not a `$name` read from the caller's declaration timeline.
         */
        matched = map.byProp.get(propKey);
      } else if (typeof step.name === 'object') {
        const evaluatedKey = evalTypedSlot(step.name, valueFrame, e, true);
        if (isThenable(evaluatedKey)) {
          observeRejectedThenable(evaluatedKey);
          throw ERR.asyncInSyncPosition({
            node: step.name,
            ...callSiteLocation(step.name, e),
            meta: { where: 'collection member key' }
          });
        }
        looseValueKey = evaluatedKey;
        looseKind = step.kind === 'member' ? 'member' : step.kind === 'prop' ? 'prop' : 'var';
        let key: string | undefined;
        if (!isValueGroupArray(evaluatedKey) && evaluatedKey.type === 'Dimension') {
          /* P15: a computed numeric subscript is positional before receiver
           * dispatch. Numeric Collection keys remain reachable only through
           * map.get(); they must never win merely because this map has one. */
          key = emitValue(evaluatedKey);
          missingSymbol = step.kind === 'var'
            ? `@${key}`
            : step.kind === 'prop' ? `$${key}` : key;
          const indexBase = step.indexBase ?? 1;
          if (evaluatedKey.unit === '' && Number.isInteger(evaluatedKey.number)
            && (evaluatedKey.number !== 0 || indexBase === 0)) {
            const index = evaluatedKey.number;
            matched = map.list[index < 0 ? map.list.length + index : index - indexBase];
          }
          looseValueKey = undefined;
          looseKind = undefined;
        } else if (map.valueEntries !== null) {
          matched = map.valueEntries.get(evaluatedKey);
        } else {
          key = emitValue(evaluatedKey);
          looseKey = key;
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
        }
        if (matched === undefined && key === undefined) {
          key = emitValue(evaluatedKey);
          missingSymbol = step.kind === 'var'
            ? `@${key}`
            : step.kind === 'prop' ? `$${key}` : key;
        } else if (matched === undefined && key !== undefined) {
          missingSymbol = step.kind === 'var'
            ? `@${key}`
            : step.kind === 'prop' ? `$${key}` : key;
        }
      }
    } else {
      if (typeof step.name !== 'number') {
        return null;
      }
      const idx = step.name;
      const i = idx < 0 ? map.list.length + idx : idx - (step.indexBase ?? 1);
      matched = map.list[i] ?? (idx === -1 && map.list.length === 0 ? lastVarMember(map, e) : undefined);
      if (!matched) {
        return null;
      }
    }
    if (!matched && looseKey !== undefined && looseKind !== undefined) {
      matched = looseMemberLookup(map, looseKey, looseKind, e, looseValueKey);
    }
    if (map.activation !== null) {
      if (matched && map.byVar.get(matched.name) === matched) {
        matched = activatedVarMember(map.activation, matched.name, e);
      }
      if (!statementCall && node.steps[stepIndex + 1]?.type === 'Call') {
        rejectComposedMemberCall(node, matched, missingSymbol);
      }
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
    evaluated = matched.evaluated;
  }
  return { value, frame: valueFrame, evaluated, sourceOwner };
}

function moduleReferenceCall(
  node: Reference,
  frame: Frame | null,
  e: EvalCtx
): { name: string; call: ReferenceCall; fn: Fn } | undefined {
  const moduleValues = e.moduleReferenceValues;
  if (moduleValues === undefined || isValueSlotArray(node.base) || node.base.type !== 'Lookup') {
    return undefined;
  }
  let name: string;
  let stepIndex: number;
  let resolved: BindingHit | undefined;
  if (node.base.kind === 'var' && typeof node.base.name === 'string') {
    name = node.base.name;
    stepIndex = 0;
    resolved = resolveVarRef(frame, node.base.name, node.base.scope, e);
  } else if (node.base.kind === 'entry' && node.steps.length > 0) {
    const namespaceStep = node.steps[0]!;
    if (namespaceStep.type !== 'LookupStep' || typeof namespaceStep.name !== 'string') {
      return undefined;
    }
    name = namespaceStep.name;
    stepIndex = 1;
    resolved = resolveVarRef(frame, name, 'live', e)
      ?? resolveVarRef(frame, name, 'scoped', e);
  } else {
    return undefined;
  }
  if (!resolved || isValueSlotArray(resolved.value)) {
    return undefined;
  }

  const importedPath = moduleValues.get(resolved.value);
  if (importedPath === undefined) {
    return undefined;
  }
  if (importedPath !== null) {
    if (node.steps.length !== 1 || node.steps[0]?.type !== 'Call') {
      return undefined;
    }
    const fn = lookupModuleFunction(frame, importedPath);
    return fn === undefined ? undefined : { name: importedPath, call: node.steps[0], fn };
  }

  if (node.steps.length - stepIndex < 2) {
    return undefined;
  }
  const call = node.steps[node.steps.length - 1]!;
  if (call.type !== 'Call') {
    return undefined;
  }
  for (; stepIndex < node.steps.length - 1; stepIndex++) {
    const step = node.steps[stepIndex]!;
    if (step.type !== 'LookupStep' || typeof step.name !== 'string') {
      return undefined;
    }
    name += `.${step.name}`;
  }
  const lowerName = name.toLowerCase();
  const fn = lookupModuleFunction(frame, lowerName);
  return fn === undefined ? undefined : { name, call, fn };
}

function evalModuleReferenceCall(
  node: Reference,
  frame: Frame | null,
  e: EvalCtx
): MaybePromise<EvalValue> | undefined {
  const selected = moduleReferenceCall(node, frame, e);
  if (selected === undefined) {
    return undefined;
  }
  const args: CallArg<ValueSlot>[] = [];
  for (const arg of selected.call.args) {
    if (isMixinCallValue(arg.value)) {
      throw new TypeError(`Module function "${selected.name}" cannot receive a mixin call argument.`);
    }
    args.push(callArg(arg.value, arg.name, arg.spread, arg.sigil));
  }
  if (!e.ev) {
    return literal(node.raw);
  }

  /*
   * Carries the reference's span (its head's, where only the head has one), so
   * a failure is named where the call was written.
   */
  const call = funcCall(selected.name, args);
  const written = sourceStartOf(node) === NO_SPAN && !isValueSlotArray(node.base) ? node.base : node;
  call._s = sourceStartOf(written);
  call._e = sourceEndOf(written);
  return dispatchCall(call, frame, e, e.ev, selected.fn, false, true);
}

/**
 * A value reference that resolved to nothing is a failed resolution: an eval
 * error unless the read is optional, which gets its authored text as the
 * sentinel. The error names an unbound head by itself, as it was written
 * (`@nope`, `$nope`, `$^nope`), and any other unresolvable chain (`@list[5]`,
 * a member of a memberless value) whole. It is placed at the reference, or at
 * its head when only the head carries a source span.
 */
function unresolvedReference(node: Reference, frame: Frame | null, e: EvalCtx): EvalValue {
  if (!e.optional) {
    const base = node.base;
    let symbol = node.raw;
    if (!isValueSlotArray(base) && base.type === 'Lookup' && base.kind === 'var'
      && typeof base.name === 'string' && resolveVarRef(frame, base.name, base.scope, e) === undefined) {
      symbol = node.raw.slice(0, node.raw.indexOf(base.name) + base.name.length);
    }
    unresolvedSymbol(sourceStartOf(node) === NO_SPAN && !isValueSlotArray(base) ? base : node, symbol, e);
  }
  return literal(node.raw);
}

function evalReference(node: Reference, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  const moduleCall = evalModuleReferenceCall(node, frame, e);
  if (moduleCall !== undefined) {
    return moduleCall;
  }
  const resolved = resolveReferenceResult(node, frame, e);
  if (resolved === null) {
    return unresolvedReference(node, frame, e);
  }
  return isMixinCallValue(resolved.value)
    ? literal(node.raw)
    : resolved.evaluated ?? evalValueSlot(resolved.value, resolved.frame, e);
}

/**
 * Follow a `@var` → … → `@var` binding chain to the concrete value node it names
 * (non-throwing; stops at the first non-`VariableReference`). Returns `undefined` if any link
 * is unbound. Used by the detached-ruleset introspection functions, which must
 * inspect the BINDING (a value-block node) rather than materialize it.
 */
function resolveBindingNode(node: Binding, frame: Frame | null, e?: EvalCtx): Binding | undefined {
  let cur: Binding | undefined = node;
  const seen = new Set<Binding>();
  while (cur !== undefined && !isValueSlotArray(cur) && cur.type === 'Lookup' && cur.kind === 'var') {
    if (seen.has(cur)) {
      return undefined;
    } // cyclic
    seen.add(cur);
    cur = lookupVar(frame, literalName(cur), e);
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
function evalIntrospection(node: FunctionCall, frame: Frame | null, e: EvalCtx): EvalValue | undefined {
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
      ? resolveBindingNode(arg, frame, e)
      : arg;
    return literal(bound !== undefined ? 'true' : 'false');
  }
  if (node.name === 'isruleset') {
    const bound = resolveBindingNode(arg, frame, e);
    return literal(bound !== undefined && !isValueSlotArray(bound) && isValueBlock(bound)
      ? 'true'
      : 'false');
  }
  return undefined;
}

/**
 * `calc(…)` fold: evaluate the single argument in calc mode, then decide the
 * wrapper. A cross-unit sub-expression arrives already `calc(…)`-wrapped (kept
 * as-is); a preserved non-calc keyword op (`100% - 3`) is wrapped; a fully
 * computed value (`10px * 2` → `20px`) drops the wrapper (less.js `calc()`
 * collapse to a bare Dimension). An argument written as a paren group around
 * one value keeps its parens and so its wrapper ({@link unconsumedParens}): a
 * dimension carries them as its spelling (`calc((10vh))` is `10vh` spelled
 * `(10vh)`), so every position prints the same bytes and a typed consumer still
 * reads `10vh`; any other value is the kept `calc(…)` expression. A kept
 * `calc(…)` is written out as-is, so a group around it keeps its parens
 * ({@link groupComputation}).
 */
function evalCalc(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  const ce: EvalCtx = { ...e, calcDepth: (e.calcDepth ?? 0) + 1 };
  const arg = node.args[0]!.value;
  const authored = unconsumedParens(arg);
  return mapMaybe(evalTypedSlot(arg, frame, ce), (v) => {
    if (authored > 0) {
      if (!isValueGroupArray(v) && v.type === 'Dimension') {
        return makeSpelledDimension(v, wrapParens(v.preserved ?? v.bytes, authored));
      }

      /* Kept math carries the groups around it in its arithmetic already (`calc((@x))` is `calc((1px + 1em))`). */
      const kept = isValueGroupArray(v) ? undefined : keptMathOf(v);
      return keepAsWritten(makeKeyword(`calc(${kept ?? wrapParens(emitValue(v), authored)})`));
    }
    if (!isValueGroupArray(v) && v.type === 'Keyword') {
      return calcInner(v.bytes) !== null ? writtenCalc(v) : keepAsWritten(makeKeyword(`calc(${v.bytes})`));
    }

    /*
     * `calc(x)` drops its wrapper only when `x` resolved to ONE value. A list
     * (`calc(@v)` with `@v: 50vh/2`, a slash list under the default math mode)
     * or a space run is not a `<calc-sum>` result, so unwrapping it would emit
     * `50vh / 2` as the property value — no longer a calculation at all.
     */
    if (isValueGroupArray(v) || v.type === 'List') {
      return keepAsWritten(makeKeyword(`calc(${emitValueC(v, e)})`));
    }
    return v;
  });
}

function shouldPreserveCssAuthoredCall(node: FunctionCall, lessDocument: boolean): boolean {
  return lessDocument && isCssColorCall(node);
}

/**
 * Re-emit a call after resolving variable/interpolation bytes, without invoking
 * its callable: an F5 color call and every call on the non-evaluating byte
 * lane. Each argument is written as authored, keyword included
 * ({@link writtenArgument}, ledger P23).
 */
function preserveCall(node: FunctionCall, frame: Frame | null, e: EvalCtx): MaybePromise<EvalValue> {
  if (node.args.length === 0) {
    return literal(`${node.name}()`);
  }

  /*
   * An F5 color call (and the non-evaluating byte lane) retains literal
   * spellings (`.5`, hue units) exactly: typed literal canonicalization is off
   * for its arguments; variable references still resolve through the same live
   * frame walk, and a condition is still decided in the evaluating context
   * ({@link EvalCtx.writtenFrom}).
   */
  const preserve = e.ev ? { ...e, ev: null, writtenFrom: e } : e;
  const items = node.args.map(a => evalValueSlot(a.value, frame, preserve));
  return combineAll(items, (vals) => {
    const authored = valueLayoutOf(node.args);
    const compress = e.compress === true;

    /*
     * Comma spacing is minimal-correctness normalized to one space after the
     * comma (owner rule 2026-08-17) — it is NOT authorship.
     */
    const glue = node.modern ? ' ' : sepGlue(',', compress);
    let inner = writtenArgument(node.args[0]!, emitValueC(vals[0]!, e), compress);
    for (let index = 1; index < vals.length; index += 1) {
      inner += itemBoundary(authored?.[index - 1], glue, compress);
      inner += writtenArgument(node.args[index]!, emitValueC(vals[index]!, e), compress);
    }
    return literal(`${node.name}(${inner})`);
  });
}

/**
 * [P36] The call a grammar lowered into `node`, when the document it was
 * written in has no ambient built-ins — `null` when the lowered form stands.
 * Less lowers `if()`/`boolean()`/`each()` into structure only in legacy mode;
 * a later `@use` decides that, so the decision is read here, at evaluation.
 * The call returned is evaluated like any other: `evalCall`, which finds no
 * ambient built-in and takes the unknown-call path.
 */
function unloweredCall(node: AuthoredCallSlot): FunctionCall | null {
  const call = node._asCall;
  return call !== null && !hasAmbientFunctions(call) ? call : null;
}

/** Guard-eval deps sourced from an evaluation context (a value-position condition,
 *  like a CSS ruleset guard, never depends on a mixin `default()` decision). A
 *  condition on the written lane of an F5 call is decided in the context that
 *  lane came from ({@link EvalCtx.writtenFrom}). */
function guardDeps(frame: Frame | null, e: EvalCtx): {
  resolveTyped: TypedResolver; ev: ValueEvaluator | null; modes: EvalModes; isDefault: () => boolean;
} {
  const decide = e.writtenFrom ?? e;
  return { resolveTyped: makeTypedResolver(frame, decide), ev: decide.ev, modes: decide.modes, isDefault: () => false };
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

/** Classify one binding root structurally and cache that render-local decision. */
function pluginRawRoot(value: Binding, e: EvalCtx): Binding | null {
  let typed = e.pluginRawBindings?.get(value);
  if (typed === undefined) {
    typed = isTypedCallValue(value) ? value : null;
    (e.pluginRawBindings ??= new Map()).set(value, typed);
  }
  return typed;
}

const MIXIN_VALUE_NONE = 0;
const MIXIN_VALUE_CANONICAL = 1;
const MIXIN_VALUE_AUTHORED = 2;
const MIXIN_VALUE_DYNAMIC = 3;
type MixinValueSourceMode = typeof MIXIN_VALUE_NONE | typeof MIXIN_VALUE_CANONICAL | typeof MIXIN_VALUE_AUTHORED;
type MixinValuePartMode = MixinValueSourceMode | typeof MIXIN_VALUE_DYNAMIC;

interface MixinValueSources {
  readonly valueSource: CallValue;
  readonly valueSourceMode: Exclude<MixinValueSourceMode, typeof MIXIN_VALUE_NONE>;
  readonly additionalValueSources: ReadonlyMap<CallValue, Exclude<MixinValueSourceMode, typeof MIXIN_VALUE_NONE>> | null;
}

type MixinValueHit = BindingHit | undefined;

/** Whether an alias to this typed source needs a parallel structural fact. */
function valueSlotRequiresAliasCarrier(value: ValueSlot): boolean {
  return isValueSlotArray(value) || value.type === 'Url'
    || value.type === 'List' || value.type === 'Sequence';
}

/** Classify one source subtree in one pass, including scalar dynamic leaves. */
function classifyMixinValuePart(source: CallValue, frame: Frame, e: EvalCtx): MixinValuePartMode {
  if (isMixinCallValue(source) || (!isValueSlotArray(source) && isValueBlock(source))) {
    return MIXIN_VALUE_NONE;
  }
  if (!isValueSlotArray(source)
    && (frame.mixinValueBindings?.has(source) === true || e.mixinValueBindings?.has(source) === true
      || frame.mixinUrlBindings?.has(source) === true || e.mixinUrlBindings?.has(source) === true)) {
    return MIXIN_VALUE_AUTHORED;
  }
  if (!isValueSlotArray(source) && source.type === 'Url') {
    return MIXIN_VALUE_AUTHORED;
  }
  if (isValueSlotArray(source)) {
    let dynamic = false;
    for (const item of source) {
      const mode = classifyMixinValuePart(item, frame, e);
      if (mode === MIXIN_VALUE_CANONICAL) {
        return MIXIN_VALUE_CANONICAL;
      }
      dynamic ||= mode !== MIXIN_VALUE_NONE;
    }
    return dynamic ? MIXIN_VALUE_AUTHORED : MIXIN_VALUE_NONE;
  }
  if (source.type === 'FunctionCall' || source.type === 'IfValue' || source.type === 'Reference') {
    return MIXIN_VALUE_CANONICAL;
  }
  if (source.type === 'List' || source.type === 'Sequence') {
    const items = source.type === 'List' ? source.value : source.parts;
    let dynamic = false;
    for (const item of items) {
      const mode = classifyMixinValuePart(item, frame, e);
      if (mode === MIXIN_VALUE_CANONICAL) {
        return MIXIN_VALUE_CANONICAL;
      }
      dynamic ||= mode !== MIXIN_VALUE_NONE;
    }
    return dynamic ? MIXIN_VALUE_AUTHORED : MIXIN_VALUE_NONE;
  }
  if (source.type === 'Block' || source.type === 'Expression') {
    return classifyMixinValuePart(source.value, frame, e);
  }
  if (source.type !== 'Lookup') {
    return MIXIN_VALUE_NONE;
  }
  if (source.kind !== 'var' || typeof source.name !== 'string') {
    return MIXIN_VALUE_CANONICAL;
  }
  return classifyMixinValueHit(resolveVarRef(frame, source.name, source.scope, e), e);
}

/** Classify one already-resolved variable root without repeating its scope walk. */
function classifyMixinValueHit(hit: MixinValueHit, e: EvalCtx): MixinValuePartMode {
  if (hit?.evaluated !== null && hit?.evaluated !== undefined) {
    return MIXIN_VALUE_CANONICAL;
  }
  if (!hit || isMixinCallValue(hit.value)
    || (!isValueSlotArray(hit.value) && isValueBlock(hit.value))) {
    return MIXIN_VALUE_NONE;
  }
  const mode = withExcluded(e, hit.value, () => classifyMixinValuePart(hit.value, hit.frame, e));
  if (mode !== MIXIN_VALUE_NONE) {
    return mode;
  }
  return valueSlotRequiresAliasCarrier(hit.value)
    ? MIXIN_VALUE_AUTHORED
    : MIXIN_VALUE_DYNAMIC;
}

/** Classify a root once as ordinary, computed-typed, or authored-typed. */
function classifyMixinValueSource(source: CallValue, frame: Frame, e: EvalCtx): MixinValueSourceMode {
  const mode = classifyMixinValuePart(source, frame, e);
  return mode === MIXIN_VALUE_DYNAMIC ? MIXIN_VALUE_NONE : mode;
}

/** Collapse the internal dynamic-leaf result at a direct call-site variable root. */
function classifyResolvedMixinValueSource(hit: MixinValueHit, e: EvalCtx): MixinValueSourceMode {
  const mode = classifyMixinValueHit(hit, e);
  return mode === MIXIN_VALUE_DYNAMIC ? MIXIN_VALUE_NONE : mode;
}

/** Whether one evaluated value group contains a parser-owned URL fact. */
function valueGroupHasUrl(value: ValueGroup): boolean {
  if (isValueGroupArray(value)) {
    for (const item of value) {
      if (valueGroupHasUrl(item)) {
        return true;
      }
    }
    return false;
  }
  if (value.type === 'Url') {
    return true;
  }
  if (value.type === 'List' || value.type === 'Block') {
    return valueGroupHasUrl(value.value);
  }
  if (value.type === 'Collection') {
    for (const entry of value.entries) {
      if (valueGroupHasUrl(entry.key) || valueGroupHasUrl(entry.value)) {
        return true;
      }
    }
  }
  return false;
}

/** Whether eager byte binding would erase structure needed by typed consumers. */
function valueGroupNeedsMixinCarrier(value: ValueGroup): boolean {
  return isValueGroupArray(value) || value.type === 'Url' || value.type === 'List'
    || value.type === 'Block' || value.type === 'Collection'

    /*
     * A Color produced by an evaluated arg (e.g. `rgba(0,0,0,.5)`) serializes to
     * function-call bytes that no longer re-parse as a color literal, so a typed
     * consumer in the body (`darken(@arg)`) needs the retained Color, not bytes.
     */
    || value.type === 'Color';
}

const MIXIN_GROUP_SCALAR = 0;
const MIXIN_GROUP_VALUE = 1;
const MIXIN_GROUP_URL = 2;
type MixinGroupMode = typeof MIXIN_GROUP_SCALAR | typeof MIXIN_GROUP_VALUE | typeof MIXIN_GROUP_URL;

/** Classify one evaluated group once for its candidate-local snapshot policy. */
function mixinGroupMode(value: ValueGroup): MixinGroupMode {
  if (!valueGroupNeedsMixinCarrier(value)) {
    return MIXIN_GROUP_SCALAR;
  }
  return valueGroupHasUrl(value) ? MIXIN_GROUP_URL : MIXIN_GROUP_VALUE;
}

/**
 * Construct one candidate-owned eager snapshot from already-derived source facts.
 * `bytes` is the value's own spelling (see {@link eagerSnapshot}); under compress
 * the snapshot also carries the value it folds from ({@link carryCompressed}).
 */
function snapshotPreparedMixinValue(
  value: ValueGroup,
  mode: MixinGroupMode,
  bytes: string,
  e: EvalCtx,
  retain?: (key: Binding) => void,
  source?: ValueSlot,
  frame: Frame | null = null
): Any {
  const bound = argumentSnapshot(bytes, source, frame, e);
  if (mode === MIXIN_GROUP_URL) {
    (e.mixinUrlBindings ??= new Map()).set(bound, value);
    retain?.(bound);
  } else if (mode === MIXIN_GROUP_VALUE) {
    (e.mixinValueBindings ??= new Map()).set(bound, value);
    retain?.(bound);
  }
  carrySnapshot(bound, value, e, bound.src !== bytes);
  return bound;
}

/**
 * The snapshot an argument binds as: its evaluated bytes, marked when the
 * argument computed ({@link computedArguments}). A parameter is reached through
 * a variable, so a group written around one value as the argument evaluates to
 * that value (`.m((10px))` binds `10px`; {@link withExcluded}). `source` is the
 * argument as written.
 */
function argumentSnapshot(bytes: string, source: ValueSlot | undefined, frame: Frame | null, e: EvalCtx): Any {
  const bound = any(bytes);
  if (source === undefined) {
    return bound;
  }
  if (slotComputation(source, frame, e) !== null) {
    computedArguments.add(bound);
  }
  return bound;
}

/** A list, a space sequence, a block or a map: a value with items, not one value. */
const isStructuredGroup = (value: ValueGroup): boolean =>
  isValueGroupArray(value) || value.type === 'List' || value.type === 'Block' || value.type === 'Collection';

/**
 * Keep the typed value a snapshot was evaluated to beside it, so nothing reads
 * the snapshot's bytes back. One value — a number, a colour, an escaped string,
 * a url — is what a typed position reads (`snapshotValues`); a structured one
 * ({@link isStructuredGroup}) reads there as its opaque bytes and reaches a
 * function or plugin through `mixinValueBindings`. A query prelude reads either
 * to know a snapshot is a value evaluation made ({@link preludeLeaf}). Under compress the value a
 * declaration folds rides too ({@link carryCompressed}), unless the bytes are
 * the authored spelling of a paren group, which is written as it is anywhere.
 */
function carrySnapshot(bound: Any, value: ValueGroup, e: EvalCtx, spelled = false): void {
  e.snapshotValues?.set(bound, value);
  if (e.compressedBindings !== undefined && !spelled) {
    carryCompressed(bound, value, e);
  }
}

/**
 * [compress] Keep the typed value a snapshot was evaluated to beside it when
 * compress spells that value differently from the snapshot's bytes
 * (EvalCtx.compressedBindings).
 */
function carryCompressed(bound: Any, value: ValueGroup, e: EvalCtx): void {
  if (emitCompressed(value) !== bound.src) {
    e.compressedBindings!.set(bound, value);
  }
}

/**
 * The eager snapshot of one argument evaluated in `frame`: Less binds an
 * argument as its evaluated value. A binding is never re-spelled by the output
 * policy, so its bytes are the value as written and a splice of the parameter
 * writes them unchanged (ledger O3: interpolated text is never re-spelled).
 *
 * The argument is evaluated ONCE, typed, and spelled as written — a group
 * around one value nothing computes keeps its parens ({@link writtenParens}),
 * as it does written directly in a declaration. A scalar's
 * typed value rides beside the snapshot (EvalCtx.snapshotValues), so a typed
 * position reads the type the parser gave it — an escaped string stays opaque
 * (ledger V3), a number stays a number — instead of re-reading the bytes. Under
 * compress the snapshot also carries the value a declaration folds by its type
 * ({@link carryCompressed}). Evaluating it a second time would run its functions
 * twice.
 */
function eagerSnapshot(source: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<Any> {
  return mapMaybe(evalTypedSlot(source, frame, spliceCtx(e), true), (value) => {
    validateValueGroupUnits(value, e.modes, isValueSlotArray(source) ? (source[0] ?? {}) : source, e, false);
    const bytes = emitValue(value);
    const bound = argumentSnapshot(bytes, source, frame, e);
    carrySnapshot(bound, value, e, bound.src !== bytes);
    return bound;
  });
}

/**
 * The binding adapter for an argument the ordinary eager route snapshots
 * ({@link eagerSnapshot}). A ruleset, a mixin call or a typed literal binds by
 * reference, as before.
 */
function eagerSource(value: CallValue, frame: Frame | null, e: EvalCtx): MaybePromise<CallValue> | undefined {
  return isMixinCallValue(value) || isTypedCallValue(value)
    || (!isValueSlotArray(value) && isValueBlock(value))
    ? undefined
    : eagerSnapshot(value, frame, e);
}

/** {@link eagerSource} as the adapter of a call that tracks no other source. */
function eagerSources(frame: Frame | null, e: EvalCtx): BoundSourceResolvers {
  return { resolve: value => eagerSource(value, frame, e) };
}

/** Snapshot one canonical result while retaining structure only when bytes would erase it. */
function snapshotEvaluatedMixinValue(
  evaluated: MaybePromise<ValueGroup>,
  e: EvalCtx,
  retain: (key: Binding) => void,
  preparedMode?: MaybePromise<MixinGroupMode>,
  preparedBytes?: MaybePromise<string>
): MaybePromise<CallValue> {
  return mapMaybe(evaluated, value => mapMaybe(
    preparedMode ?? mixinGroupMode(value),
    mode => mapMaybe(
      preparedBytes ?? emitValue(value),
      bytes => snapshotPreparedMixinValue(value, mode, bytes, e, retain)
    )
  ));
}

/**
 * The bytes an authored structural argument binds as, from its one typed
 * evaluation: its items as {@link emitValue} spells them, joined with the line
 * breaks and comments written between them, which its typed evaluation records
 * on the groups it builds ({@link ARG_BINDING}). Its units are checked as a
 * declaration's would be.
 */
function writtenBytes(value: ValueGroup, source: CallValue, e: EvalCtx): string {
  validateValueGroupUnits(value, e.modes, isValueSlotArray(source) ? (source[0] ?? {}) : source, e, false);
  return emitAsWritten(value);
}

function emitAsWritten(value: ValueGroup): string {
  if (isValueGroupArray(value)) {
    return joinGroup(value, ' ', emitAsWritten, valueLayoutOf(value));
  }
  return value.type === 'List' ? joinGroup(value.value, sepGlue(value.sep), emitAsWritten, valueLayoutOf(value)) : value.bytes;
}

/** Snapshot one authored structural result while retaining its original eager bytes. */
function resolveAuthoredMixinValue(
  source: ValueSlot,
  frame: Frame,
  e: EvalCtx,
  retain: (key: Binding) => void
): MaybePromise<CallValue> {
  return mapMaybe(evalTypedSlot(source, frame, e, true, ARG_BINDING), (value) => {
    const mode = mixinGroupMode(value);
    return snapshotPreparedMixinValue(value, mode, mode === MIXIN_GROUP_VALUE ? writtenBytes(value, source, e) : emitValue(value), e, retain, source, frame);
  });
}

/**
 * Bind one direct variable source through the ordinary eager parameter snapshot
 * while retaining a self-contained typed root for the legacy raw-plugin ABI.
 * Called by `bindArgs` inside its existing fixed-parameter pass, so argument
 * placement and the winning variable occurrence are each decided once.
 */
function resolvePluginBoundSource(
  source: CallValue,
  frame: Frame,
  e: EvalCtx,
  retain: (key: Binding) => void,
  candidateRoot = false
): MaybePromise<CallValue> | undefined {
  if (isValueSlotArray(source) || isMixinCallValue(source) || source.type !== 'Lookup'
    || source.kind !== 'var' || typeof source.name !== 'string') {
    return undefined;
  }
  const hit = resolveVarRef(frame, source.name, source.scope, e);
  return resolvePluginBoundHit(source, hit, frame, e, retain, candidateRoot);
}

/** Snapshot one already-resolved direct variable for the legacy raw-plugin ABI. */
function resolvePluginBoundHit(
  source: Lookup,
  hit: MixinValueHit,
  frame: Frame,
  e: EvalCtx,
  retain: ((key: Binding) => void) | undefined,
  candidateRoot: boolean
): MaybePromise<CallValue> {
  if (!hit) {
    return eagerSnapshot(source, frame, e);
  }
  if (hit.evaluated !== null) {
    return snapshotPreparedMixinValue(
      hit.evaluated,
      mixinGroupMode(hit.evaluated),
      emitValue(hit.evaluated),
      e,
      retain
    );
  }
  const value = hit.value;
  if (!isValueSlotArray(value) && isValueBlock(value)) {
    return value;
  }
  if (isMixinCallValue(value)) {
    return eagerSnapshot(source, frame, e);
  }

  const rootWasCached = candidateRoot && e.pluginRawBindings?.has(value) === true;
  const typed = pluginRawRoot(value, e);
  if (candidateRoot && !rootWasCached) {
    retain?.(value);
  }
  const snapshot = withExcluded(e, value, () => eagerSnapshot(value, hit.frame, e));
  return mapMaybe(snapshot, (bound) => {
    if (typed !== null) {
      e.pluginRawBindings!.set(bound, typed);
      retain?.(bound);
    }
    return bound;
  });
}

/**
 * A plugin declared inside a mixin is prepared only after that definition wins
 * dispatch. Preserve fixed-parameter provenance then, without re-evaluating a
 * bound snapshot. This deprecated cold lane builds one last-write-wins named
 * index and one prior-parameter index, and declines spread/rest and computed
 * sources.
 */
function capturePreparedBodyPluginBindings(
  def: MixinDefinition,
  call: MixinCall,
  bindings: Map<string, CallValue>,
  caller: Frame,
  home: Frame,
  e: EvalCtx
): void {
  const named = new Map<string, CallValue>();
  for (const arg of call.args) {
    if (arg.spread) {
      return;
    }
    if (arg.name !== undefined) {
      named.set(arg.name, arg.value);
    }
  }
  const priorParams = new Map<string, Binding>();
  let positional = 0;
  for (let index = 0; index < def.params.length; index++) {
    const param = def.params[index]!;
    if (param.rest) {
      return;
    }
    let source: CallValue | undefined;
    let defaulted = false;
    if (param.name !== undefined && named.has(param.name)) {
      source = named.get(param.name)!;
    } else {
      for (; positional < call.args.length; positional++) {
        const arg = call.args[positional]!;
        if (arg.name === undefined) {
          source = arg.value;
          positional++;
          break;
        }
      }
    }
    if (source === undefined) {
      source = param.default;
      defaulted = true;
    }
    if (param.name === undefined || param.pattern !== undefined) {
      continue;
    }
    const snapshot = bindings.get(param.name);
    if (snapshot === undefined) {
      continue;
    }
    if (source === undefined || isValueSlotArray(source) || isMixinCallValue(source)
      || source.type !== 'Lookup' || source.kind !== 'var' || typeof source.name !== 'string') {
      priorParams.set(param.name, snapshot);
      continue;
    }

    let root: Binding;
    if (defaulted && priorParams.has(source.name)) {
      const earlier = priorParams.get(source.name)!;
      const typed = e.pluginRawBindings?.get(earlier) ?? (isTypedCallValue(earlier) ? earlier : null);
      if (typed !== null) {
        e.pluginRawBindings!.set(snapshot, typed);
      }
      priorParams.set(param.name, snapshot);
      continue;
    }
    let hit = resolveVarRef(defaulted ? home : caller, source.name, source.scope, e);
    if (!hit && defaulted && call.path.length === 0 && home !== caller) {
      hit = resolveVarRef(caller, source.name, source.scope, e);
    }
    if (!hit || isMixinCallValue(hit.value)) {
      priorParams.set(param.name, snapshot);
      continue;
    }
    root = hit.value;
    const typed = pluginRawRoot(root, e);
    if (typed !== null) {
      e.pluginRawBindings!.set(snapshot, typed);
    }
    priorParams.set(param.name, snapshot);
  }
}

const TRACK_PLUGIN_SOURCE = 1;
const TRACK_VALUE_SOURCE = 2;

function boundSourceTracker(
  frame: Frame,
  e: EvalCtx,
  trackMode: number,
  spreadValues?: ValueBearingSpreadCall,
  valueSources?: MixinValueSources
): BoundSourceTracker {
  const trackPlugin = (trackMode & TRACK_PLUGIN_SOURCE) !== 0;
  const trackValue = (trackMode & TRACK_VALUE_SOURCE) !== 0;
  let candidateKeys: Binding[] | null = null;
  let primaryValue: MaybePromise<ValueGroup> | undefined;
  let additionalValues: Map<CallValue, MaybePromise<ValueGroup>> | undefined;
  let primaryGroup: ValueGroup | undefined;
  let primaryGroupMode: MixinGroupMode = MIXIN_GROUP_SCALAR;
  let primaryGroupModeReady = false;
  let primaryGroupBytes = '';
  let primaryGroupBytesReady = false;
  let additionalGroupModes: Map<ValueGroup, MixinGroupMode> | undefined;
  let additionalGroupBytes: Map<ValueGroup, string> | undefined;
  let restGroup: ValueGroup | undefined;
  let restModes: MixinGroupMode[] | undefined;
  let restBytes: string[] | undefined;
  const retain = (key: Binding): void => {
    (candidateKeys ??= []).push(key);
  };

  /*
   * A source's mode is fixed, so its one evaluation is shared: an authored
   * source is evaluated as a binding, whose written bytes keep its layout.
   */
  const evaluatedValue = trackValue
    ? (source: ValueSlot, mode: MixinValueSourceMode): MaybePromise<ValueGroup> => {
        const argument = mode === MIXIN_VALUE_AUTHORED ? ARG_BINDING : ARG_NONE;
        if (source === valueSources?.valueSource) {
          return primaryValue ??= evalTypedSlot(source, frame, e, true, argument);
        }
        let value = additionalValues?.get(source);
        if (value === undefined) {
          value = evalTypedSlot(source, frame, e, true, argument);
          (additionalValues ??= new Map()).set(source, value);
        }
        return value;
      }
    : undefined;
  const preparedMode = trackValue
    ? (value: ValueGroup): MixinGroupMode => {
        if (primaryGroup === undefined) {
          primaryGroup = value;
        }
        if (value === primaryGroup) {
          if (!primaryGroupModeReady) {
            primaryGroupMode = mixinGroupMode(value);
            primaryGroupModeReady = true;
          }
          return primaryGroupMode;
        }
        let mode = additionalGroupModes?.get(value);
        if (mode === undefined) {
          mode = mixinGroupMode(value);
          (additionalGroupModes ??= new Map()).set(value, mode);
        }
        return mode;
      }
    : undefined;
  const preparedBytes = trackValue
    ? (value: ValueGroup): string => {
        if (primaryGroup === undefined) {
          primaryGroup = value;
        }
        if (value === primaryGroup) {
          if (!primaryGroupBytesReady) {
            primaryGroupBytes = emitValue(value);
            primaryGroupBytesReady = true;
          }
          return primaryGroupBytes;
        }
        let bytes = additionalGroupBytes?.get(value);
        if (bytes === undefined) {
          bytes = emitValue(value);
          (additionalGroupBytes ??= new Map()).set(value, bytes);
        }
        return bytes;
      }
    : undefined;
  const resolve: BoundSourceResolver = (value) => {
    if (isMixinCallValue(value)) {
      return undefined;
    }
    let spreadSnapshot: Any | undefined;
    let spreadValue: ValueGroup | undefined;
    if (!isValueSlotArray(value) && value.type === 'Any') {
      spreadValue = spreadValues?.valueBindings.get(value);
      if (spreadValue !== undefined) {
        spreadSnapshot = value;
      }
    }
    let mode: MixinValueSourceMode = MIXIN_VALUE_NONE;
    mode = value === valueSources?.valueSource
      ? valueSources.valueSourceMode
      : valueSources?.additionalValueSources?.get(value) ?? MIXIN_VALUE_NONE;
    const pluginEligible = trackPlugin && !isValueSlotArray(value) && !isMixinCallValue(value)
      && value.type === 'Lookup' && value.kind === 'var' && typeof value.name === 'string';
    if (spreadValue === undefined && mode === MIXIN_VALUE_NONE && !pluginEligible) {
      return eagerSource(value, frame, e);
    }
    if (trackValue && (spreadValue !== undefined || mode !== MIXIN_VALUE_NONE)) {
      if (spreadValue !== undefined) {
        return snapshotPreparedMixinValue(
          spreadValue,
          spreadValues!.urlBindings?.has(spreadSnapshot!) === true
            ? MIXIN_GROUP_URL
            : MIXIN_GROUP_VALUE,
          spreadSnapshot!.src,
          e,
          retain
        );
      }
      const evaluated = evaluatedValue!(value, mode);
      return mapMaybe(evaluated, (group) => {
        const groupMode = preparedMode!(group);
        const bytes = mode === MIXIN_VALUE_AUTHORED && groupMode === MIXIN_GROUP_VALUE
          ? writtenBytes(group, value, e)
          : preparedBytes!(group);
        return snapshotPreparedMixinValue(group, groupMode, bytes, e, retain, value, frame);
      });
    }
    if (!pluginEligible || isValueSlotArray(value) || isMixinCallValue(value)
      || value.type !== 'Lookup' || value.kind !== 'var' || typeof value.name !== 'string') {
      return undefined;
    }
    return resolvePluginBoundSource(
      value,
      frame,
      e,
      retain,
      false
    );
  };
  const resolveRest: RestBoundSourceResolver | undefined = trackValue
    ? (value) => {
        if (isMixinCallValue(value)) {
          return undefined;
        }
        let spreadSnapshot: Any | undefined;
        let spreadValue: ValueGroup | undefined;
        if (!isValueSlotArray(value) && value.type === 'Any') {
          spreadValue = spreadValues?.valueBindings.get(value);
          if (spreadValue !== undefined) {
            spreadSnapshot = value;
          }
        }
        const mode = value === valueSources?.valueSource
          ? valueSources.valueSourceMode
          : valueSources?.additionalValueSources?.get(value) ?? MIXIN_VALUE_NONE;
        if (spreadValue === undefined && mode === MIXIN_VALUE_NONE) {
          return undefined;
        }
        const evaluated = spreadValue ?? evaluatedValue!(value, mode);
        return mapMaybe(evaluated, (group) => {
          const members = isValueGroupArray(group)
            ? group
            : group.type === 'List'
              ? group.value
              : null;
          if (members === null) {
            return [snapshotPreparedMixinValue(
              group,
              spreadSnapshot !== undefined && spreadValues!.urlBindings?.has(spreadSnapshot) === true
                ? MIXIN_GROUP_URL
                : spreadSnapshot !== undefined
                  ? MIXIN_GROUP_VALUE
                  : preparedMode!(group),
              spreadSnapshot?.src ?? preparedBytes!(group),
              e,
              retain
            )];
          }
          if (restGroup !== group) {
            const modes = new Array<MixinGroupMode>(members.length);
            const bytes = new Array<string>(members.length);
            for (let index = 0; index < members.length; index++) {
              const member = members[index]!;
              modes[index] = mixinGroupMode(member);
              bytes[index] = emitValue(member);
            }
            restGroup = group;
            restModes = modes;
            restBytes = bytes;
          }
          const slots: ValueSlot[] = [];
          for (let index = 0; index < members.length; index++) {
            slots.push(snapshotPreparedMixinValue(
              members[index]!,
              restModes![index]!,
              restBytes![index]!,
              e,
              retain
            ));
          }
          return slots;
        });
      }
    : undefined;
  return {
    resolve,
    resolveRest,
    begin: () => {
      candidateKeys = null;
    },
    finish: () => {
      const keys = candidateKeys;
      candidateKeys = null;
      return keys;
    },
    discard: keys => discardSelectedBoundSources(keys, e)
  };
}

function pluginRawArgument(slot: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<PluginRawArgument> {
  if (isValueSlotArray(slot)) {
    return combineAll(slot.map(part => evalTypedSlot(part, frame, e, true)), values => values);
  }
  let binding: Binding = slot;
  let bindingFrame = frame;
  if (!isValueSlotArray(slot) && slot.type === 'Lookup' && slot.kind === 'var') {
    const hit = resolveVarRef(frame, literalName(slot), slot.scope, e);
    if (hit) {
      if (hit.evaluated !== null) {
        return hit.evaluated;
      }
      const carried = hit.frame.mixinValueBindings?.get(hit.value)
        ?? e.mixinValueBindings?.get(hit.value)
        ?? hit.frame.mixinUrlBindings?.get(hit.value)
        ?? e.mixinUrlBindings?.get(hit.value);
      if (carried !== undefined) {
        return carried;
      }
      const raw = e.pluginRawBindings?.get(hit.value);
      if (raw && !isMixinCallValue(raw)) {
        return evalTypedSlot(raw, hit.frame, e, true);
      }
      binding = hit.value;
      bindingFrame = hit.frame;
    }
  }
  return pluginDetachedProjection(binding, bindingFrame, e) ?? evalTypedSlot(slot, frame, e, true);
}

/**
 * Project the declaration map of one detached ruleset only for an opted-in
 * legacy plugin call, or return `undefined` when the binding is not block-like.
 * The normal value evaluator deliberately keeps detached rulesets out of
 * `Value`; this shared cold boundary gives both argument projection and plugin
 * variable lookup the same map shape.
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
  const values = declarations.map(({ declaration }) =>
    evalTypedSlot(declaration.value, definitionFrame, e, true));
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
  if (hit.evaluated !== null) {
    return { value: hit.evaluated, important: false };
  }
  const projected = pluginDetachedProjection(hit.value, hit.frame, e);
  const resolved = projected ?? (isValueSlotArray(hit.value) || hit.value.type !== 'MixinCall'
    ? evalTypedSlot(hit.value, hit.frame, e, true)
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
function pluginFnContext(
  node: FunctionCall,
  frame: Frame | null,
  e: EvalCtx,
  sourceOwner: object | null
): PluginCallCtx {
  const file = sourceOwner instanceof DocumentContext
    ? sourceOwner.file
    : e.context?.sourceContext?.file;
  return {
    modes: e.modes,
    stringify: value => !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value),
    ...(e.io === undefined ? {} : { io: e.io }),
    lookupVariable: name => withSourceOwner(e, sourceOwner, () => pluginVariableHit(name, frame, e)),
    callFunction: (name, args) => withSourceOwner(e, sourceOwner, () => {
      if (!e.ev) {
        return undefined;
      }
      const result = e.ev.call(name, makeList([...args], ','), e.modes, null, e.io);
      if (isThenable(result)) {
        observeRejectedThenable(result);
        return undefined;
      }
      return result;
    }),
    currentFileInfo: {
      filename: file?.fullPath ?? '',
      entryPath: e.context?.entryFilePath ?? ''
    },
    log: record => withSourceOwner(e, sourceOwner, () => reportPluginLog(node, record, e)),
    markImportant: () => {
      if (e.importantSink) {
        e.importantSink.hit = true;
      } else if (e.mergeImportant !== undefined) {
        e.mergeImportant = true;
      }
    }
  };
}

/**
 * A `@use` whose module cannot load is an import failure at the `@use`, as a
 * `@plugin` that cannot load is a plugin failure at the `@plugin`.
 */
function moduleLoadFailed(statement: ModuleImport, e: EvalCtx): (error: unknown) => never {
  return (error) => {
    throw error instanceof JessError
      ? error.attributeTo(callSiteLocation(statement, e))
      : ERR.importLoadFailed({
          node: statement,
          ...callSiteLocation(statement, e),
          meta: { specifier: statement.path.value, reason: error instanceof Error ? error.message : String(error) }
        });
  };
}

/**
 * Source position of a node, for a diagnostic that points at it. The diagnostic
 * keeps the file object, which says where the authored file sits in the parsed
 * text, so its code frame counts lines as `lineColAt` does (ledger O16). A node
 * in text the host injected around the file is counted in the prepared text and
 * says so ({@link fileAt}).
 */
function callSiteLocation(node: object, e: Pick<EvalCtx, 'context'>): { ctx: TreeContextLike; line?: number; column?: number; note?: string } {
  const authored = e.context?.sourceContext?.file;
  const source = authored?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  if (source === undefined || span === undefined) {
    return { ctx: { file: authored } };
  }
  const file = fileAt(authored!, source, span.start);
  const location = lineColAt(source, span.start, file);
  return file === authored
    ? { ctx: { file }, line: location.line, column: location.column }
    : { ctx: { file }, line: location.line, column: location.column, note: INJECTED_TEXT_NOTE };
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
  e: EvalCtx,
  demanded: boolean
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
  if (invoked === null) {
    return undefined;
  }

  /*
   * A typed consumer reads the result typed, as it reads any value: a result
   * written as a paren group around one value (`@return ($x)`) is that value
   * to math, a comparison or a callable, and keeps its parens only where it is
   * written out.
   */
  return demanded ? evalTypedSlot(invoked.value, invoked.frame, e) : evalValueSlot(invoked.value, invoked.frame, e);
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
    const invoked = evalLambdaCall(node, frame, e, demanded);
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
  const intro = evalIntrospection(node, frame, e);
  if (intro !== undefined) {
    return intro;
  }
  if (e.ev && node.args.length === 1 && node.name.toLowerCase() === 'calc') {
    return evalCalc(node, frame, e);
  }
  if (!e.ev) {
    return preserveCall(node, frame, e);
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
  if (selected && rawInvoker && e.moduleFns?.has(selected) !== true) {
    const raw = node.args.map(arg => pluginRawArgument(arg.value, frame, e));
    return combineAll(raw, (args) => {
      const sourceOwner = frame?.sourceOwner ?? e.context?.currentSourceOwner?.() ?? null;
      try {
        const result = rawInvoker(selected, args, pluginFnContext(node, frame, e, sourceOwner));
        const settled = isThenable(result)
          ? result.catch((error: unknown) => (error instanceof FunctionDeclined
              ? dispatchCall(node, frame, e, ev, undefined, false)
              : withSourceOwner(e, sourceOwner, () => pluginCallFailure(node, error, frame, e))))
          : result;
        if (isThenable(settled)) {
          observeRejectedThenable(settled);
        }
        return mapMaybe(settled, value => value === undefined
          ? evalCall(node, frame, { ...e, pluginHost: undefined }, demanded)
          : value);
      } catch (error) {
        /* A declined call is written out as-is, as a call to no function is. */
        return error instanceof FunctionDeclined
          ? dispatchCall(node, frame, e, ev, undefined, false)
          : withSourceOwner(e, sourceOwner, () => pluginCallFailure(node, error, frame, e));
      }
    });
  }

  /*
   * [P36] A call written in a Less modern-mode document has no ambient
   * built-ins: the registry is out of scope and an unimported name takes the
   * evaluator's unknown-call path, the one `.jess` reaches through its empty
   * registry (P17). The parser attached its document's scope to the node.
   */
  return dispatchCall(node, frame, e, ev, selected, hasAmbientFunctions(node));
}

/** One `functionMode: 'error'` copy per render's modes, for imported calls (ruling J1). */
const erroringModesCache = new WeakMap<EvalModes, EvalModes>();

function erroringModes(modes: EvalModes): EvalModes {
  let erroring = erroringModesCache.get(modes);
  if (erroring === undefined) {
    erroring = { ...modes, functionMode: 'error' };
    erroringModesCache.set(modes, erroring);
  }
  return erroring;
}

/**
 * Materialize a call's arguments TYPED and dispatch it through the evaluator:
 * to `selected` when a scoped function was resolved, else to a built-in when
 * `ambient`, else down the unknown-call path, which writes the call out as-is.
 *
 * A call through an `imported` binding — a module namespace (`@ns.fn(…)`,
 * `$ns.fn(…)`) or a bare imported function (`$fn()`) — can never be a CSS
 * function, so `functionMode: 'preserve'` has nothing valid to write out: a
 * failure is an eval error whatever the configured mode (ruling J1, jess#280).
 */
function dispatchCall(
  node: FunctionCall,
  frame: Frame | null,
  e: EvalCtx,
  ev: ValueEvaluator,
  selected: Fn | undefined,
  ambient: boolean,
  imported = false
): MaybePromise<EvalValue> {
  const modes = imported && e.modes.functionMode !== 'error' ? erroringModes(e.modes) : e.modes;
  const sep = node.modern ? ' ' : ',';

  /*
   * Args are materialized TYPED (each arg's tag sourced from its parse node). A
   * call with no callable is written out as-is, so its arguments are values
   * (ledger F11) rather than inputs.
   */
  const argument = selected === undefined && !(ambient && ev.has(node.name)) ? ARG_WRITTEN : ARG_INPUT;
  const typed = node.args.map(a => evalTypedSlot(a.value, frame, e, true, argument));
  return combineAll(typed, (vals) => {
    let named = false;
    for (let i = 0; i < node.args.length; i++) {
      if (node.args[i]!.name !== undefined) {
        named = true;
        break;
      }
    }
    const ordered = named ? orderKeywordArgs(node.args, vals, ev, node.name, selected, ambient) : vals;
    const args: ValueGroup = sep === ',' ? makeList(ordered, ',') : ordered;

    /*
     * A call that names an argument also hands over its arguments as written,
     * read only if the call is written out as-is (P23). The keywords are the
     * call's own arguments; when nothing was rebound, the order is the authored
     * one already. The authored arguments themselves ride along for the
     * comments and line breaks a written-out call keeps (F11); nothing is
     * looked up unless the call is written out.
     */
    const written: WrittenArguments | undefined = named
      ? { args: ordered === vals ? args : (sep === ',' ? makeList(vals, ',') : vals), keywords: node.args }
      : undefined;
    try {
      const result = ev.call(node.name, args, modes, null, e.io, selected, ambient, written, node.args);
      if (isThenable(result)) {
        return result.then((value) => {
          warnConsumedKept(vals, value, node, e);
          return value;
        }, error => invalidFunctionCall(node, error, e));
      }
      warnConsumedKept(vals, result, node, e);
      return result;
    } catch (error) {
      return invalidFunctionCall(node, error, e);
    }
  });
}

/**
 * [P37] A ruleset passed to a function, evaluated in the scope it was bound in
 * and written as one line: `{ color: red; .a { x: red; } }`
 * (`{color:red;.a{x:red}}` compressed). The body follows the ruleset-body rules:
 * variable and mixin definitions bind silently, `+:` / `+_:` merge into the
 * first declaration of that name, a `null` value elides its own declaration, a
 * ruleset-valued declaration raises `eval/ruleset-on-property`, `$prop` reads
 * the body's earlier declarations, a guarded nested rule emits only when its
 * guard holds, and a mixin call expands in place. A block with parameters, and
 * a statement this writer has no one-line form for, raise
 * `eval/ruleset-argument-with-rules` rather than being dropped.
 */
function writtenRulesetArgument(block: AnonymousMixin, frame: Frame | null, e: EvalCtx): MaybePromise<ValueGroup> {
  if (block.params !== undefined) {
    rejectRulesetArgument(block, 'parameters', e);
  }
  const binding = frame === null ? undefined : detachedBinding(frame, block);
  const lexical = binding?.lexicalFrame ?? frame;

  /*
   * Under the block's own document, so its comments read that document's
   * trivia. The argument is a COPY of the block, so it tracks which of the
   * block's comments it has written on a scratch emitter of its own.
   */
  return withSourceOwner(e, binding?.sourceOwner, () => mapMaybe(writtenBlockBody(block, block, lexical, e, scratchEmit(e)), makeAny));
}

function rejectRulesetArgument(block: AnonymousMixin, what: string, e: EvalCtx): never {
  throw ERR.rulesetArgumentWithRules({
    node: block,
    ...callSiteLocation(block, e),
    meta: { what }
  });
}

/** One block body of a ruleset argument, braces included (see {@link writtenRulesetArgument}).
 *  `owner` is the block itself or a rule nested in it: the node whose body is
 *  written. `trivia` tracks the comments this argument has written. */
function writtenBlockBody(
  block: AnonymousMixin,
  owner: AnonymousMixin | Ruleset | AtRuleBlock,
  parent: Frame | null,
  e: EvalCtx,
  trivia: Emit
): MaybePromise<string> {
  const rules = owner.rules;
  const bodyFrame: Frame = {
    parent,
    mixins: collectMixins(rules),
    declIndex: collectDeclIndex(rules), cells: null, reassign: null
  };
  const compress = e.compress === true;
  type Part = { readonly separator: string; readonly value: MaybePromise<string>; readonly sink: { elided: boolean } };
  type Entry = { readonly name: MaybePromise<string>; readonly mergeKey: string | null; readonly parts: Part[]; important: boolean };

  /* In source order: a declaration entry, or the finished bytes of a nested rule, at-rule or comment. */
  const items: Array<Entry | MaybePromise<string>> = [];
  const addDeclaration = (rule: Declaration, frame: Frame, important: boolean): void => {
    recordPropertyDeclaration(bodyFrame, rule, frame);
    assertDeclarationValueIsNotRuleset(rule, frame, e);
    const sink = { elided: false };
    const value = evalBytes(rule.value, frame, { ...e, elideSink: sink });
    const key = rule.merge !== null && typeof rule.name === 'string' ? rule.name : null;
    const prior = key === null
      ? undefined
      : items.find((item): item is Entry => typeof item === 'object' && 'mergeKey' in item && item.mergeKey === key);
    if (prior !== undefined) {
      prior.parts.push({ separator: rule.merge === ',' ? sepGlue(',', compress) : ' ', value, sink });
      prior.important ||= important;
      return;
    }
    items.push({
      name: typeof rule.name === 'string' ? rule.name : evalBytes(rule.name, frame, e),
      mergeKey: key,
      parts: [{ separator: '', value, sink }],
      important
    });
  };

  /*
   * The body's comments are trivia in its body span (jess#301), replayed by the
   * same cursor a call of the block uses: each is written where it sits between
   * two statements, and the runs inside a statement belong to that statement.
   */
  const replay = bodyTriviaReplay(owner, trivia);
  const commentsBefore = (limit: number): void => {
    const comments = replay === undefined ? undefined : takeBodyTrivia(replay, limit, undefined, trivia);
    for (const text of comments ?? []) {
      if (keepComment(e, text)) {
        items.push(text);
      }
    }
  };
  for (const rule of rules) {
    const start = rule.type === 'VariableDeclaration' ? sourceStartOf(rule) : statementStartOf(rule) ?? NO_SPAN;
    if (start !== NO_SPAN) {
      commentsBefore(start);
    }
    const end = rule.type === 'VariableDeclaration' ? sourceEndOf(rule) : statementEndOf(rule) ?? NO_SPAN;
    while (replay !== undefined && replay.index < replay.table.runs.length && replay.table.runStart[replay.index]! < end) {
      replay.index++;
    }
    switch (rule.type) {
      case 'VariableDeclaration':
      case 'MixinDefinition':
        break;
      case 'Declaration':
        addDeclaration(rule, bodyFrame, rule.important);
        break;
      case 'Comment':
        items.push(rule.text);
        break;
      case 'Ruleset': {
        const selector = combineAll(
          rule.selector.selectors.map(branch => resolveSelectorBranch(branch, bodyFrame, e)),
          branches => branches.join(compress ? ',' : ', ')
        );
        const guard = rule.guard;
        const holds = guard === undefined
          ? true
          : withUnitErrors(rule, e, () => evalGuard(guard, guardDeps(bodyFrame, e)));
        items.push(mapMaybe(holds, guarded => guarded
          ? mapMaybe(selector, header => mapMaybe(
              writtenBlockBody(block, rule, bodyFrame, e, trivia),
              body => `${header}${compress ? '' : ' '}${body}`
            ))
          : ''));
        break;
      }
      case 'AtRuleBlock':
        items.push(mapMaybe(atRulePreludeBytes(rule, bodyFrame, scratchEmit(e)), prelude =>
          mapMaybe(writtenBlockBody(block, rule, bodyFrame, e, trivia), body =>
            `${rule.name}${prelude === '' ? '' : ` ${prelude}`}${compress ? '' : ' '}${body}`)));
        break;
      case 'MixinCall': {
        /*
         * The mixin expands in place; its declarations join this body, each
         * after the comments its expansion replayed ahead of it. Rules it would
         * emit have no place in the collected declaration run.
         */
        const em = scratchEmit(e);
        const collected: Leaf[] = [];
        const noop = (): void => {};
        const nested: Partition = { encounteredContainer: false, trailing: [], pending: [], emitBlock: noop };
        settledExpansion(expandCall(rule, null, null, bodyFrame, collected, noop, nested, em, false, true), rule, em);
        if (nested.trailing.length > 0 || nested.pending.length > 0) {
          rejectRulesetArgument(block, 'a mixin call that emits nested rules', e);
        }
        const keepAll = (comments: readonly string[] | null): void => {
          for (const text of comments ?? []) {
            if (keepComment(e, text)) {
              items.push(text);
            }
          }
        };
        for (const leaf of collected) {
          keepAll(leaf.leadingBlockComments);
          if (leaf.node.type === 'Declaration') {
            addDeclaration(leaf.node, leaf.frame, leaf.important || leaf.node.important);
          }
        }
        keepAll(em.pendingLeafBlockCommentOwner === collected ? em.pendingLeafBlockComments : null);
        break;
      }
      default:
        rejectRulesetArgument(block, `a ${rule.type}`, e);
    }
  }
  if (replay !== undefined) {
    commentsBefore(replay.end);
    trivia.emittedBlockTrivia.closeCopy(replay);
  }
  const written = items.map((item) => {
    if (typeof item !== 'object' || !('mergeKey' in item)) {
      return mapMaybe(item, bytes => ({ bytes, declaration: false }));
    }
    return combineAll([item.name, ...item.parts.map(part => part.value)], ([name, ...values]) => {
      let value = '';
      item.parts.forEach((part, index) => {
        if (!part.sink.elided) {
          value += (value === '' ? '' : part.separator) + values[index]!;
        }
      });
      if (item.parts.every(part => part.sink.elided)) {
        return { bytes: '', declaration: true };
      }
      const important = item.important ? (compress ? '!important' : ' !important') : '';
      return { bytes: `${name!}${compress ? ':' : ': '}${value}${important};`, declaration: true };
    });
  });
  return combineAll(written, (pieces) => {
    const kept = pieces.filter(piece => piece.bytes !== '');
    if (kept.length === 0) {
      return '{}';
    }
    if (!compress) {
      return `{ ${kept.map(piece => piece.bytes).join(' ')} }`;
    }
    const last = kept[kept.length - 1]!;
    const body = kept.map(piece => piece.bytes).join('');
    return `{${last.declaration ? body.slice(0, -1) : body}}`;
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
 * Called only for a call that names an argument: the caller's one
 * `name !== undefined` scan keeps an ordinary positional call off this path.
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
  scopedFn: Fn | undefined,
  ambient: boolean
): T[] {
  const params = ev.paramNames(name, scopedFn, ambient);
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
    throw error.attributeTo(callSiteLocation(node, e));
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
    validateItemUnits(values, node.parts, node, e);
    let out = emitValueC(values[0]!, e);
    for (let index = 1; index < values.length; index++) {
      /*
       * [compress] a space list keeps ONE space; the authored (possibly multi-line)
       * boundary run is replayed only in pretty output.
       */
      out += e.compress === true ? ' ' : authoredSpace(authored?.[index - 1]);
      out += emitValueC(values[index]!, e);
    }
    return literal(out);
  });
}

/**
 * [compress] Compress-aware value emit. Off (or a bare-string literal that was
 * already folded upstream in {@link evalValue}) is exactly {@link emitValue}. On,
 * a typed COMPUTED value folds by its RESULT type ({@link emitCompressed}).
 */
function emitValueC(v: EvalValue, e: EvalCtx): string {
  return e.compress === true ? emitCompressed(v) : emitValue(v);
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
    return emitValueC(value, e);
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
  return mapMaybe(evalValue(node, frame, spliceCtx(e)), emitValue);
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
  return syncValue(evalBytes(node, frame, e), node, e, 'import request / synchronous byte position');
}

/** `value` in a position confined to the synchronous lane, where an awaitable one is an error. */
function syncValue<T>(value: MaybePromise<T>, node: object, e: EvalCtx, where: string): T {
  if (isThenable(value)) {
    observeRejectedThenable(value);
    throw ERR.asyncInSyncPosition({
      node,
      ...callSiteLocation(node, e),
      meta: { where }
    });
  }
  return value;
}

/** A string's content — its authored value, or its template spliced in `frame` — for a path request. */
function quotedContentSync(node: Quoted, frame: Frame | null, e: EvalCtx): string {
  return node.interp === null ? node.value : evalBytesSync(node.interp, frame, e);
}

/** As {@link evalBytesSync}, for the media tail of an import request. */
function evalQueryPreludeSync(node: ValueSlot, frame: Frame | null, e: EvalCtx): string {
  return syncValue(evalQueryPrelude(node, frame, e), node, e, 'import request media tail');
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
  if (bound.type === 'Quoted' && bound.escaped) {
    /*
     * One escaped string, interpolating or not: its content decides the group.
     * A comma-less string returns null and splices on the byte path, which
     * evaluates an interpolating one again there.
     */
    const content = bound.interp === null ? bound.value : withExcluded(e, bound, () => evalBytes(bound, hit.frame, e));
    if (isThenable(content)) {
      // ponytail: an async hole in a selector string falls back to the byte splice, without grouping.
      observeRejectedThenable(content);
      return null;
    }
    if (hasTopLevelComma(content)) {
      /* The whitespace an escaped selector opens or closes with is canonicalized away (ledger O8(b)). */
      return { branches: [content.trim()], multi: true, capture: false };
    }
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
  return part.unquote ? mapMaybe(unquotedRef(part.ref, frame, spliceCtx(e)), emitSplice) : evalBytesInterp(part.ref, frame, e);
}

/** [selector-capture] The header/parent branch strings one complex contributes.
 *  A lone whole-selector `*[…]` capture EXPANDS to one branch per captured
 *  selector. A lone quoted group stays a single verbatim branch at a root
 *  header, and contributes its branches one per line to a `nested` header
 *  (ledger O8(a)). Every other complex resolves to exactly one string (a
 *  compound-embedded group compacts to `:is(…)` inside `resolveComplex`). */
function expandSelectorBranch(c: SelectorBranch, frame: Frame | null, e: EvalCtx, nested = false): MaybePromise<string[]> {
  const g = loneGroupInterp(c, frame, e);
  if (g !== null) {
    return g.capture ? g.branches : nested ? splitListBytes(g.branches[0]!) : g.branches;
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
      values => pseudoJoin(sim, values)
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

    /*
     * Only an interpolation can open a branch with whitespace (`~' + .e'`); at
     * the branch boundary it is canonicalized away (ledger O8(b)).
     */
    return out.trimStart();
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

/**
 * [nesting] The units a parent list factors into when flattening: the list
 * wrapped once in `:is(a, b, …)` (a single parent bare), except that a parent
 * that may carry a pseudo-element ({@link EvalCtx.pseudoElementParents}) is a
 * unit of its own — `:is()` cannot hold a pseudo-element, so factoring one in
 * would match nothing (owner 2026-10-06: an output transformation never makes
 * output more invalid or match fewer elements; amends O10). Units come in order
 * of first appearance: `.a::before, .c, .d` gives `.a::before`, `:is(.c, .d)`.
 * Used for a bare LEADING `&` (the compound's subject) and for an `&`-less
 * child's ancestor; a name-merged `&` distributes anyway.
 */
function parentUnits(parents: string[], e: EvalCtx): string[] {
  const marked = e.pseudoElementParents;
  if (parents.length < 2 || marked.size === 0 || !parents.some(p => marked.has(p))) {
    return [wrapIsList(parents)];
  }
  const units: string[] = [];
  let rest: string[] | null = null;
  let restAt = 0;
  for (const p of parents) {
    if (marked.has(p)) {
      units.push(p);
    } else if (rest === null) {
      rest = [p];
      restAt = units.push('') - 1;
    } else {
      rest.push(p);
    }
  }
  if (rest !== null) {
    units[restAt] = wrapIsList(rest);
  }
  return units;
}

/** [nesting] The single opaque ancestor unit for `branches`, or `null` when they factor into several ({@link parentUnits}). */
function ancestorUnit(branches: string[], e: EvalCtx): string | null {
  const units = parentUnits(branches, e);
  return units.length === 1 ? units[0]! : null;
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
function resolveTokenAmp(sim: SimpleToken, parents: string[], subs: string[], first: boolean, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  if (sim.type === 'PseudoSelector' && sim.args !== null && selectorListHasAmpersand(sim.args)) {
    return mapMaybe(
      resolveSelectorListAmp(sim.args, parents, frame, e),
      branches => [pseudoJoin(sim, branches)]
    );
  }
  return mapMaybe(resolveSimpleText(sim, frame, e), (text) => {
    if (!textHoldsParentRef(text)) {
      return [text];
    }
    if (first && text === '&') {
      return subs;
    }
    return parents.map(p => text.split('&').join(p));
  });
}

/** [nesting] One compound resolved against `parents`, its tokens concatenated;
 *  a distributing `&` (append/merge) multiplies its variants (cartesian). */
function resolveCompoundAmp(cmp: CompoundSelector, parents: string[], subs: string[], frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  const tokens = cmp.value.map((sim, i) => resolveTokenAmp(sim, parents, subs, i === 0, frame, e));
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

function resolveTermAmp(term: SelectorTerm, parents: string[], subs: string[], frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  return term.type === 'CompoundSelector'
    ? resolveCompoundAmp(term, parents, subs, frame, e)
    : resolveTokenAmp(term, parents, subs, true, frame, e);
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
  const subs = parentUnits(parents, e);
  return combineAll(terms.map(term => resolveTermAmp(term, parents, subs, frame, e)), (variants) => {
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

/**
 * Whether an attribute token of `c` holds a `&`: attribute text, never a parent
 * reference ({@link textHoldsParentRef}), which the one-parent text splice would
 * replace, so such a branch takes the token-by-token walk. Allocates nothing.
 */
function branchHasAttributeAmp(c: SelectorBranch): boolean {
  if (c.type === 'ComplexSelector' || c.type === 'RelativeSelector' || c.type === 'CompoundSelector') {
    for (const part of c.value) {
      if (typeof part !== 'string' && branchHasAttributeAmp(part)) {
        return true;
      }
    }
    return false;
  }
  return c.type === 'SimpleSelector' && c.text?.charCodeAt(0) === 0x5B /* [ */ && c.text.includes('&');
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
  if ((parents.length >= 2 || branchHasAttributeAmp(child)) && !parents.some(hasTopLevelComma)) {
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
  const marked = e.pseudoElementParents;
  const parts = child.selectors.map((c) => {
    const composed = composeOne(parents, c, frame, e);
    return marked.size === 0 && !mayCarryPseudoElement(c)
      ? composed
      : mapMaybe(composed, list => markComposedBranches(parents, c, list, e));
  });
  return combineAll(parts, values => values.flat());
}

/**
 * Record which branches `child` composed over `parents` (none at the root) may
 * carry a pseudo-element ({@link EvalCtx.pseudoElementParents}): every one when
 * the child's own tokens may; under an `&`-less child, the one under each
 * marked parent (one branch per parent, in order); under an `&` child, every
 * one when any parent is marked — a unit an `&` substituted may be that parent.
 */
function markComposedBranches(parents: string[], child: SelectorBranch, composed: string[], e: EvalCtx): string[] {
  const marked = e.pseudoElementParents;
  if (mayCarryPseudoElement(child)) {
    for (const text of composed) {
      marked.add(text);
    }
  } else if (!selectorBranchHasAmpersand(child)) {
    for (let i = 0; i < parents.length && i < composed.length; i++) {
      if (marked.has(parents[i]!)) {
        marked.add(composed[i]!);
      }
    }
  } else if (parents.some(p => marked.has(p))) {
    for (const text of composed) {
      marked.add(text);
    }
  }
  return composed;
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
  const units = parentUnits(parents, e);
  const parts = child.selectors.map((c) => {
    if (!selectorBranchHasAmpersand(c)) {
      return mapMaybe(resolveSelectorBranch(c, frame, e), canon => units.map(unit => unit + ' ' + canon));
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

/** [nesting] Join opaque ancestor `A` with an all-`&`-less child list, prefix
 * factored: `A` is emitted ONCE and each group of child branches folds into a
 * single `:is(...)` (never repeated inside the `:is()`). `#…#deux` +
 * `#fourth,#five,#six` → `#…#deux :is(#fourth, #five, #six)`; a single child
 * joins plainly (`A child`, honouring its leading combinator).
 *
 * The groups come from the shared `:is()` grouping ({@link nestingGroupKey},
 * {@link partitionGroups}), in order of first appearance:
 * - `'native'` (default) groups branches of equal specificity that may sit inside
 *   `:is()`, so a fold changes neither specificity, matching, nor
 *   invalid-selector behaviour: `.t` + `th, .x, td, thead th` →
 *   `.t :is(th, td), .t .x, .t thead th`.
 * - `'compact'` puts every descendant branch in one group (group-max
 *   specificity), except a branch carrying a pseudo-element, which `:is()`
 *   cannot hold (ledger O14).
 *
 * A branch that LEADS WITH A COMBINATOR is never grouped; it is emitted as its
 * own header branch with the combinator hoisted out — `.no-gutters` +
 * `> .col, > [class*="col-"]` becomes `.no-gutters > .col, .no-gutters >
 * [class*="col-"]`, the CSS-Nesting desugaring. */
function opaqueJoin(a: string, child: SelectorList, frame: Frame | null, e: Emit): MaybePromise<string[]> {
  const canons = child.selectors.map(c => resolveSelectorBranch(c, frame, e));
  return combineAll(canons, (values) => {
    let out: string[];
    if (values.length === 1) {
      out = [a + ' ' + values[0]!];
    } else {
      const guarded = e.collapseMode !== 'compact';
      const groups: number[] = [];
      let oneGroup = true;
      for (const branch of child.selectors) {
        const key = nestingGroupKey(branch, guarded);
        oneGroup &&= key >= 0 && key === (groups[0] ?? key);
        groups.push(key);
      }
      if (oneGroup) {
        out = [a + ' :is(' + values.join(', ') + ')'];
      } else {
        const sizes = partitionGroups(groups);
        out = [];
        for (let i = 0; out.length < sizes.length; i++) {
          const group = groups[i]!;
          if (group !== out.length) {
            continue;
          }
          let left = sizes[group]! - 1;
          if (left === 0) {
            out.push(a + ' ' + values[i]!);
            continue;
          }
          let list = values[i]!;
          for (let j = i + 1; left > 0; j++) {
            if (groups[j] === group) {
              list += ', ' + values[j]!;
              left--;
            }
          }
          out.push(a + ' :is(' + list + ')');
        }
      }
    }

    /*
     * A branch under a pseudo-element ancestor unit may carry one, and so may a
     * child branch written on its own ({@link EvalCtx.pseudoElementParents}); a
     * grouped branch holds no pseudo-element of its own (ledger O14).
     */
    const marked = e.pseudoElementParents;
    if (marked.has(a)) {
      for (const text of out) {
        marked.add(text);
      }
    } else {
      for (let i = 0; i < child.selectors.length; i++) {
        if (mayCarryPseudoElement(child.selectors[i]!)) {
          marked.add(a + ' ' + values[i]!);
        }
      }
    }
    return out;
  });
}

function ownStrings(list: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> {
  return combineAll(list.selectors.map(c => expandSelectorBranch(c, frame, e, true)), values => values.flat());
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
      parts.push(g.branches);
      continue;
    }
    parts.push(mapMaybe(resolveSelectorBranch(c, frame, e), value =>
      markComposedBranches([], c, [selectorBranchHasAmpersand(c) ? value.split('&').join('').trim() : value], e)));
  }
  return combineAll(parts, values => values.flat());
}

/** [nesting] Nested-mode own selectors at a ROOT context (no parent): a parentless
 * `&` FOLLOWED BY other compound/descendant content drops to that content
 * (`& .underParents` → `.underParents`, Less elides the parentless ampersand), but
 * a LONE `&` cannot become an empty selector, so it is preserved VERBATIM — the v5
 * transparent-group form a nested `& when (…) { … }` / `& { … }` keeps (see
 * `tests-config/namespacing/namespacing-7`). Non-ampersand selectors are canonical. */
const rootStringsNested = (list: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<string[]> =>
  combineAll(list.selectors.map((c) => {
    /*
     * Reuse `ownStrings`' expansion so captures/interpolation branch identically;
     * only rewrite the parentless `&` on `&`-bearing branches.
     */
    if (!selectorBranchHasAmpersand(c)) {
      return expandSelectorBranch(c, frame, e);
    }
    return mapMaybe(expandSelectorBranch(c, frame, e), branches => branches.map((value) => {
      const stripped = value.split('&').join('').trim();
      return stripped === '' ? value : stripped;
    }));
  }), values => values.flat());

/* ------------------------------------------------------------- emit engine */

/**
 * [extend/dynamic] One recorded target header slot: the render-buffer chunk holding a
 * rule's emitted selector header, plus everything needed to recompose it once the
 * deferred extend fold knows the rule's complete extended selector. Keyed per EMISSION
 * (`token` distinguishes loop/mixin iterations that share one canonical Ruleset node).
 */
interface DynExtendSlot {
  rule: Ruleset;
  token: object | undefined;
  chunkIndex: number;
  indent: string;
  hoistMode: boolean;

  /** The visible header branch texts actually emitted into the chunk. Serves as both
   * the change-detection baseline and the fallback header when the re-solve leaves
   * this rule unchanged. */
  emitted: string[];

  /** [import:reference] The rule was emitted inside a `(reference)` import: its own
   * seed branch is HIDDEN, so if no visible extender folds in, its block (chunks
   * `chunkIndex`…`blockEnd`) is blanked; otherwise its header is rewritten to the
   * visible extender branches only. */
  hiddenRef: boolean;

  /** The hidden rule had no visible branch when the walk emitted it: its block is
   * RESERVED for an extend the fold may still fold in, and blanked when none does. */
  reserved: boolean;

  /** Exclusive end of the block's chunk range (for blanking a hidden-ref rule the
   * fold leaves with no visible branch). */
  blockEnd: number;

  /** The header was emitted by the NESTED writer (`writeNestedRule`): the deferred
   * rewrite recomposes it from the re-solved NESTED projection (own-local `nestedPlan`
   * header), not the flat composed header. */
  nested: boolean;
}

/** [extend/dynamic] Facts collected during the one render walk for the deferred fold. */
interface DynamicExtendState {
  root: Stylesheet;

  /** The pre-walk STATIC overlay (reference/static imported subjects) this render's
   * deferred fold must re-include alongside the dynamic facts. */
  baseOverlay: PlanOverlay;

  /** At-rule scope ids shared by the walk and the deferred fold's planner. */
  atRuleScopes: AtRuleScopes;

  /** The at-rule scope the walk is currently emitting into (EXTEND-SEMANTICS §8). */
  scope: number[];

  /** The sheet boundary the walk is currently emitting (a composed module or a
   * `(reference)` sheet): the import planner's, by import placement (`Emit.importPlacements`)
   * for a `(reference)` sheet and by module identity for a `@compose`. */
  boundary: ExtendBoundary | null;
  moduleBoundaries: Map<string, ExtendBoundary>;

  /**
   * The flat writer's open rules, outermost first: each rule, its composed header,
   * and how its extend path starts (`PATH_NESTED` / `PATH_ROOT` / `PATH_OPAQUE`).
   * The selector IR of a path is built only when a recorded fact reads it
   * (`dynamicPathAt`), then kept in `pathMemo`.
   */
  pathRules: Ruleset[];
  pathHeaders: string[][];
  pathKinds: number[];
  pathMemo: Array<Level[] | undefined>;

  /** The walk's one resolution of an open rule's interpolated selector, when it has one
   * ({@link resolvedSelectorList}); its selector IR is built from it. */
  pathSelectors: Array<SelectorList | undefined>;

  /** Selector IR built once per canonical node, however often the walk places it: a
   * rule's own level, and an `:extend()`'s target branches. */
  ownLevels: Map<Ruleset, Level>;
  targetBranches: Map<ExtendInstruction, Branch[]>;

  /** Hidden `(reference)` rules a walk-recorded extend may still reveal, and the
   * hidden rules enclosing them (#355). Null when nothing can be revealed. */
  revealRules: ReadonlySet<Ruleset> | null;
  revealAncestors: ReadonlySet<Ruleset> | null;

  /** Hidden at-rules around the rules in `revealRules`, and the chunk ranges of those
   * the walk wrote only as reserved containers (parallel arrays). */
  revealAtRules: ReadonlySet<AtRuleBlock> | null;
  containerStarts: number[];
  containerEnds: number[];

  /** Rules already accounted for statically (main + static imported preflight); a
   * rule outside this set is a dynamic emission whose facts are recorded at emit. */
  staticRules: Set<Ruleset>;
  subjects: PlanSubject[];
  instructions: PlanInstruction[];
  slots: DynExtendSlot[];
  order: number;

  /** [extend/dynamic] Side channel: the chunk index (and indent) of the header
   * `flushBlock` most recently PUT, or -1 when it reopened a merged block / wrote no
   * header. The rule-emitting caller reads it to register a target slot. */
  pendingHeaderChunk: number;
  pendingHeaderIndent: string;
}

interface Emit extends EvalCtx {
  chunks: string[];

  /*
   * Source-map positions. During the walk `start`/`end` are CHUNK indices: async
   * fills, null drops and late extend headers rewrite chunks after the walk, so
   * character offsets are resolved once, from the final chunks, in `finalize`.
   */
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

  /* [nested] flatten STYLE (only meaningful when `collapse`): `'compact'` folds
   * every descendant child branch into one `:is(…)`; anything else — incl. unset
   * — is `'native'`, folding only equal-specificity branches (see `opaqueJoin`).
   * Read only via `!== 'compact'`, so unset == native. */
  collapseMode?: 'native' | 'compact';

  /*
   * [extend] per-rule extend overrides, or null when the document has no
   * `:extend()` (zero-cost gate: emit is byte-identical to the no-extend path).
   */
  extends: ExtendResults | null;

  /*
   * [extend/dynamic] Walk-time extend recording for DYNAMIC placements (`each`/`$for`
   * loop bodies and mixin-call bodies, main or imported), the deferred-rewrite path
   * that replaces the reverted cold re-evaluation (ledger X12 / EXTEND-SEMANTICS §1a).
   * Allocated only when the document actually has a dynamic extend surface; null (and
   * zero-cost) otherwise. Extender facts are recorded as the ONE render walk emits each
   * rule (its selector already composed); target headers are recorded as addressable
   * render-buffer slots; after the walk `foldDynamicExtends` folds the extenders into
   * the target slots. It never re-drives evaluation.
   */
  dynamicExtend: DynamicExtendState | null;

  /*
   * [extend/dynamic] Ruleset nodes already accounted for statically — the main
   * document's own subjects plus the pre-walk STATIC imported preflight's subjects.
   * A rule NOT in this set, when emitted, was reached through a dynamic expansion and
   * has its extend facts recorded at emit time instead. Populated only when
   * `dynamicExtend` is active.
   */
  importedStaticExtendRules: Set<Ruleset> | null;

  /*
   * [extend/dynamic] Set by the pre-walk static imported preflight (which runs only
   * when the graph has an extend) when an imported document has a placement it cannot
   * see — a `$for`/`each()`, mixin-definition or detached-ruleset body that places a
   * rule, or an `@import` inside a ruleset — so walk-time recording must run.
   */
  importedWalkPlacement: boolean;

  /*
   * [extend] The planner's placement for each `(reference)` or `(multiple)` import it
   * planned (see {@link ImportPlacements}), and the token of the import placement being
   * emitted (undefined in the static placement). Extend projections are looked up by
   * placement, so two copies of one canonical rule never share one (#359).
   */
  importPlacements: ImportPlacements | null;
  importPlacement: object | undefined;

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
  lastBlock: { parentKey: object | null; header: string; depth: number; endChunks: number; droppedSemi: boolean };

  /*
   * [recursion-backstop] current NESTED mixin-expansion depth (0 at the top of a
   * document walk). `expandCall` bumps it around each expansion and raises a clean
   * `RangeError` once it reaches `MAX_MIXIN_DEPTH` — catching a bad-guard runaway
   * before a native stack overflow. Threaded through `scratchEmit`.
   */
  mixinDepth: number;

  /**
   * Emit-once registry of loaded module identities, filled as each import or
   * compose renders: `null` for a module an `@import` folded in, the activation
   * frame for a shared `@compose`d module.
   */
  loadedImports: Map<string, Frame | null> | null;

  /** Every document an `@import` of any kind placed, for {@link isReferenceReimport}. */
  placedDocuments: Set<string> | null;

  /** The one activation of each shared `@compose`d module identity ({@link activateComposeEdge}). */
  moduleActivations: Map<string, Frame> | null;

  /**
   * `@compose` edges the import planner activated ahead of output, each removed
   * when execution reaches it — so an entry is an edge not yet executed.
   */
  composeActivations: Map<StyleImport, ComposeActivation> | null;

  /**
   * `@import`s inside a planner-activated `@compose` module whose facts were
   * published into that activation ahead of output, per activation, so its
   * body does not publish them again.
   */
  prepublishedModuleImports: Map<Frame, Set<Statement>> | null;

  /**
   * [module config] Per module IDENTITY (`loaded.key`) `set` configuration, so a
   * later plain `@compose`/`@use` of the same module inherits it and a conflicting
   * reconfiguration can be rejected (spec R6 Part E §E.2/E-d).
   */
  moduleConfigs: Map<string, StyleImportConfig> | null;

  /** A `(multiple)` import makes its transitive imports multiple too. */
  multipleImportDepth: number;

  /** A `(reference)` import contributes facts but suppresses its direct output. */
  referenceImportDepth: number;

  /**
   * How many stay-open at-rule bodies (`@media`/`@supports`/…) enclose the
   * current cursor. A mixin-spliced bubbleable at-rule with no selector context
   * nests one level deeper WHEN it lands inside such a body — matching a
   * directly-authored nested at-rule — instead of projecting flush at the body's
   * own level (which would drop the wrapper's indent). Zero at the document root,
   * where a spliced at-rule stays flush-left.
   */
  atRuleBodyDepth: number;

  /** The render-owned Context import capability, retained for nested placement. */
  importDocument?: SerializeOptions['importDocument'];

  /** Canonical documents already loaded by the extend planner, consumed once by emission. */
  plannedImportDocuments: WeakMap<StyleImport, PlannedImportDocument> | null;

  /**
   * Render-local document-root import facts already published before output
   * evaluation. The first identity is stored directly; a strong Set appears
   * only at the second distinct identity and dies with this render.
   */
  prepublishedImportFacts: PrepublishedImportFacts;

  /** Document-root CSS terminals already written in the required output prelude. */
  hoistedCssImports: Set<AtRuleStatement> | null;

  /** Block-comment trivia runs already replayed during this render. */
  emittedBlockTrivia: EmittedTrivia;

  /** Pending trivia owned by the currently active leaf buffer. */
  pendingLeafBlockComments: string[] | null;

  /** Identity of the leaf buffer that owns {@link pendingLeafBlockComments}. */
  pendingLeafBlockCommentOwner: Leaf[] | null;
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
    allowCallerScope: e.allowCallerScope, // [R16] preserve the caller-read policy
    trivia: e.trivia,
    excluded: e.excluded,
    propNames: e.propNames,
    pseudoElementParents: e.pseudoElementParents,
    optional: e.optional,
    calcDepth: e.calcDepth,
    scopedFunctionNames: e.scopedFunctionNames, // [plugin/P1] preserve the registered-name gate
    lambdaFunctionNames: e.lambdaFunctionNames, // [lambda-fn] preserve the user-`@function` gate
    fnScopeVersion: e.fnScopeVersion,
    pluginHost: e.pluginHost, // [plugin/P2] preserve the injected plugin runtime
    moduleFns: e.moduleFns,
    moduleReferenceValues: e.moduleReferenceValues,
    pluginRawBindings: e.pluginRawBindings,
    mixinUrlBindings: e.mixinUrlBindings,
    mixinValueBindings: e.mixinValueBindings,
    compressedBindings: e.compressedBindings,
    writtenFrom: undefined,
    snapshotValues: e.snapshotValues,
    io: e.io, // [io] preserve the file-read capability
    chunks: [],
    positions: null,
    pending: [],
    drops: [],
    depth: 0,
    collapse: true,
    compress: e.compress ?? false,
    extends: null,
    dynamicExtend: null,
    importedStaticExtendRules: null,
    importedWalkPlacement: false,
    importPlacements: null,
    importPlacement: undefined,
    hoistMode: false,
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1, droppedSemi: false }, // [adjacent-merge]
    mixinDepth: 0, // [recursion-backstop] fresh scratch walk; own runaway backstop
    loadedImports: null,
    placedDocuments: null,
    moduleActivations: null,
    composeActivations: null,
    prepublishedModuleImports: null,
    moduleConfigs: null,
    multipleImportDepth: 0,
    referenceImportDepth: 0,
    atRuleBodyDepth: 0,
    plannedImportDocuments: null,
    plannedModuleImports: e.plannedModuleImports,
    preparedImportsOwnedByCaller: false,
    prepublishedImportFacts: null,
    hoistedCssImports: null,
    emittedBlockTrivia: new EmittedTrivia(),
    pendingLeafBlockComments: null,
    pendingLeafBlockCommentOwner: null
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
function normalizeImportant(bytes: string, compress = false): string {
  // [compress] `!important` — no leading space, canonical spelling; valid and shorter.
  if (compress) {
    const m = /(\s*)(!\s*important)\s*$/iu.exec(bytes);
    return (m ? bytes.slice(0, m.index) : bytes) + '!important';
  }
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
    const lead = firstOnNewLine && e.compress !== true ? `\n${s}` : s;
    const r = contIndent !== undefined && e.compress !== true ? reindentContinuations(lead, contIndent) : lead;
    return emitImportant || sink.hit ? normalizeImportant(r, e.compress === true) : r;
  };
  const valStart = e.chunks.length;
  let bytes: string | null = null;
  if (isThenable(b)) {
    putPending(e, mapMaybe(b, finish));
  } else {
    bytes = finish(b);
    put(e, bytes);
  }
  if (e.positions && positionNode) {
    e.positions.push({ node: positionNode, type: positionNode.type, start: valStart, end: e.chunks.length, source: srcFile(e) });
  }
  return bytes;
}

/* ------------------------------------------------------------- [extend] */

function put(e: Emit, s: string): void {
  e.chunks.push(s);
}

/**
 * [async] Reserve ONE chunk, in source order, for bytes that settle after the
 * walk; `finish` fills it before offsets are resolved. A position recorded over
 * the reserved chunk therefore maps the settled bytes like any written chunk.
 */
function putPending(e: Emit, bytes: MaybePromise<string>): void {
  e.pending.push({ i: e.chunks.length, p: Promise.resolve(bytes) });
  e.chunks.push('');
}

/** Turn the walk's chunk-index positions into character offsets of the final output. */
function resolvePositionOffsets(chunks: readonly string[], positions: Position[]): void {
  const offsets = new Array<number>(chunks.length + 1);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    offsets[i] = off;
    off += chunks[i]!.length;
  }
  offsets[chunks.length] = off;
  for (const position of positions) {
    position.start = offsets[Math.min(position.start, chunks.length)]!;
    position.end = offsets[Math.min(position.end, chunks.length)]!;
  }
}

/* ----------------------------------------------------------- [compress] layout
 * Structural whitespace/layout helpers. Each returns the EXACT pretty-print bytes
 * when compress is off, so uncompressed output stays byte-identical; under compress
 * indentation and newlines vanish. The value serializers stay pure — compress is a
 * flag on the context, never a global. */

/** Block header/close indentation for the current depth (empty under compress). */
function blockIndent(e: Emit): string {
  return e.compress === true || e.depth <= 0 ? '' : INDENT.repeat(e.depth);
}

/** Leaf/body indentation, one level in from the block (empty under compress). */
function bodyIndent(e: Emit): string {
  return e.compress === true ? '' : INDENT.repeat(e.depth + 1);
}

/** A record newline, or nothing under compress. */
function nl(e: Emit): string {
  return e.compress === true ? '' : '\n';
}

/** The block-open bytes: `{` under compress, ` {\n` pretty. */
function blockOpen(e: Emit): string {
  return e.compress === true ? '{' : ' {\n';
}

/** The declaration terminator: `;` under compress, `;\n` pretty. */
function declEnd(e: Emit): string {
  return e.compress === true ? ';' : ';\n';
}

/**
 * Emit a block-closing brace. Pretty: `idt` + `}\n`. Compress: DROP the trailing
 * `;` of the block's last declaration (blank its chunk in place — never splice, so
 * pending async chunk indices stay valid), note whether it did on `lb` (so an
 * adjacent-merge reopen can restore the separator), then a bare `}`.
 */
function emitBlockClose(e: Emit, idt: string, lb?: Emit['lastBlock']): void {
  if (e.compress === true) {
    const c = e.chunks;
    let k = c.length - 1;
    while (k >= 0 && c[k] === '') {
      k--;
    }
    let dropped = false;

    /*
     * [compress] a custom property keeps its `;` — its value is an opaque token
     * stream and dropping the terminator lets it absorb trailing bytes.
     */
    if (k >= 0 && c[k] === ';' && e.lastDeclCustom !== true) {
      c[k] = '';
      dropped = true;
    }
    if (lb) {
      lb.droppedSemi = dropped;
    }
    put(e, '}');
    return;
  }
  if (idt) {
    put(e, idt);
  }
  put(e, '}\n');
}

/**
 * [compress] Whether a comment survives compression. Pretty keeps every comment;
 * compress keeps only `/*! … *&#47;` bang comments (license headers), matching
 * Less 4.x / dart-sass / cssnano / lightningcss.
 */
function keepComment(e: EvalCtx, text: string): boolean {
  return e.compress !== true || text.startsWith('/*!');
}

/** Emit one block comment on its own indented line (pretty), or bare with no
 * surrounding whitespace (compress) — and only when it survives {@link keepComment}. */
function putBlockComment(e: Emit, indent: string, text: string): void {
  if (!keepComment(e, text)) {
    return;
  }
  if (e.compress === true) {
    put(e, text);
    return;
  }
  put(e, indent);
  put(e, text);
  put(e, '\n');
}

/**
 * [compress] The composed selector header. Pretty keeps the authored-trivia form
 * (or the `,\n`+indent join). Compress joins branches with a bare `,` and collapses
 * combinator whitespace on the final string only (never on the branch strings used
 * for extend/adjacency matching upstream).
 */
function composeSelectorHeader(e: Emit, own: string[], idt: string, authoredHeader: string | null): string {
  if (e.compress === true) {
    return compressSelectorHeader(own.join(','));
  }
  return authoredHeader ?? (idt ? own.join(',\n' + idt) : own.join(',\n'));
}

/**
 * The source file active at this emit point. `context.sourceContext` follows the
 * `withSourceOwner`/`withDocument` scope stack, so during an imported document's
 * emission this returns the IMPORT's file (with its own `source` text and path).
 * Read only from position-push sites, i.e. only when `trackPositions` is on.
 */
function srcFile(e: Emit): SourceContext['file'] {
  return e.context?.sourceContext?.file;
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

  /** Read-only: never allocates. An absent bitset means nothing is owned yet.
   *  A HELD run counts as owned: no replay may write it. */
  hasIndex(table: CommentTable, i: number): boolean {
    if (i < 0) {
      return false;
    }
    const owned = this.bits.get(table);
    return (owned?.[table.canonical[i]!] ?? 0) !== 0;
  }

  /** Claim run `i`. A HELD run stays held: it is already closed to every replay. */
  addIndex(table: CommentTable, i: number): void {
    if (i < 0) {
      return;
    }
    const owned = this.bitsOf(table);
    const at = table.canonical[i]!;
    if (owned[at] !== HELD_RUN) {
      owned[at] = OWNED_RUN;
    }
  }

  /**
   * Whether a leaf being written may write run `i`, its own inline comment.
   * A free run is claimed. A HELD run sits inside a callable body, and a leaf
   * of that body is only ever written by an expansion of it — later than the
   * expansion's walk, so after the run was held again — so the leaf writes it
   * and leaves it held for the next expansion's leaf.
   */
  takeForLeaf(table: CommentTable, i: number): boolean {
    const owned = this.bitsOf(table);
    const at = table.canonical[i]!;
    if (owned[at] === OWNED_RUN) {
      return false;
    }
    if (owned[at] === FREE_RUN) {
      owned[at] = OWNED_RUN;
    }
    return true;
  }

  /**
   * HOLD one run of a callable body — a mixin definition's or a detached
   * ruleset's — unless something already owns it. Its comments belong to the
   * body, not to the statement list the definition sits in, so every replay
   * skips a held run; only an expansion of the body writes it ({@link openCopy}).
   */
  holdIndex(table: CommentTable, i: number): void {
    const owned = this.bitsOf(table);
    const at = table.canonical[i]!;
    if (owned[at] === FREE_RUN) {
      owned[at] = HELD_RUN;
    }
  }

  /**
   * Open ONE written copy of a body: every run from run `from` up to offset
   * `end` is freed for it, whatever owned it, and the runs that were owned or
   * held are returned for {@link closeCopy} (`undefined` when none was). Each
   * placement of a body — a rule at its place, a call, a ruleset argument, a
   * loop iteration — writes its own copy of the body's comments.
   */
  openCopy(table: CommentTable, from: number, end: number): SavedRuns | undefined {
    const owned = this.bits.get(table);
    if (owned === undefined) {
      return undefined;
    }
    let states: Uint8Array | undefined;
    for (let i = from; i < table.runs.length && table.runStart[i]! < end; i++) {
      const at = table.canonical[i]!;
      if (owned[at] !== FREE_RUN) {
        states ??= new Uint8Array(firstRunAtOrAfter(table, end) - from);
        states[i - from] = owned[at]!;
        owned[at] = FREE_RUN;
      }
    }
    return states === undefined ? undefined : { from, states };
  }

  /**
   * Close the copy a replay opened ({@link openCopy}). A run that was held or
   * owned before gets that state back, so a definition stays held for its next
   * expansion. A run that was free keeps what the copy left: the comments it
   * wrote stay owned, so no later replay of the enclosing body writes them again.
   */
  closeCopy(replay: BodyTriviaReplay | undefined): void {
    const saved = replay?.saved;
    if (saved === undefined) {
      return;
    }
    const table = replay!.table;
    const owned = this.bitsOf(table);
    for (let k = 0; k < saved.states.length; k++) {
      if (saved.states[k] !== FREE_RUN) {
        owned[table.canonical[saved.from + k]!] = saved.states[k]!;
      }
    }
  }

  private bitsOf(table: CommentTable): Uint8Array {
    let owned = this.bits.get(table);
    if (owned === undefined) {
      owned = new Uint8Array(table.runs.length);
      this.bits.set(table, owned);
    }
    return owned;
  }
}

/** The run states one callable-body expansion saved ({@link EmittedTrivia.openCopy}). */
interface SavedRuns {
  readonly from: number;
  readonly states: Uint8Array;
}

/** {@link EmittedTrivia} run states. */
const FREE_RUN = 0;
const OWNED_RUN = 1;
const HELD_RUN = 2;

function inlineBlockCommentText(
  table: CommentTable,
  runIndex: number,
  trimLeadingWhitespace = false
): string {
  const source = table.src;
  if (source === undefined) {
    return '';
  }
  let out = '';
  let pos = table.runStart[runIndex]!;
  const firstComment = table.commentAt[runIndex]!;
  const commentEnd = table.commentAt[runIndex + 1]!;
  for (let comment = firstComment; comment < commentEnd; comment++) {
    const start = table.commentStart[comment]!;
    let textStart = start;
    while (textStart > pos) {
      const char = source.charCodeAt(textStart - 1);
      if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
        break;
      }
      textStart--;
    }
    if (comment === firstComment && trimLeadingWhitespace) {
      textStart = start;
    }

    let textEnd = table.commentEnd[comment]!;
    const runEnd = table.runEnd[runIndex]!;
    while (textEnd < runEnd) {
      const char = source.charCodeAt(textEnd);
      if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
        break;
      }
      textEnd++;
    }

    out += source.slice(textStart, textEnd);
    pos = textEnd;
  }
  return out;
}

/* Reads the inline span slots directly: these run per statement per render, so
 * they must not materialize an `{ start, end }` object to discard one half. */
function statementStartOf(node: Statement): number | undefined {
  if (node.type === 'VariableDeclaration') {
    return undefined;
  }

  /* A keyframe block spans the Ruleset but not its selector; read whichever is spanned. */
  const start = node.type === 'Ruleset' && sourceStartOf(node.selector) !== NO_SPAN
    ? sourceStartOf(node.selector)
    : sourceStartOf(node);
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

/** Whether `[start, end)` lies inside one of `spans` (source-ordered and disjoint): a binary search. */
function insideSpan(spans: readonly ReplaySpan[], start: number, end: number): boolean {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans[middle]!.start <= start) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low > 0 && end <= spans[low - 1]!.end;
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

    /* `excludedSpans` is the root replay's source-ordered statement spans. */
    if (insideSpan(excludedSpans, runStart, runEnd)) {
      continue;
    }
    const from = table.commentAt[i]!;
    const to = table.commentAt[i + 1]!;
    if (from === to) {
      continue;
    }
    e.emittedBlockTrivia.addIndex(table, i);
    for (let c = from; c < to; c++) {
      const text = src.slice(table.commentStart[c]!, table.commentEnd[c]!);
      if (!keepComment(e, text)) {
        continue;
      }
      putBlockComment(e, indent, text);
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

/** Take the indexed inline comment run owned by a statement's value boundary. */
function takeIndexedInlineBlockCommentTriviaAfter(node: Statement, e: Emit): string | null {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return null;
  }
  const table = commentTableOf(trivia);
  const source = table.src;
  if (source === undefined) {
    return null;
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return null;
  }
  const spanEnd = sourceEndOf(node);

  /* This path only emits comments. A general trivia-boundary lookup forces a
   * legacy Parseman root map for all whitespace gaps; comment runs are already
   * sparse and source ordered. */
  const trailing = commentRunStartingAt(table, spanEnd);
  if (trailing >= 0 && runHasBlockComment(table, trailing) && e.emittedBlockTrivia.takeForLeaf(table, trailing)) {
    return inlineBlockCommentText(table, trailing);
  }
  for (let i = firstRunAtOrAfter(table, spanStart); i < table.runs.length; i++) {
    if (table.runStart[i]! > spanEnd) {
      break;
    }
    const runEnd = table.runEnd[i]!;
    if (runEnd > spanEnd || !runHasBlockComment(table, i)) {
      continue;
    }
    let index = runEnd;
    while (index < spanEnd) {
      const char = source.charCodeAt(index);
      if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
        break;
      }
      index++;
    }
    if (index !== spanEnd || !e.emittedBlockTrivia.takeForLeaf(table, i)) {
      continue;
    }
    return inlineBlockCommentText(table, i);
  }
  return null;
}

/** Take the one inline comment run owned by a statement's value boundary. */
function takeInlineBlockCommentTriviaAfter(node: Statement, e: Emit): string | null {
  const indexed = takeIndexedInlineBlockCommentTriviaAfter(node, e);
  if (indexed !== null) {
    return indexed;
  }
  const trivia = e.trivia;
  if (trivia === undefined) {
    return null;
  }
  const source = commentTableOf(trivia).src;
  if (source === undefined) {
    return null;
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return null;
  }
  const spanEnd = sourceEndOf(node);
  let end = spanEnd;
  while (end > spanStart) {
    const char = source.charCodeAt(end - 1);
    if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
      break;
    }
    end--;
  }
  if (end - spanStart < 2 || source.charCodeAt(end - 2) !== 42 || source.charCodeAt(end - 1) !== 47) {
    return null;
  }
  const open = lastIndexInSourceRange(source, '/*', spanStart, end);
  if (open < 0) {
    return null;
  }
  let start = open;
  while (start > spanStart) {
    const char = source.charCodeAt(start - 1);
    if (char !== 32 && char !== 9 && char !== 10 && char !== 13 && char !== 12) {
      break;
    }
    start--;
  }
  return source.slice(start, end);
}

function emitInlineBlockCommentTriviaAfter(node: Statement, e: Emit): void {
  const text = takeInlineBlockCommentTriviaAfter(node, e);
  if (text !== null && keepComment(e, text)) {
    put(e, text);
  }
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
  // [compress] the name↔colon trivia (spacing/comments) is dropped under compress.
  if (e.compress === true) {
    return '';
  }
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

/*
 * Ledger F12: the comments written after a custom value's last part — the comment
 * run that starts where the value ends, before its `;` or `!important` — are its
 * trailing edge and stay in place: the value is written up to the last of them,
 * and the block's comment replay does not write them again. -1 when there is none.
 */
function customValueTrailingRun(table: CommentTable, valueEnd: number): number {
  const at = commentRunStartingAt(table, valueEnd);
  return at >= 0 && runHasBlockComment(table, at) ? at : -1;
}

/** Mark the comment runs a custom value writes in place: those inside it, and its trailing run (or -1). */
function markCustomValueBlockTrivia(source: string, span: AstSourceSpan, trailing: number, e: Emit): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }
  const table = commentTableOf(trivia);
  for (let i = firstRunAtOrAfter(table, span.start); i < table.runs.length; i++) {
    if (table.runStart[i]! > span.end) {
      break;
    }
    if (table.runs[i]!.src === source && (i === trailing || table.runEnd[i]! <= span.end) && runHasBlockComment(table, i)) {
      e.emittedBlockTrivia.addIndex(table, i);
    }
  }
}

/*
 * Where a custom value's reference was written. A bare reference (Less `@c`,
 * not unquoted) is its own source span. An interpolation's span is not kept,
 * so its hole is the next `@{…}` / `${…}` / `#{…}` the authored bytes hold.
 */
function customValueHole(source: string, part: { ref: ValueNode; unquote: boolean }, cursor: number, end: number): AstSourceSpan | null {
  if (!part.unquote) {
    const start = sourceStartOf(part.ref);
    const stop = sourceEndOf(part.ref);
    return start >= cursor && stop <= end ? { start, end: stop } : null;
  }
  let open = -1;
  for (const opener of CUSTOM_VALUE_HOLE_OPENERS) {
    const at = source.indexOf(opener, cursor);
    if (at >= 0 && (open < 0 || at < open)) {
      open = at;
    }
  }
  const close = open < 0 || open >= end ? -1 : source.indexOf('}', open + 2);
  return close < 0 || close >= end ? null : { start: open, end: close + 1 };
}

const CUSTOM_VALUE_HOLE_OPENERS = ['@{', '${', '#{'] as const;

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
  const valueTable = commentTableOf(trivia);

  const valueEnd = sourceEndOf(value);
  const trailing = customValueTrailingRun(valueTable, valueEnd);
  const hasTrailing = trailing >= 0;
  const span = { start: spanStart, end: hasTrailing ? valueTable.commentEnd[valueTable.commentAt[trailing + 1]! - 1]! : valueEnd };
  let source: string | undefined = hasTrailing ? valueTable.runs[trailing]!.src : undefined;
  let sawComment = hasTrailing;
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
    markCustomValueBlockTrivia(source, span, hasTrailing ? trailing : -1, e);
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
    const hole = customValueHole(source, part, cursor, span.end);
    if (hole === null) {
      return null;
    }
    pieces.push(source.slice(chunkStart, hole.start));
    pieces.push(resolveRefBytes(part, frame, e));
    cursor = hole.end;
    chunkStart = cursor;
  }
  pieces.push(source.slice(chunkStart, span.end));
  markCustomValueBlockTrivia(source, span, hasTrailing ? trailing : -1, e);
  return combineAll(pieces, values => values.join(''));
}

/**
 * A statement that writes nothing where it stands owns its comments, so no
 * replay writes them there. The comments inside a CALLABLE body — a mixin
 * definition's, or a detached ruleset's bound by a declaration — are HELD
 * instead: they belong to the body, and each expansion writes its own copy.
 */
function markSilentStatementBlockCommentTrivia(node: Statement, e: Emit): void {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return;
  }
  const body = node.type === 'MixinDefinition'
    ? node
    : node.type === 'VariableDeclaration' && !isValueSlotArray(node.value) && node.value.type === 'AnonymousMixin'
      ? node.value
      : undefined;

  /* The body's own span holds its comments even when the statement records none. */
  if (body !== undefined) {
    holdBodyTrivia(body, e);
  }
  const spanStart = sourceStartOf(node);
  if (spanStart === NO_SPAN) {
    return;
  }
  const spanEnd = sourceEndOf(node);
  const table = commentTableOf(trivia);

  /* No recorded body span: hold all of it rather than claim the body's comments. */
  const holdAll = body !== undefined && bodyStartOf(body) === NO_SPAN;
  for (let i = firstRunAtOrAfter(table, spanStart); i < table.runs.length; i++) {
    if (table.runStart[i]! > spanEnd) {
      break;
    }
    if (table.runEnd[i]! > spanEnd || !runHasBlockComment(table, i)) {
      continue;
    }
    if (holdAll) {
      e.emittedBlockTrivia.holdIndex(table, i);
    } else {
      e.emittedBlockTrivia.addIndex(table, i); // a held body run stays held
    }
  }
}

/**
 * HOLD the comment runs of a body that only its expansions write — a loop body,
 * written once per iteration ({@link EmittedTrivia.holdIndex}).
 */
function holdBodyTrivia(owner: object, e: Emit): void {
  const start = bodyStartOf(owner);
  if (start !== NO_SPAN) {
    holdTriviaBetween(start, bodyEndOf(owner), e);
  }
}

/** HOLD the comment runs between two offsets ({@link holdBodyTrivia}). */
function holdTriviaBetween(start: number, end: number, e: Emit): void {
  if (e.trivia === undefined) {
    return;
  }
  const table = commentTableOf(e.trivia);
  for (let i = firstRunAtOrAfter(table, start); i < table.runs.length && table.runStart[i]! <= end; i++) {
    if (table.runEnd[i]! <= end && runHasBlockComment(table, i)) {
      e.emittedBlockTrivia.holdIndex(table, i);
    }
  }
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
    putBlockComment(e, indent, src.slice(table.commentStart[c]!, table.commentEnd[c]!));
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

/** Exact binary lookup for one retained parser-owned boundary run. */
function valueBoundaryRunIndex(table: CommentTable, range: AstSourceSpan): number {
  for (let runIndex = firstRunAtOrAfter(table, range.start);
    runIndex < table.runs.length && table.runStart[runIndex] === range.start;
    runIndex++) {
    if (table.runEnd[runIndex] === range.end && runHasBlockComment(table, runIndex)) {
      return runIndex;
    }
  }
  return -1;
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

/** Write and own one exact parser-owned boundary gap, omitting line comments. */
function putValueBoundaryTrivia(
  e: Emit,
  range: AstSourceSpan | null,
  fallback: string
): void {
  if (range === null || e.trivia === undefined) {
    put(e, fallback);
    return;
  }
  const table = commentTableOf(e.trivia);
  const src = table.src;
  if (src === undefined) {
    put(e, fallback);
    return;
  }
  const runIndex = valueBoundaryRunIndex(table, range);
  if (runIndex < 0) {
    put(e, fallback);
    return;
  }
  let cursor = range.start;
  for (let comment = table.commentAt[runIndex]!;
    comment < table.commentAt[runIndex + 1]!;
    comment++) {
    const commentStart = table.commentStart[comment]!;
    let textStart = commentStart;
    while (textStart > cursor && isTriviaByte(src.charCodeAt(textStart - 1))) {
      textStart--;
    }
    let textEnd = table.commentEnd[comment]!;
    while (textEnd < range.end && isTriviaByte(src.charCodeAt(textEnd))) {
      textEnd++;
    }
    put(e, src.slice(textStart, textEnd));
    cursor = textEnd;
  }
  e.emittedBlockTrivia.addIndex(table, runIndex);
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
        && keepComment(e, source.slice(index, commentEnd))
      ) {
        putBlockComment(e, indent, source.slice(index, commentEnd));
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

function withTrivia<T>(e: EvalCtx, next: TriviaMap | undefined, run: () => MaybePromise<T>): MaybePromise<T> {
  const previous = e.trivia;
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

function withDocumentTrivia<T>(e: Emit, document: Stylesheet, run: () => MaybePromise<T>): MaybePromise<T> {
  const next = triviaMapOf(document);
  return next === undefined ? run() : withTrivia(e, next, run);
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
          beforeCommaComments += inlineBlockCommentText(table, i);
        } else {
          afterCommaComments += inlineBlockCommentText(table, i, true);
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

    /* A held run belongs to a callable body inside this one, which writes it. */
    if (table.runEnd[i]! <= body.end && runHasBlockComment(table, i) && !e.emittedBlockTrivia.hasIndex(table, i)) {
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
  important: boolean;
  leadingBlockComments: readonly string[] | null;

  /** Produced by the core `$apply` expansion; its repeated output stays visible. */
  fromApply: boolean;

  /** A statement call's result, evaluated where the call stands ({@link placeStatementCall}). */
  callBytes: string | null;
}

function evaluatedLeaf(
  node: Statement,
  frame: Frame,
  important = false,
  fromApply = false,
  leadingBlockComments: readonly string[] | null = null,
  callBytes: string | null = null
): Leaf {
  return { node, frame, important, leadingBlockComments, fromApply, callBytes };
}

/**
 * [P37] Evaluate a call in statement position where it stands in the walk, as
 * the nested writer does, and place its result as a leaf. One that writes
 * nothing places none, so the block it would have stood alone in is elided
 * (ledger O6) — decided before the block is written, even when the call
 * settles asynchronously.
 */
function placeStatementCall(node: FunctionCall, frame: Frame, e: Emit, place: (leaf: Leaf) => void): MaybePromise<void> {
  return mapMaybe(statementCallBytes(node, frame, e), (bytes) => {
    if (bytes.length !== 0) {
      place(evaluatedLeaf(node, frame, false, false, null, bytes));
    }
  });
}

const EMPTY_LEAF_BLOCK_COMMENTS: string[] = [];

function takePendingLeafBlockComments(e: Emit, owner: Leaf[]): string[] {
  const pending = e.pendingLeafBlockCommentOwner === owner
    ? e.pendingLeafBlockComments
    : null;
  if (pending === null) {
    return EMPTY_LEAF_BLOCK_COMMENTS;
  }
  e.pendingLeafBlockComments = null;
  e.pendingLeafBlockCommentOwner = null;
  return pending;
}

function queueLeafBlockComments(e: Emit, owner: Leaf[], comments: string[]): void {
  if (comments.length === 0) {
    return;
  }
  const pending = e.pendingLeafBlockCommentOwner === owner
    ? e.pendingLeafBlockComments
    : null;
  if (pending === null) {
    e.pendingLeafBlockComments = comments;
    e.pendingLeafBlockCommentOwner = owner;
  } else {
    pending.push(...comments);
  }
}

/** Evaluate the lookup-sensitive facts shared by both output projections. */
function evaluateLeafStatement(
  node: Declaration | Comment,
  frame: Frame,
  propertyScope: Frame,
  e: Emit,
  important: boolean,
  fromApply: boolean,
  bodyTrivia: BodyTriviaReplay | undefined,
  group: Leaf[],
  place: (leaf: Leaf) => void
): void {
  queueBodyTriviaBefore(bodyTrivia, node, group, e);
  if (node.type === 'Comment') {
    place({ node, frame, important, leadingBlockComments: null, fromApply, callBytes: null });
    return;
  }
  skipBodyTrivia(bodyTrivia, node, e);

  const parts = nestedPropertyDeclarations(node);
  if (parts === null) {
    recordPropertyDeclaration(propertyScope, node, frame);
    place({ node, frame, important, leadingBlockComments: null, fromApply, callBytes: null });
    return;
  }
  for (const part of parts) {
    recordPropertyDeclaration(propertyScope, part, frame);
    place({ node: part, frame, important, leadingBlockComments: null, fromApply, callBytes: null });
  }
}

/** Publish a definition/variable independently of the selected writer. */
function evaluateSilentStatement(
  node: MixinDefinition | VariableDeclaration,
  frame: Frame,
  e: Emit
): void {
  if (node.type === 'MixinDefinition') {
    publishSelectedMixinDefinition(frame, node);
  } else {
    activateVariableDeclaration(node, frame, e);
  }
  markSilentStatementBlockCommentTrivia(node, e);
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
  const texts: Array<string | undefined> = [];
  const pseudos: PseudoSelector[] = [];
  for (let i = 0; i < comp.value.length; i++) {
    const sim = comp.value[i]!;
    texts.push(undefined);
    if (sim.type === 'PseudoSelector' && sim.args !== null) {
      if (pseudoHasInterp(sim)) {
        probePseudoInterp(sim, frame, e);
        pseudos.push(sim);
      }
      continue;
    }
    if (sim.interp !== null) {
      texts[i] = resolveSimpleTextSync(sim, frame, e);
    }
  }
  const tokens = resolvedCompoundTokens(comp.value, texts);
  comp.value.length = 0;
  for (const token of tokens) {
    comp.value.push(token);
  }
  for (const p of pseudos) {
    resolvePseudoInterpInPlace(p, frame, e);
  }
  comp._hasInterp = false;
  comp._canon = undefined;
}

/**
 * The tokens of a compound once its interpolated simples resolved to `texts` (undefined
 * for a token that is not one). Less interpolation is textual: an interpolation glued
 * straight onto a class or id name (`.c-@{n}`) continues that name, as the parser keeps
 * `.c-@{n}` one token everywhere but at the head of a statement-position compound
 * (`.a.c-@{n}`), so the resolved text joins the name (`.c-1`) instead of standing as a
 * token of its own (`1`), which no extend target could name. Only text that starts as
 * a name goes on: a value opening with a selector delimiter (`@v: ~".b"` in `.a@{v}`,
 * `:hover`, `[x]`) starts a simple of its own and stays a token of its own. Emitted
 * bytes are the same.
 */
function resolvedCompoundTokens(value: readonly SimpleToken[], texts: ReadonlyArray<string | undefined>): SimpleToken[] {
  const out: SimpleToken[] = [];
  for (let i = 0; i < value.length; i++) {
    const text = texts[i];
    if (text === undefined) {
      out.push(value[i]!);
      continue;
    }
    const parts = value[i]!.interp?.parts;
    const prev = out[out.length - 1];
    const next = text.charCodeAt(0);
    if (prev !== undefined && prev.type === 'SimpleSelector' && prev.interp === null && prev.text !== null
      && (prev.text.charCodeAt(0) === 0x2E /* . */ || prev.text.charCodeAt(0) === 0x23 /* # */)
      && parts !== undefined && parts.length > 0 && 'ref' in parts[0]!
      && (next === 0x2D /* - */ || next === 0x5F /* _ */ || next === 0x5C /* \ */ || next >= 0x80
        || (next >= 0x30 && next <= 0x39) || ((next | 32) >= 0x61 && (next | 32) <= 0x7A))) {
      out[out.length - 1] = simpleSelector(prev.text + text);
    } else {
      out.push(simpleSelector(text));
    }
  }
  return out;
}

/**
 * [extend/dynamic] `list` with every interpolated token resolved in `frame`: the ONE
 * resolution the walk makes of a rule's selector while extend recording is armed. The
 * writer composes the header from it and the recorder reads it as the rule's selector
 * structure, so an interpolated rule a mixin call, loop or import places is an extend
 * target part by part (ledger X7 as amended 2026-10-05) and nothing is resolved twice
 * (ledger X12). A resolved token is plain text, a glued name merged into the name it
 * continues ({@link resolvedCompoundTokens}). Null when the copy would not compose the
 * bytes the authored list does: a lone `@{name}` branch, which may expand to a captured
 * selector list, or a resolved `&` the template did not write (the authored list keeps
 * it literal text; the copy would compose it).
 */
function resolvedSelectorList(list: SelectorList, frame: Frame | null, e: EvalCtx): MaybePromise<SelectorList | null> {
  const branches: Array<MaybePromise<SelectorBranch | null>> = [];
  for (const c of list.selectors) {
    branches.push(selectorBranchHasInterp(c) ? resolvedSelectorBranch(c, frame, e) : c);
  }
  return combineAll(branches, (values) => {
    const out: SelectorBranch[] = [];
    for (const value of values) {
      if (value === null) {
        return null;
      }
      out.push(value);
    }
    return selist(...out);
  });
}

function resolvedSelectorBranch(c: SelectorBranch, frame: Frame | null, e: EvalCtx): MaybePromise<SelectorBranch | null> {
  const terms = selectorBranchTerms(c);
  const combinators = selectorBranchCombinators(c);
  if (c.type !== 'RelativeSelector' && terms.length === 1) {
    const tokens = termTokens(terms[0]!);
    const parts = tokens.length === 1 ? tokens[0]!.interp?.parts : undefined;
    if (parts?.length === 1 && 'ref' in parts[0]!) {
      return null;
    }
  }
  return combineAll(terms.map(term => resolvedSelectorTerm(term, frame, e)), (resolved) => {
    const segments: Array<{ combinator?: Combinator; term: SelectorTerm }> = [];
    for (let i = 0; i < resolved.length; i++) {
      const term = resolved[i];
      if (term === null || term === undefined) {
        return null;
      }
      segments.push(i === 0 ? { term } : { combinator: combinators[c.type === 'RelativeSelector' ? i : i - 1]!, term });
    }
    const [head, ...tail] = segments;
    return c.type === 'RelativeSelector'
      ? relativeSelector(combinators[0]!, [head!, ...tail])
      : selectorBranchOf([head!, ...tail]);
  });
}

function resolvedSelectorTerm(term: SelectorTerm, frame: Frame | null, e: EvalCtx): MaybePromise<SelectorTerm | null> {
  if (!selectorTermHasInterp(term)) {
    return term;
  }
  const tokens = termTokens(term);
  const texts: Array<MaybePromise<string | undefined>> = [];
  for (const sim of tokens) {
    texts.push(simpleTokenHasInterp(sim) ? resolveSimpleText(sim, frame, e) : undefined);
  }
  return combineAll(texts, (resolved) => {
    for (let i = 0; i < tokens.length; i++) {
      const text = resolved[i];
      const sim = tokens[i]!;
      if (text !== undefined && textHoldsParentRef(text) && !(sim.type === 'PseudoSelector'
        ? pseudoHasAmpersand(sim)
        : sim.interp?.parts.some(part => 'lit' in part && part.lit.includes('&')) === true)) {
        return null;
      }
    }
    const out = resolvedCompoundTokens(tokens, resolved);
    return selectorTermOf([out[0]!, ...out.slice(1)]);
  });
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

    /* A glued name merged into one token is no longer a compound. */
    return term.value.length === 1 ? term.value[0]! : term;
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

/**
 * [extend/dynamic] Whether a document carries STATIC and/or DYNAMIC `:extend()`.
 * `static` — an extend on the ordinary Ruleset/AtRuleBlock spine (the pre-walk
 * `computeExtends`/interp-prepass surface). `dynamic` — an extend reached only through
 * a body the walk places (see {@link placingBody}; recorded by the ONE render walk,
 * ledger X12). A document can have both. `places` — such a body places a rule, a mixin
 * call places its callee's rules (a ruleset called as a mixin included), or an
 * `@import` sits inside a ruleset or such a body (the import planner never reaches
 * that sheet): once the graph has any extend, the walk must record what they place.
 */
interface ExtendClass {
  static: boolean;
  dynamic: boolean;
  places: boolean;

  /**
   * The statically addressed `@import`s the walk places (inside a ruleset or a placing
   * body). The import planner never plans those sheets, so when nothing else in the
   * graph extends it loads them only to learn whether they carry an extend, which the
   * walk recorder must then be armed for.
   */
  placedImports: StyleImport[] | null;

  /**
   * The walk places an `@import` whose path is interpolated. Its sheet is known only
   * where the walk resolves the path, so the walk recorder is armed for it outright.
   */
  placesUnaddressedImport: boolean;
}

/**
 * The body-form `&:extend()`s a statement carries for the render walk to apply wherever
 * its body lands (see {@link recordBodyExtends}): a mixin definition's (ledger X16), an
 * at-rule block's or an `each()` callback's (X19). A detached ruleset's are its own
 * ({@link heldAnonymousMixin}). Undefined for every other statement.
 */
function walkAppliedExtends(st: Statement): readonly ExtendInstruction[] | undefined {
  switch (st.type) {
    case 'MixinDefinition':
    case 'AtRuleBlock':
    case 'For':
      return st.extendInstructions;
    default:
      return undefined;
  }
}

/**
 * The `index`-th detached ruleset a statement holds as a value — a variable's
 * (`@r: { … }`), a mixin call's argument or content block, a mixin definition's
 * parameter default. The render walk places its rules, and applies its body-form
 * `&:extend()`s (ledger X19), wherever it is called, so each classifier reads it as a
 * placing body. Null past the last one; indexed, so the classifiers allocate nothing.
 */
function heldAnonymousMixin(st: Statement, index: number): AnonymousMixin | null {
  let seen = 0;
  const nth = (value: ValueSlot | CallValue | null | undefined): AnonymousMixin | null =>
    value !== null && value !== undefined && !isValueSlotArray(value) && value.type === 'AnonymousMixin' && seen++ === index ? value : null;
  switch (st.type) {
    case 'VariableDeclaration':
      return nth(st.value);
    case 'MixinCall':
      for (const arg of st.args) {
        const held = nth(arg.value);
        if (held !== null) {
          return held;
        }
      }
      return nth(st.content);
    case 'MixinDefinition':
      for (const param of st.params) {
        const held = nth(param.default);
        if (held !== null) {
          return held;
        }
      }
      return null;
    default:
      return null;
  }
}

/**
 * Body `index` of a statement that places rules only when the render walk runs it: a
 * `$for`/`each()` loop, a mixin definition, a `$if`/`$while` control block (one body
 * per `$if` branch). A detached ruleset is {@link heldAnonymousMixin}. Null past the
 * last body, and for every other statement. Their rules are never static extend subjects; the walk
 * records them where they land. Indexed, so the per-render classifiers allocate nothing.
 */
function placingBody(st: Statement, index: number): readonly Statement[] | null {
  switch (st.type) {
    case 'For':
    case 'MixinDefinition':
    case 'While':
      return index === 0 ? st.rules : null;
    case 'If':
      return st.branches[index]?.rules ?? null;
    default:
      return null;
  }
}

/**
 * [extend/dynamic] ONE spine traversal that classifies a document's extend surface,
 * fusing what used to be two separate whole-document walks (`documentHasExtend` +
 * `documentHasDynamicExtend`). Once inside a placing body (`inDynamic`) every extend
 * is dynamic. A `{ static:false, dynamic:false }` result is the no-extend document: the
 * caller then takes exactly the original zero-cost path. Pure shape analysis — no
 * evaluation. Short-circuits once both bits are set (the walk is then armed anyway).
 */
function classifyExtend(statements: readonly Statement[], inDynamic: boolean, out: ExtendClass, placed = inDynamic): void {
  for (const st of statements) {
    if (out.static && out.dynamic) {
      return;
    }
    for (let index = 0, held = heldAnonymousMixin(st, 0); held !== null; held = heldAnonymousMixin(st, ++index)) {
      if (held.extendInstructions !== undefined) {
        out.dynamic = true;
      }
      classifyExtend(held.rules, true, out);
    }
    if (st.type === 'Ruleset') {
      if (inDynamic) {
        out.places = true;
      }
      if (st.extendInstructions?.length) {
        if (inDynamic) {
          out.dynamic = true;
        } else {
          out.static = true;
        }
      }
      classifyExtend(st.rules, inDynamic, out, true);
    } else if (st.type === 'AtRuleBlock') {
      if (st.extendInstructions !== undefined) {
        out.dynamic = true;
      }
      classifyExtend(st.rules, inDynamic, out, placed);
    } else if (st.type === 'StyleImport') {
      if (placed) {
        out.places = true;
        if (isStaticQuoted(st.target) || (st.target.type === 'Url' && isStaticQuoted(st.target.value))) {
          (out.placedImports ??= []).push(st);
        } else {
          out.placesUnaddressedImport = true;
        }
      }
    } else if (st.type === 'MixinCall' || st.type === 'Apply') {
      out.places = true;
    } else {
      /* A definition's own body-form extend applies wherever it is called (ledger X16). */
      if (walkAppliedExtends(st) !== undefined) {
        out.dynamic = true;
      }
      for (let index = 0, body = placingBody(st, 0); body !== null; body = placingBody(st, ++index)) {
        classifyExtend(body, true, out);
      }
    }
  }
}

/**
 * [extend/dynamic] ONE armed-only walk over the document: the static-spine Ruleset
 * nodes (`staticRules` — every rule reachable through ruleset / at-rule nesting, NOT
 * through a placing body; a rule outside it was reached dynamically and records its
 * facts at emit), and the target atoms of the extends in placing bodies.
 * Runs only when dynamic recording is armed, so non-extend documents pay nothing.
 *
 * F5 note: the planner's subject-rule set is NOT reused here — the pre-walk
 * `computeExtends` returns null (building no plan) for the common dynamic-only document
 * (extend only inside a loop/mixin, e.g. the bootstrap grid), exactly when `staticRules`
 * is most needed.
 */
function collectDynamicExtendSets(
  statements: readonly Statement[],
  inDynamic: boolean,
  staticRules: Set<Ruleset>,
  targetAtoms: Set<string>
): void {
  for (const st of statements) {
    for (let index = 0, held = heldAnonymousMixin(st, 0); held !== null; held = heldAnonymousMixin(st, ++index)) {
      if (held.extendInstructions !== undefined) {
        collectInstructionAtoms(held.extendInstructions, targetAtoms);
      }
      collectDynamicExtendSets(held.rules, true, staticRules, targetAtoms);
    }
    if (st.type === 'Ruleset') {
      if (!inDynamic) {
        staticRules.add(st);
      } else if (st.extendInstructions?.length) {
        collectInstructionAtoms(st.extendInstructions, targetAtoms);
      }
      collectDynamicExtendSets(st.rules, inDynamic, staticRules, targetAtoms);
    } else if (st.type === 'AtRuleBlock') {
      if (st.extendInstructions !== undefined) {
        collectInstructionAtoms(st.extendInstructions, targetAtoms);
      }
      collectDynamicExtendSets(st.rules, inDynamic, staticRules, targetAtoms);
    } else {
      const extend = walkAppliedExtends(st);
      if (extend !== undefined) {
        collectInstructionAtoms(extend, targetAtoms);
      }
      for (let index = 0, body = placingBody(st, 0); body !== null; body = placingBody(st, ++index)) {
        collectDynamicExtendSets(body, true, staticRules, targetAtoms);
      }
    }
  }
}

/** Add the selector atoms of every `:extend()` target in `instructions` to `atoms`. */
function collectInstructionAtoms(instructions: readonly ExtendInstruction[], atoms: Set<string>): void {
  for (const inst of instructions) {
    for (const sel of inst.target.selectors) {
      collectBranchAtoms(branchFromSelector(sel), atoms);
    }
  }
}

/**
 * Collect the target atoms of every `:extend()` in an imported placing body; true
 * when the body places a rule. Those extends run only when the walk reaches them, so
 * their targets are what a hidden `(reference)` rule must stay renderable for (#355).
 */
function collectBodyExtendAtoms(statements: readonly Statement[], atoms: Set<string>): boolean {
  let places = false;
  for (const st of statements) {
    for (let index = 0, held = heldAnonymousMixin(st, 0); held !== null; held = heldAnonymousMixin(st, ++index)) {
      if (held.extendInstructions !== undefined) {
        collectInstructionAtoms(held.extendInstructions, atoms);
        places = true;
      }
      places = collectBodyExtendAtoms(held.rules, atoms) || places;
    }
    if (st.type === 'Ruleset') {
      places = true;
      if (st.extendInstructions?.length) {
        collectInstructionAtoms(st.extendInstructions, atoms);
      }
      collectBodyExtendAtoms(st.rules, atoms);
    } else if (st.type === 'AtRuleBlock') {
      if (st.extendInstructions !== undefined) {
        collectInstructionAtoms(st.extendInstructions, atoms);
        places = true;
      }
      places = collectBodyExtendAtoms(st.rules, atoms) || places;
    } else if (st.type === 'StyleImport' || st.type === 'MixinCall' || st.type === 'Apply') {
      places = true;
    } else {
      /* A definition's body-form extend is applied, by the walk, wherever it is called. */
      const extend = walkAppliedExtends(st);
      if (extend !== undefined) {
        collectInstructionAtoms(extend, atoms);
        places = true;
      }
      for (let index = 0, body = placingBody(st, 0); body !== null; body = placingBody(st, ++index)) {
        places = collectBodyExtendAtoms(body, atoms) || places;
      }
    }
  }
  return places;
}

/** The import preflight's mutable {@link PlanOverlay}. */
interface ImportPlanOverlay {
  subjects: PlanSubject[];
  instructions: PlanInstruction[];
  atRuleScopes: AtRuleScopes;

  /** The ONE boundary of each composed module, by module identity (ledger X14). */
  moduleBoundaries: Map<string, ExtendBoundary>;

  /** The render placement of each `(reference)` or `(multiple)` import. */
  importPlacements: ImportPlacements | null;

  /** Target atoms of the extends in imported placing bodies. */
  dynamicTargetAtoms: Set<string> | null;

  /** Hidden `(reference)` rules whose body holds an `@import` the walk places. */
  importingRules: Set<Ruleset> | null;
}

/**
 * The render placement the import planner gave each `(reference)` or `(multiple)` import
 * — its token, and for a `(reference)` sheet its extend boundary — keyed by the placement
 * the import statement is reached in, then by the statement. A statement inside a sheet
 * imported `(multiple)` twice is reached once per copy, and each copy is its own
 * placement (#359). The render walk reads it with the placement it is emitting.
 */
type ImportPlacements = Map<object | undefined, Map<StyleImport, ImportPlacement>>;

interface ImportPlacement {
  token: object;
  boundary: ExtendBoundary | null;
}

/**
 * The ONE extend boundary of the module identity `key`, recording `composer` as a
 * sheet it is loaded from: a module composed by two sheets is reached by the extends
 * of both, whichever loaded it first (ledger X14). A module with no identity gets a
 * boundary per composition.
 */
function composedModuleBoundary(
  boundaries: Map<string, ExtendBoundary>,
  key: string | undefined,
  composer: ExtendBoundary | null
): ExtendBoundary {
  let boundary = key === undefined ? undefined : boundaries.get(key);
  if (boundary === undefined) {
    boundary = { parents: [composer] };
    if (key !== undefined) {
      boundaries.set(key, boundary);
    }
  } else if (!boundary.parents.includes(composer)) {
    boundary.parents.push(composer);
  }
  return boundary;
}

/**
 * [extend/dynamic] Pre-walk STATIC extend preflight for a loaded imported document.
 * It records the imported document's STATICALLY-placed subjects and `:extend()`
 * instructions into the shared overlay using selector SHAPES only (`levelFromSelectorList`
 * / `branchFromSelector`) — never re-driving evaluation. Placing bodies (see
 * {@link placingBody}) are left to the walk-time dynamic recorder (a placement the
 * static preflight cannot resolve); one that places a rule flags
 * `e.importedWalkPlacement` so that recorder runs. This is the imported-document
 * analogue of `collectPlan`, not a second evaluation pass. `placement` is the import
 * placement the facts belong to (undefined for the static placement).
 */
function planImportedStaticExtend(
  statements: readonly Statement[],
  e: Emit,
  overlay: ImportPlanOverlay,
  path: Level[],
  scope: number[],
  parent: PlanSubject | null,
  hidden: boolean,
  boundary: ExtendBoundary | null,
  referenceAtRule: PlanReferenceAtRule | null,
  placement: object | undefined
): void {
  for (const statement of statements) {
    /*
     * The graph has an extend (this planner runs only then), so a body-form extend the
     * walk applies where its body lands — a definition's, an at-rule block's, a detached
     * ruleset's (ledgers X16, X19) — arms the walk recorder, and its targets are targets.
     */
    const applied = walkAppliedExtends(statement);
    if (applied !== undefined) {
      collectInstructionAtoms(applied, overlay.dynamicTargetAtoms ??= new Set());
      e.importedWalkPlacement = true;
    }
    for (let index = 0, held = heldAnonymousMixin(statement, 0); held !== null; held = heldAnonymousMixin(statement, ++index)) {
      if (held.extendInstructions !== undefined) {
        collectInstructionAtoms(held.extendInstructions, overlay.dynamicTargetAtoms ??= new Set());
        e.importedWalkPlacement = true;
      }
      if (collectBodyExtendAtoms(held.rules, overlay.dynamicTargetAtoms ??= new Set())) {
        e.importedWalkPlacement = true;
      }
    }
    if (statement.type === 'Ruleset' && statement.selector.selectors.some(selectorBranchHasInterp)) {
      /*
       * A selector the planner could not resolve (see `planImported`) resolves only in
       * the frame the walk emits it in, so the rule and every rule nested in it are left
       * to the walk recorder, which reads the walk's one resolution of it (ledger X7 as
       * amended 2026-10-05).
       */
      e.importedWalkPlacement = true;
      collectBodyExtendAtoms([statement], overlay.dynamicTargetAtoms ??= new Set());
    } else if (statement.type === 'Ruleset') {
      const own = levelFromSelectorList(statement.selector);
      const rulePath = [...path, own];
      const subject: PlanSubject = {
        rule: statement, path: rulePath, scope, ownLocal: own, parent,
        mayMatch: false, hidden, boundary, referenceAtRule, placement
      };
      overlay.subjects.push(subject);
      (e.importedStaticExtendRules ??= new Set()).add(statement);
      if (statement.extendInstructions) {
        for (const inst of statement.extendInstructions) {
          const extenderPath = inst.subject
            ? [...path, levelFromSelectorList(inst.subject)]
            : rulePath;
          for (const sel of inst.target.selectors) {
            overlay.instructions.push({
              target: branchFromSelector(sel), partial: inst.partial, extenderPath, scope,
              order: overlay.instructions.length, extenderHidden: hidden,
              boundary
            });
          }
        }
      }
      planImportedStaticExtend(statement.rules, e, overlay, rulePath, scope, subject, hidden, boundary, referenceAtRule, placement);
    } else if (statement.type === 'AtRuleBlock') {
      const owner = hidden
        ? { node: statement, parent: referenceAtRule, placement }
        : referenceAtRule;
      planImportedStaticExtend(statement.rules, e, overlay, path, atRuleScope(scope, statement, overlay.atRuleScopes), parent, hidden, boundary, owner, placement);
    } else if (statement.type === 'StyleImport') {
      /*
       * An import inside a ruleset lands where the walk places it (see ExtendClass).
       * A hidden ruleset must then still run its body, or the walk never reaches it.
       */
      if (parent !== null) {
        e.importedWalkPlacement = true;
        if (hidden) {
          (overlay.importingRules ??= new Set()).add(parent.rule);
        }
      }
    } else if (statement.type === 'MixinCall' || statement.type === 'Apply') {
      /* A call or `$apply` places its callee's rules where it lands (see ExtendClass). */
      e.importedWalkPlacement = true;
    } else {
      /* A placing body that places a rule arms the walk recorder: that rule is a target. */
      for (let index = 0, body = placingBody(statement, 0); body !== null; body = placingBody(statement, ++index)) {
        if (collectBodyExtendAtoms(body, overlay.dynamicTargetAtoms ??= new Set())) {
          e.importedWalkPlacement = true;
        }
      }
    }
  }
}

const NO_AT_RULES: readonly AtRuleBlock[] = [];

/**
 * Whether the rules the import planner plans — the Ruleset and at-rule spine of a
 * sheet — hold an interpolated rule selector. A boolean walk over the memoized
 * per-branch flag; it allocates nothing.
 */
function bodyHasInterpRule(statements: readonly Statement[]): boolean {
  for (const statement of statements) {
    if (statement.type === 'Ruleset') {
      if (statement.selector.selectors.some(selectorBranchHasInterp) || bodyHasInterpRule(statement.rules)) {
        return true;
      }
    } else if (statement.type === 'AtRuleBlock' && bodyHasInterpRule(statement.rules)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the import planner's walk reaches an `@import`/`@use`: at document level or
 * inside an at-rule block (where `@import "x" screen;` lands), the same statements
 * {@link planImportedFacts}'s `visit` descends into.
 */
function bodyHasPlannedImport(statements: readonly Statement[]): boolean {
  for (const statement of statements) {
    if (statement.type === 'StyleImport' || statement.type === 'ModuleImport') {
      return true;
    }
    if (statement.type === 'AtRuleBlock' && bodyHasPlannedImport(statement.rules)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether an imported document carries an `:extend()` anywhere — statically placed or
 * in a placing body. The import-side answer to the root's {@link classifyExtend}
 * (`static || dynamic`): the same statements, a boolean only, and stack-safe.
 */
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
    for (let index = 0, held = heldAnonymousMixin(statement, 0); held !== null; held = heldAnonymousMixin(statement, ++index)) {
      if (held.extendInstructions !== undefined) {
        recordAstExtendProfile?.('astExtend.preflight.bodyFeatureBearing');
        return true;
      }
      for (const child of held.rules) {
        pending.push(child);
      }
    }
    if (statement.type === 'Ruleset') {
      if (statement.extendInstructions?.length) {
        recordAstExtendProfile?.('astExtend.preflight.bodyFeatureBearing');
        return true;
      }
      for (const child of statement.rules) {
        pending.push(child);
      }
    } else if (statement.type === 'AtRuleBlock') {
      if (statement.extendInstructions !== undefined) {
        recordAstExtendProfile?.('astExtend.preflight.bodyFeatureBearing');
        return true;
      }
      for (const child of statement.rules) {
        pending.push(child);
      }
    } else {
      /*
       * Placing bodies (loops, mixin definitions, control blocks, detached rulesets)
       * must admit imported extend planning before they execute — an imported mixin
       * whose body carries `&:extend()` (e.g. Bootstrap's `#make-grid-columns()` grid
       * columns), or whose definition carries one of its own (ledger X16), arms the
       * walk-time dynamic recorder the same way a loop does. So does an at-rule block's
       * own (X19); a detached ruleset's is read above, wherever it is held.
       */
      if (walkAppliedExtends(statement) !== undefined) {
        recordAstExtendProfile?.('astExtend.preflight.bodyFeatureBearing');
        return true;
      }
      for (let index = 0, body = placingBody(statement, 0); body !== null; body = placingBody(statement, ++index)) {
        for (const child of body) {
          pending.push(child);
        }
      }
    }
  }
  recordAstExtendProfile?.('astExtend.preflight.bodyNoFeatureMisses');
  return false;
}

/**
 * Build the one pre-render view of the typed import graph. It loads through the
 * existing Context capability, keeps import-once identity locally, activates
 * variables in source order, contributes canonical Ruleset identities to extend
 * planning, and optionally carries document-root CSS terminals to the output
 * prelude. Less document execution remains on the later lexical render walk;
 * this is never a reparse, tree bridge, or second import traversal.
 */
type ImportPlannerInput = {
  root: Stylesheet;
  overlay: PlanOverlay;

  /** The planner's own overlay (`overlay` itself), null when it planned nothing. */
  imports: ImportPlanOverlay | null;

  /** The root document's extend surface, classified once for the planner and the render. */
  extendClass: ExtendClass;

  /**
   * `undefined` means this planner invocation did not own CSS-import placement;
   * `null` means it did and found no terminal. A non-null chain is already in
   * final document order and carries the source scope needed by URL transforms.
   */
  cssImports: CssImportPlan | null | undefined;
};

interface CssImportPlan {
  head: number;
  tail: number;
  nodes: Array<AtRuleStatement | null> | null;
  targets: Array<Quoted | Url | null> | null;
  frames: Array<Frame | null> | null;
  withinDocuments: Array<NonNullable<ImportDocumentTree['withinDocument']> | null> | null;
  next: number[] | null;
}

const IMPORT_PLAN_PREPARE = 0;
const IMPORT_PLAN_RENDER_EXPLICIT = 1;
const IMPORT_PLAN_RENDER_CONTEXT = 2;
type ImportPlanMode = typeof IMPORT_PLAN_PREPARE
  | typeof IMPORT_PLAN_RENDER_EXPLICIT
  | typeof IMPORT_PLAN_RENDER_CONTEXT;

function appendCssImportPlan(
  plan: CssImportPlan,
  node: AtRuleStatement | null,
  target: Quoted | Url | null,
  frame: Frame | null,
  withinDocument: NonNullable<ImportDocumentTree['withinDocument']> | null
): number {
  const nodes = plan.nodes ??= [];
  const targets = plan.targets ??= [];
  const frames = plan.frames ??= [];
  const withinDocuments = plan.withinDocuments ??= [];
  const next = plan.next ??= [];
  const index = nodes.length;
  nodes.push(node);
  targets.push(target);
  frames.push(frame);
  withinDocuments.push(withinDocument);
  next.push(-1);
  if (plan.tail === -1) {
    plan.head = index;
  } else {
    next[plan.tail] = index;
  }
  plan.tail = index;
  return index;
}

function planImportedFacts(
  root: Stylesheet,
  frame: Frame,
  e: Emit,
  importDocument: SerializeOptions['importDocument'] | undefined,
  mode: ImportPlanMode,
  prepublishFrame: Frame | null = null
): MaybePromise<ImportPlannerInput> {
  recordAstExtendProfile?.('astExtend.preflight.calls');
  const deferUnreadyImports = mode === IMPORT_PLAN_PREPARE;
  const collectCssImports = mode === IMPORT_PLAN_RENDER_CONTEXT;

  /*
   * A Context-owned import route is already MaybePromise at the document boundary,
   * so it may discover an imported-only extend. Direct AST consumers preserve the
   * historical synchronous no-extend import path.
   * A Context alone must not promote a document with neither imports nor
   * extends into the async planner path. The Context remains available to
   * synchronous callable-body ownership, while actual import/extend facts opt
   * into planning.
   */
  const extendClass: ExtendClass = { static: false, dynamic: false, places: false, placedImports: null, placesUnaddressedImport: false };
  classifyExtend(root.rules, false, extendClass);

  /*
   * A sheet the walk places through an interpolated path may carry the graph's only
   * extend, and no pre-walk load can address it: the walk records what it places.
   */
  if (extendClass.placesUnaddressedImport && mode !== IMPORT_PLAN_PREPARE) {
    e.importedWalkPlacement = true;
  }
  const plansImports = e.context?.options.processImports !== false && importDocument !== undefined;
  const probesPlacedImports = mode !== IMPORT_PLAN_PREPARE && extendClass.placedImports !== null && !extendClass.dynamic;
  if (!plansImports || (!extendClass.static && !probesPlacedImports && !bodyHasPlannedImport(root.rules))) {
    recordAstExtendProfile?.('astExtend.preflight.noFeatureBypasses');
    return {
      root,
      overlay: {
        subjects: [],
        instructions: [],
        atRuleScopes: null
      },
      imports: null,
      extendClass,
      cssImports: undefined
    };
  }

  /* Each document loaded once, by identity: true when an `@import` loaded it. */
  const seen = new Map<string, boolean>();

  /* Every document an `@import` of any kind placed, for {@link isReferenceReimport}. */
  const placed = new Set<string>();

  /*
   * The sheets an `@import` nested in a ruleset places, and everything they import, are
   * loaded only where the walk renders that ruleset, but they count toward import-once
   * here in document order too (ledgers J14, X18): a later `@import` of a sheet one of
   * them placed is dropped here as the walk drops it, so it publishes no facts the walk
   * never renders. A guarded ruleset may never render, and a path the walk interpolates
   * is known only there, so neither counts.
   *
   * ponytail: a guard that holds still leaves a later import of the same sheet dropped
   * by the walk with its facts published here; evaluating the guard here would close it.
   */
  const countRulesetImports = async (rules: readonly Statement[], multiple: boolean, hidden: boolean): Promise<void> => {
    for (const st of rules) {
      if (st.type === 'Ruleset' || st.type === 'AtRuleBlock') {
        if (st.type === 'AtRuleBlock' || st.guard === undefined) {
          await countRulesetImports(st.rules, multiple, hidden);
        }
        continue;
      }
      if (st.type !== 'StyleImport' || st.mode === 'compose') {
        continue;
      }
      const target = st.target.type === 'Url' ? st.target.value : st.target;
      const options = importRequestOptions(st.options);
      if (!isStaticQuoted(target) || importHasOption(options, 'inline')) {
        continue;
      }
      const prepared = e.plannedImportDocuments?.get(st);
      const request: ImportDocumentRequest = prepared?.request ?? { node: st, specifier: target.value, options };
      const loaded = prepared === undefined ? await importDocument(request) : prepared.loaded;
      if (prepared === undefined) {
        e.plannedImportDocuments?.set(st, { request, loaded });
      }
      if (loaded === undefined || 'inline' in loaded || loaded.document === null || loaded.key === undefined) {
        continue;
      }
      if (options === null && !multiple) {
        if (seen.has(loaded.key)) {
          continue;
        }
        seen.set(loaded.key, true);
      } else if (isReferenceReimport(st, options, multiple, placed.has(loaded.key))) {
        continue;
      } else if (isVisibleMultiple(st, options, hidden)) {
        seen.set(loaded.key, true);
      }
      placed.add(loaded.key);
      const sheet = loaded.document.rules;
      const count = (): Promise<void> => countRulesetImports(
        sheet,
        multiple || importHasOption(options, 'multiple'),
        hidden || importHasOption(options, 'reference')
      );
      await (loaded.withinDocument ? loaded.withinDocument(count) : count());
    }
  };
  const overlay: ImportPlanOverlay = {
    subjects: [],
    instructions: [],
    atRuleScopes: new Map(),
    moduleBoundaries: new Map(),
    importPlacements: null,
    dynamicTargetAtoms: null,
    importingRules: null
  };

  /*
   * Extend matching is graph-wide (EXTEND-SEMANTICS §6): once ANY document in the
   * import graph carries an `:extend()` — statically placed or in a loop/mixin body —
   * every imported document's statically-placed rules are potential targets. The root
   * seeds the flag; an imported document visited before the first extend-bearing one
   * waits in `pendingPlans` and is planned, in visit order, when that extend appears.
   * A graph with no extend plans nothing. The prepare pass only loads documents and
   * discards its overlay, so it plans nothing either.
   */
  const plansExtend = !deferUnreadyImports;
  let graphHasExtend = extendClass.static || extendClass.dynamic;
  let pendingPlans: Array<() => void> | null = null;
  const planImported = (
    rules: Statement[],
    reference: boolean,
    atRules: readonly AtRuleBlock[],
    boundary: ExtendBoundary | null,
    placement: object | undefined,
    importer: Frame
  ): void => {
    recordAstExtendProfile?.('astExtend.preflight.importsFeatureBearing');
    let scope = EMPTY_SCOPE;
    for (const atRule of atRules) {
      scope = atRuleScope(scope, atRule, overlay.atRuleScopes);
    }

    /*
     * An interpolated rule selector is resolved before it is planned, as the root's are
     * (ledger X7 as amended): in the sheet's own frame under its importer's, which is
     * where the walk resolves it, and in place, so the walk writes that same
     * resolution and nothing is resolved twice (ledger X12).
     */
    if (bodyHasInterpRule(rules)) {
      resolveSelectorInterpForExtend(rules, {
        parent: importer,
        mixins: collectMixins(rules),
        declIndex: collectDeclIndex(rules), cells: null, reassign: null,
        statements: rules
      }, e);
    }
    planImportedStaticExtend(rules, e, overlay, [], scope, null, reference, boundary, null, placement);
  };
  const cssImports: CssImportPlan | null = collectCssImports
    ? {
        head: -1,
        tail: -1,
        nodes: null,
        targets: null,
        frames: null,
        withinDocuments: null,
        next: null
      }
    : null;
  const visit = async (
    statements: readonly Statement[],
    scope: Frame,
    cssPlan: CssImportPlan | null,
    withinDocument: NonNullable<ImportDocumentTree['withinDocument']> | null,
    multipleImportDepth: boolean,

    /*
     * The at-rule blocks enclosing `statements`, outermost first, across import
     * boundaries — an imported document inherits its import site's. They give the
     * document's rules their extend scope (EXTEND-SEMANTICS §8).
     */
    atRules: readonly AtRuleBlock[],
    publishFrame: Frame | null,

    /*
     * [import-fold] Source-fold position, RELATIVE TO `publishFrame`, of the
     * root-level `@import` this walk descends from. `null` at the document being
     * served, where `statements` IS `publishFrame`'s body and the loop index below
     * is the site.
     */
    publishRank: SourceRank | null = null,

    /*
     * [import-fold] Position of `statements` within `scope`'s own body — `[]` when
     * `statements` IS that body (a document root), `null` when it is not addressable
     * there (an at-rule block walked with the enclosing scope). An import's site is
     * this prefix plus its loop index, so no import ever scans the body for itself.
     */
    rank: SourceRank | null = null,

    /*
     * The extend boundary of the sheet being walked: null in the root document's
     * graph, else the innermost `@compose`d module or `(reference)` sheet it was
     * loaded from (ledger X14).
     */
    boundary: ExtendBoundary | null = null,

    /*
     * Whether the sheet being walked is inside a `(reference)` import, and the render
     * placement its rules land in (undefined for the static placement). A sheet a
     * `(reference)` sheet imports is hidden too, and shares its placement.
     */
    hidden = false,
    placement: object | undefined = undefined
  ): Promise<void> => {
    const deferred: StyleImport[] = [];
    const deferredSites: number[] = [];
    let deferredAnchors: number[] | null = null;
    let firstCssImportKey: string | null = null;
    let furtherCssImportKeys: Set<string> | null = null;
    const visitImport = async (st: StyleImport, importCssPlan: CssImportPlan | null, at: number): Promise<void> => {
      recordAstExtendProfile?.('astExtend.preflight.importsVisited');
      const options = importRequestOptions(st.options);
      const specifier = importSpecifier(st, scope, e);
      if (importHasOption(options, 'inline')) {
        return;
      }
      recordAstExtendProfile?.('astExtend.preflight.importsLoadable');
      const request: ImportDocumentRequest = { node: st, specifier, options };
      const reference = importHasOption(options, 'reference');
      const prepared = e.plannedImportDocuments?.get(st);
      const loaded = prepared === undefined ? await importDocument(request) : prepared.loaded;
      if (prepared === undefined) {
        e.plannedImportDocuments?.set(st, { request, loaded });
      }
      if (loaded === undefined || 'inline' in loaded || loaded.document === null) {
        return;
      }
      recordAstExtendProfile?.('astExtend.preflight.importsLoaded');

      /*
       * A compose that is a direct member of a publication frame's body — the
       * document's, or a module's activated here — activates now and binds its
       * namespace there (ruling J6c); its own body is then walked as that
       * activation's, so the facts of the `@import`s directly in it are
       * published early into the activation as N10 publishes the document's.
       */
      const activation = st.mode === 'compose' && publishFrame !== null && publishRank === null && rank !== null
        ? activateComposeEdge(st, loaded.key, loaded.document.rules, specifier, publishFrame, e, [...rank, at], true)
        : undefined;
      if (activation !== undefined) {
        (e.composeActivations ??= new Map()).set(st, activation);
      }

      /*
       * `@compose` is isolated and non-transitive: its facts are NOT spliced into
       * the importer (the render path's `publishComposedModule` owns the namespace
       * binding / `as *` merge), and its body walks in an isolated frame so nested
       * `@compose`/`@import` never leak up. `@import` keeps splicing its direct
       * facts into the importing frame before its body is walked.
       */
      const isCompose = st.mode === 'compose';
      if (options === null && !multipleImportDepth && loaded.key !== undefined) {
        if (seen.has(loaded.key)) {
          /* A module composed again is still loaded from this sheet too (ledger X14). */
          if (isCompose && plansExtend) {
            composedModuleBoundary(overlay.moduleBoundaries, loaded.key, boundary);
          }
          return;
        }
        seen.set(loaded.key, !isCompose);
      } else if (isReferenceReimport(st, options, multipleImportDepth, loaded.key !== undefined && placed.has(loaded.key))) {
        return;
      } else if (loaded.key !== undefined && isVisibleMultiple(st, options, hidden)) {
        seen.set(loaded.key, true);
      }
      if (!isCompose && loaded.key !== undefined) {
        placed.add(loaded.key);
      }
      rememberImportedCallableBodies(loaded.document, loaded.document.rules, e.context);

      /*
       * [import-fold] Where this `@import` sits in each frame it publishes into —
       * from the loop index (`at`), never a scan. `scope` owns the document being
       * walked, so `rank` + `at` is the site. `publishFrame` is the ROOT render
       * frame throughout the walk and its body is `statements` only at the document
       * root (`publishRank === null`, where the site is the same); a nested import
       * instead EXTENDS the site of the root-level import that reached it, rather
       * than pretending to be one of the root's own statements.
       */
      const site = rank === null ? null : [...rank, at];
      const publishSite = publishRank === null
        ? site
        : site === null ? publishRank : [...publishRank, ...site];
      if (!isCompose) {
        const published = publishImportedDocumentFacts(loaded.document.rules, scope, e, false, site);
        if (isThenable(published)) {
          await published;
        }

        /*
         * The document's facts are claimed render-wide, so a document reached
         * twice publishes once. A module activation is its own frame: it claims
         * the import, and publishes every fact of it, for that frame alone.
         */
        const intoDocument = publishFrame === prepublishFrame;
        if (publishFrame !== null
          && (intoDocument ? claimPrepublishedImportFact(e, st) : claimModulePrepublishedImport(e, publishFrame, st))) {
          const prepublished = publishImportedDocumentFacts(loaded.document.rules, publishFrame, e, intoDocument, publishSite);
          if (isThenable(prepublished)) {
            await prepublished;
          }
        }
      }
      const childFrame: Frame = { parent: isCompose ? null : scope, mixins: collectMixins(loaded.document.rules), declIndex: collectDeclIndex(loaded.document.rules), cells: null, reassign: null, statements: loaded.document.rules };

      /*
       * A composed module's extends reach only the module and what it loads; a
       * `(reference)` sheet's stay inside that sheet. Plain imports share their
       * importer's boundary. A `(reference)` or `(multiple)` import is its own render
       * placement, so its copies of the sheet's rules project apart from every other
       * copy (#359); a plain import shares its importer's placement.
       */
      const sheetHidden = hidden || reference;
      let sheetBoundary = boundary;
      let sheetPlacement = placement;
      if (plansExtend) {
        if (isCompose) {
          sheetBoundary = composedModuleBoundary(overlay.moduleBoundaries, loaded.key, boundary);
        }
        if (reference) {
          sheetBoundary = { parents: [sheetBoundary] };
        }
        if (reference || importHasOption(options, 'multiple')) {
          sheetPlacement = {};
          const placements = overlay.importPlacements ??= new Map();
          let byStatement = placements.get(placement);
          if (byStatement === undefined) {
            byStatement = new Map();
            placements.set(placement, byStatement);
          }
          byStatement.set(st, { token: sheetPlacement, boundary: reference ? sheetBoundary : null });
        }
      }

      /*
       * The imported document's STATICALLY-placed Rulesets are recorded from selector
       * SHAPES (never re-evaluated). Its placing bodies are DYNAMIC placements the
       * static preflight cannot resolve — the ONE render walk records those (ledger X12).
       */
      if (plansExtend) {
        if (!graphHasExtend && bodyMayPlanExtend(loaded.document.rules)) {
          graphHasExtend = true;
          if (pendingPlans !== null) {
            for (const plan of pendingPlans) {
              plan();
            }
            pendingPlans = null;
          }
        }
        if (graphHasExtend) {
          planImported(loaded.document.rules, sheetHidden, atRules, sheetBoundary, sheetPlacement, scope);
        } else {
          const rules = loaded.document.rules;
          (pendingPlans ??= []).push(() => planImported(rules, sheetHidden, atRules, sheetBoundary, sheetPlacement, scope));
        }
      }
      const collect = async (): Promise<void> => {
        await visit(
          loaded.document!.rules,
          childFrame,
          reference ? null : importCssPlan,
          loaded.withinDocument ?? withinDocument,
          multipleImportDepth || importHasOption(options, 'multiple'),
          atRules,
          isCompose ? activation?.frame ?? null : publishFrame,
          isCompose ? null : publishSite,

          /* the imported document's own body: an import in it addresses by index */
          [],
          sheetBoundary,
          sheetHidden,
          sheetPlacement
        );
      };
      if (loaded.withinDocument) {
        await loaded.withinDocument(collect);
      } else {
        await collect();
      }
    };
    for (let at = 0; at < statements.length; at++) {
      const st = statements[at]!;
      if (st.type === 'VariableDeclaration') {
        activateVariableDeclaration(st, scope, e);
      } else if (st.type === 'AtRuleStatement' && cssPlan !== null) {
        const target = cssImportTarget(st);
        if (target !== null) {
          const key = cssImportKey(st, target);
          let duplicate = false;
          if (key !== null) {
            duplicate = key === firstCssImportKey || furtherCssImportKeys?.has(key) === true;
            if (firstCssImportKey === null) {
              firstCssImportKey = key;
            } else if (!duplicate) {
              (furtherCssImportKeys ??= new Set()).add(key);
            }
          }
          (e.hoistedCssImports ??= new Set()).add(st);
          if (!duplicate) {
            appendCssImportPlan(cssPlan, st, target, scope, withinDocument);
          }
        }
      } else if (st.type === 'StyleImport') {
        try {
          await visitImport(st, cssPlan, at);
        } catch (error) {
          if (!(error instanceof ImportPathNotReady)) {
            throw error;
          }
          deferred.push(st);
          deferredSites.push(at);
          if (cssPlan !== null) {
            const anchor = appendCssImportPlan(cssPlan, null, null, null, null);
            (deferredAnchors ??= []).push(anchor);
          }
        }
      } else if (st.type === 'Ruleset' && st.guard === undefined) {
        await countRulesetImports(st.rules, multipleImportDepth, hidden);
      } else if (st.type === 'ModuleImport' && e.context) {
        const { module } = await e.context.getModule(st.path.value).catch(moduleLoadFailed(st, e));
        e.plannedModuleImports?.set(st, module);
        bindModuleImport(st, module, scope, e);
      } else if (st.type === 'AtRuleBlock') {
        /*
         * [import-fold] `rank: null`. An at-rule body is walked with the ENCLOSING
         * scope, so a statement index here is not a position in that scope's body
         * — and ledger A10's `@import "lib" screen;` desugar lands exactly here.
         * Those facts keep publication order (see {@link importSiteRank}).
         */
        await visit(st.rules, scope, null, withinDocument, multipleImportDepth, plansExtend ? [...atRules, st] : atRules, null, null, null, boundary, hidden, placement);
      }
    }
    for (let index = 0; index < deferred.length; index++) {
      const pending = deferred[index]!;
      const anchor = deferredAnchors?.[index] ?? -1;
      const previousTail = cssImports?.tail ?? -1;
      try {
        await visitImport(pending, anchor === -1 ? null : cssImports, deferredSites[index]!);
        if (anchor !== -1 && cssImports !== null && cssImports.tail !== previousTail && previousTail !== anchor) {
          const next = cssImports!.next!;
          const after = next[anchor]!;
          const insertedHead = next[previousTail]!;
          const insertedTail = cssImports.tail;
          next[previousTail] = -1;
          next[anchor] = insertedHead;
          next[insertedTail] = after;
          cssImports.tail = previousTail;
        }
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

  /*
   * A sheet the walk places inside a ruleset is never planned, but an extend in it still
   * needs the walk recorder armed before the first target is written. When nothing else
   * in the graph extends, load each statically addressed one now (the walk reuses the
   * loaded document) and look for an extend.
   */
  const probePlacedImports = async (): Promise<void> => {
    for (const st of extendClass.placedImports ?? []) {
      if (graphHasExtend) {
        return;
      }
      const options = importRequestOptions(st.options);
      if (importHasOption(options, 'inline')) {
        continue;
      }
      const request: ImportDocumentRequest = { node: st, specifier: importSpecifier(st, frame, e), options };
      const prepared = e.plannedImportDocuments?.get(st);
      const loaded = prepared === undefined ? await importDocument(request) : prepared.loaded;
      if (prepared === undefined) {
        e.plannedImportDocuments?.set(st, { request, loaded });
      }
      if (loaded !== undefined && !('inline' in loaded) && loaded.document !== null && bodyMayPlanExtend(loaded.document.rules)) {
        graphHasExtend = true;
        e.importedWalkPlacement = true;
        for (const plan of pendingPlans ?? []) {
          plan();
        }
        pendingPlans = null;
      }
    }
  };
  return visit(root.rules, frame, cssImports, null, false, NO_AT_RULES, prepublishFrame, null, []).then(async () => {
    if (plansExtend && !graphHasExtend && probesPlacedImports) {
      await probePlacedImports();
    }
    let plannedCssImports: CssImportPlan | null | undefined;
    if (cssImports === null) {
      plannedCssImports = undefined;
    } else if (e.hoistedCssImports === null) {
      plannedCssImports = null;
    } else {
      plannedCssImports = cssImports;
    }
    return { root, overlay, imports: overlay, extendClass, cssImports: plannedCssImports };
  });
}

export type PrepareStaticImportsOptions = Pick<
  SerializeOptions,
  'context' | 'evaluator' | 'modes' | 'trivia' | 'optional' | 'collapseNesting' | 'compress' | 'importDocument' | 'pluginHost' | 'io'
>;

export function prepareStaticImports(root: Stylesheet, options?: PrepareStaticImportsOptions): MaybePromise<PreparedImports> {
  const pluginHost = options?.pluginHost;
  const importDocument = options?.importDocument ?? (options?.context ? importThroughContext(options.context) : undefined);
  const rootFns = globalScopedFns(pluginHost);
  const documents = new WeakMap<StyleImport, PlannedImportDocument>();
  const modules = new Map<ModuleImport, PreparedModule>();
  const e: Emit = {
    chunks: [],
    positions: null,
    ev: options?.evaluator ?? options?.context?.evaluator ?? null,
    modes: { ...(options?.modes ?? options?.context?.options ?? DEFAULT_MODES), compress: options?.compress ?? false },
    allowCallerScope: options?.context?.options.allowCallerScope ?? options?.modes?.allowCallerScope ?? false,
    trivia: options?.trivia ?? triviaMapOf(root) ?? options?.context?.opts.trivia,
    context: options?.context,
    excluded: new Set(),
    propNames: new Set(),
    pseudoElementParents: new Set(),
    optional: options?.optional ?? false,
    pending: [],
    drops: [],
    depth: 0,
    collapse: options?.collapseNesting !== false,
    collapseMode: options?.collapseNesting === 'compact' ? 'compact' : 'native',
    compress: options?.compress ?? false,
    extends: null,
    dynamicExtend: null,
    importedStaticExtendRules: null,
    importedWalkPlacement: false,
    importPlacements: null,
    importPlacement: undefined,
    hoistMode: false,
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1, droppedSemi: false },
    mixinDepth: 0,
    loadedImports: null,
    placedDocuments: null,
    moduleActivations: null,
    composeActivations: null,
    prepublishedModuleImports: null,
    moduleConfigs: null,
    multipleImportDepth: 0,
    referenceImportDepth: 0,
    atRuleBodyDepth: 0,
    importDocument,
    plannedImportDocuments: documents,
    plannedModuleImports: modules,
    preparedImportsOwnedByCaller: false,
    prepublishedImportFacts: null,
    hoistedCssImports: null,
    emittedBlockTrivia: new EmittedTrivia(),
    pendingLeafBlockComments: null,
    pendingLeafBlockCommentOwner: null,
    scopedFunctionNames: scopedFunctionNames(rootFns),
    lambdaFunctionNames: new Set(),
    fnScopeVersion: 0,
    pluginHost,
    pluginRawBindings: null,
    mixinUrlBindings: null,
    mixinValueBindings: null,
    compressedBindings: options?.compress === true ? new WeakMap() : undefined,
    writtenFrom: undefined,
    snapshotValues: new WeakMap(),
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
  const prepare = activateBodyDependencies(root.rules, rootFrame, e, false);
  const plan = (): MaybePromise<PreparedImports> => {
    if (!importDocument) {
      return makePreparedImports(documents, modules);
    }
    const planned = planImportedFacts(root, plannerRootFrame, e, importDocument, IMPORT_PLAN_PREPARE);
    return mapMaybe(planned, () => makePreparedImports(documents, modules));
  };
  return mapMaybe(prepare, plan);
}

export function serialize(root: Stylesheet, options?: SerializeOptions): SerializeReturn {
  const pluginHost = options?.pluginHost;
  const importDocument = options?.importDocument ?? (options?.context ? importThroughContext(options.context) : undefined);
  const rootFns = globalScopedFns(pluginHost);
  const preparedModulePlan = options?.preparedImports === undefined
    ? null
    : preparedModules(options.preparedImports);
  const e: Emit = {
    chunks: [],
    positions: options?.trackPositions ? [] : null,
    ev: options?.evaluator ?? options?.context?.evaluator ?? null, // typed value evaluator
    modes: { ...(options?.modes ?? options?.context?.options ?? DEFAULT_MODES), compress: options?.compress ?? false },
    allowCallerScope: options?.context?.options.allowCallerScope ?? options?.modes?.allowCallerScope ?? false, // [R16] legacy caller-read, default hermetic
    trivia: options?.trivia ?? triviaMapOf(root) ?? options?.context?.opts.trivia,
    context: options?.context,
    excluded: new Set(), // [resolver] per-declaration cycle guard
    propNames: new Set(), // [property-interp] interpolated-name re-entrancy guard
    pseudoElementParents: new Set(), // [nesting] parents never factored into `:is()`
    optional: options?.optional ?? false, // [resolver] strict (default) vs optional miss
    pending: [], // async patches
    drops: [], // [null] declarations that may still elide on the async lane
    depth: 0, // [atrule]
    collapse: options?.collapseNesting !== false, // [nested/R0] default = flatten
    collapseMode: options?.collapseNesting === 'compact' ? 'compact' : 'native', // [nested] unguarded vs specificity-guarded fold
    compress: options?.compress ?? false, // [compress] minified output
    extends: null, // [extend] computed below (after selector-interp pre-pass)
    dynamicExtend: null,
    importedStaticExtendRules: null,
    importedWalkPlacement: false,
    importPlacements: null,
    importPlacement: undefined,
    hoistMode: false, // [extend]
    lastBlock: { parentKey: null, header: '', depth: -1, endChunks: -1, droppedSemi: false }, // [adjacent-merge]
    mixinDepth: 0, // [recursion-backstop] runaway mixin-expansion depth guard
    loadedImports: null,
    placedDocuments: null,
    moduleActivations: null,
    composeActivations: null,
    prepublishedModuleImports: null,
    moduleConfigs: null,
    multipleImportDepth: 0,
    referenceImportDepth: 0,
    atRuleBodyDepth: 0,
    importDocument,
    plannedImportDocuments: options?.preparedImports === undefined
      ? (importDocument ? new WeakMap() : null)
      : preparedImportDocuments(options.preparedImports),
    plannedModuleImports: options?.preparedImports === undefined
      ? (options?.context ? new Map() : null)
      : preparedModulePlan,
    pendingPlannedModuleImports: preparedModulePlan?.size,
    preparedImportsOwnedByCaller: options?.preparedImports !== undefined,
    prepublishedImportFacts: null,
    hoistedCssImports: null,
    emittedBlockTrivia: new EmittedTrivia(),
    pendingLeafBlockComments: null,
    pendingLeafBlockCommentOwner: null,
    scopedFunctionNames: scopedFunctionNames(rootFns), // absent idle ⇒ fn-dispatch walk skipped
    lambdaFunctionNames: new Set(), // [lambda-fn] empty idle ⇒ user-`@function` lookup skipped
    fnScopeVersion: 0,
    pluginHost, // [plugin/P2] injected plugin runtime for scope-local `@plugin`
    pluginRawBindings: null,
    mixinUrlBindings: null,
    mixinValueBindings: null,
    compressedBindings: options?.compress === true ? new WeakMap() : undefined,
    writtenFrom: undefined, // set only on an F5 call's written lane (one shape for every spread)
    snapshotValues: new WeakMap(),
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
  const continueRender = (planned: ImportPlannerInput): SerializeReturn => {
    const plannedRoot = planned.root;

    /*
     * [extend] The planner classified the document's extend surface in its one spine
     * traversal. A no-extend document (`!static && !dynamic`) skips the interp pre-pass
     * and never allocates dynamic-extend state, so it is byte- and cost-identical to
     * the base no-extend path.
     */
    const extendClass = planned.extendClass;

    /*
     * [extend/selector-interp] Resolve interpolated selectors to static text BEFORE the
     * extend planner reads their IR — whenever the import graph has an `:extend()`, so
     * an extend a mixin, loop or imported sheet holds meets a root `.@{v}` rule as
     * well (ledger X7 as amended).
     */
    if (extendClass.static || extendClass.dynamic || planned.overlay.instructions.length > 0
      || (planned.imports?.dynamicTargetAtoms?.size ?? 0) > 0 || e.importedWalkPlacement) {
      resolveSelectorInterpForExtend(plannedRoot.rules, rootFrame, e);
    }
    e.extends = computeExtends(plannedRoot, planned.overlay, e.collapseMode !== 'compact'); // [extend] null when no `:extend()` anywhere
    e.importPlacements = planned.imports?.importPlacements ?? null;

    /*
     * [extend/dynamic] Arm walk-time extend recording only when the document has a
     * DYNAMIC extend surface (an extend inside a placing body, in the main document or
     * an import), or the graph has an extend and something places a rule the static
     * plan cannot see (a placing body, or an `@import` inside a ruleset). A static-only
     * extend document with no such placement, and every document with no extend, leaves
     * this null and is byte- and cost-identical to the pre-walk path (ledger X12 /
     * EXTEND-SEMANTICS §1a).
     */
    if (extendClass.dynamic || e.importedWalkPlacement || (extendClass.places && e.extends !== null)) {
      const staticRules = new Set<Ruleset>();
      const dynamicAtoms = new Set<string>(planned.imports?.dynamicTargetAtoms);
      collectDynamicExtendSets(plannedRoot.rules, false, staticRules, dynamicAtoms);
      if (e.importedStaticExtendRules) {
        for (const rule of e.importedStaticExtendRules) {
          staticRules.add(rule);
        }
      }
      const reveal = hiddenRulesToReveal(planned.overlay, dynamicAtoms, planned.imports?.importingRules ?? null);
      e.dynamicExtend = {
        root: plannedRoot,
        baseOverlay: planned.overlay,
        atRuleScopes: planned.overlay.atRuleScopes ?? new Map(),
        scope: EMPTY_SCOPE,
        boundary: null,
        moduleBoundaries: planned.imports?.moduleBoundaries ?? new Map(),
        pathRules: [],
        pathHeaders: [],
        pathKinds: [],
        pathMemo: [],
        pathSelectors: [],
        ownLevels: new Map(),
        targetBranches: new Map(),
        revealRules: reveal?.rules ?? null,
        revealAncestors: reveal?.ancestors ?? null,
        revealAtRules: reveal?.atRules ?? null,
        containerStarts: [],
        containerEnds: [],
        staticRules,
        subjects: [],
        instructions: [],
        slots: [],
        order: 0,
        pendingHeaderChunk: -1,
        pendingHeaderIndent: ''
      };
    }
    const start = e.chunks.length;

    /*
     * [charset] Hoist the first document-level `@charset` ahead of all body
     * content; inline occurrences are dropped during the walk (dedupe).
     */
    emitHoistedCharset(root.rules, rootFrame, e);

    /*
     * [comment-order] DESIGN-DECISIONS N11. A source-leading document block comment
     * (offset 0) emits AFTER the hoisted `@charset` and BEFORE the hoisted root CSS
     * `@import`s. This is NOT source order — the `@charset` may be hoisted out of an
     * imported file yet must still come first, because CSS Syntax Module Level 3 §3.2
     * (the input byte stream / determine-the-fallback-encoding algorithm) recognizes a
     * charset declaration only as the stylesheet's first bytes (a comment ahead of it
     * would demote it to an ineffective at-rule). The comment then precedes the hoisted
     * imports (N9). Emit it here, once; the `emitBody` call is dedupe-guarded by
     * `e.emittedBlockTrivia` and no-ops when the comment was already emitted here.
     */
    emitLeadingDocumentBlockComments(e);

    /*
     * A caller-provided import handler owns terminal-import decisions itself. The
     * public Context route has no such driver callback, so it uses the typed
     * document-prelude plan while retaining Context loading for non-terminals.
     */
    const hoisted = !options?.importDocument
      ? planned.cssImports === undefined
        ? emitHoistedCssImports(root.rules, rootFrame, e)
        : emitPlannedCssImports(planned.cssImports, e)
      : undefined;
    const finalize = (): SerializeResult => {
      /*
       * [extend/dynamic] DEFERRED REWRITE: fold the walk-recorded dynamic extenders
       * into their target header slots before the buffer is stringified. Runs after
       * every chunk (including async values) is placed; no-op when no dynamic fact
       * was recorded (ledger X12 / EXTEND-SEMANTICS §1a).
       */
      foldDynamicExtends(e);

      /* [null] A declaration whose async value resolved to `null` is dropped here —
       * blanked rather than spliced, because a pending slot addresses BY INDEX. */
      for (const drop of e.drops) {
        if (drop.sink.elided) {
          for (let i = drop.from; i < drop.to; i++) {
            e.chunks[i] = '';
          }
        }
      }
      if (e.positions) {
        resolvePositionOffsets(e.chunks, e.positions);
        return { css: e.chunks.join(''), positions: e.positions };
      }
      return { css: e.chunks.join('') };
    };
    const finish = (): SerializeReturn => {
      if (e.positions) {
        e.positions.push({ node: root, type: root.type, start, end: e.chunks.length, source: srcFile(e) });
      }

      // lift to async ONLY if a genuinely-async built-in reserved a placeholder.
      if (e.pending.length > 0) {
        return Promise.all(e.pending.map(x => x.p.then((b) => {
          e.chunks[x.i] = b;
        }))).then(finalize);
      }
      return finalize();
    };
    const emitBody = (): SerializeReturn => {
      emitLeadingDocumentBlockComments(e);
      return mapMaybe(emitDocumentStatements(root.rules, rootFrame, e, importDocument), finish);
    };
    return mapMaybe(hoisted, emitBody);
  };

  /*
   * Planner-only evaluation remains isolated on this lexical frame. Direct
   * document-root import lookup facts also flow through the explicit root-frame
   * publication edge passed to `planImportedFacts`; imported bodies and CSS do
   * not execute until their authored lexical splice.
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
  const prepare = activateBodyDependencies(root.rules, rootFrame, e);
  const plan = (): SerializeReturn => {
    const mode = options?.importDocument
      ? IMPORT_PLAN_RENDER_EXPLICIT
      : IMPORT_PLAN_RENDER_CONTEXT;
    const planned = planImportedFacts(root, plannerRootFrame, e, importDocument, mode, rootFrame);
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
    && !isStaticQuoted(child.target)
    && !(child.target.type === 'Url' && isStaticQuoted(child.target.value)));
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
        pending = pending.then(() => Promise.resolve(nestedBody(current, frame, e)));
      } else {
        const emitted = nestedBody(current, frame, e);
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
      const emit = () => expandStyleImport(child, frame, e, importDocument);
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
  const emitBeforeDocumentStatement = (child: Statement): void => {
    if (e.referenceImportDepth !== 0) {
      documentTriviaCursor = statementStartOf(child) ?? documentTriviaCursor;
      return;
    }
    emitBlockCommentTriviaBetween(e, documentTriviaCursor, statementStartOf(child), '');
  };
  const markAfterDocumentStatement = (child: Statement): void => {
    documentTriviaCursor = statementEndOf(child) ?? documentTriviaCursor;
  };
  const flushDocumentGroup = (group: Leaf[]): MaybePromise<void> => {
    const trailingBlockComments = takePendingLeafBlockComments(e, group);

    /* A comment statement (SCSS) at the document level is written there, not in a block. */
    if (group.length !== 0 && group.every(leaf => leaf.node.type === 'Comment')) {
      for (const leaf of group) {
        emitLeaf(leaf, e, true);
      }
      group.length = 0;
    }
    if (group.length) {
      return mapMaybe(
        flushBlock([], group, e, undefined, undefined, trailingBlockComments),
        () => {
          group.length = 0;
        }
      );
    }
    for (const comment of trailingBlockComments) {
      putBlockComment(e, '', comment);
    }
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
        if (e.referenceImportDepth === 0
          || referenceRuleIsVisible(child, frame, e)
          || extendProjection(e)?.visibleReferenceRuleAncestors?.has(child) === true
          || e.dynamicExtend?.revealRules?.has(child) === true
          || e.dynamicExtend?.revealAncestors?.has(child) === true) {
          emitBeforeDocumentStatement(child);
          const emitted = expandRule(child, null, null, frame, e);
          markAfterDocumentStatement(child);
          return emitted;
        }
        break;
      case 'MixinDefinition':
        if (imported) {
          /*
           * `expandStyleImport` already published this definition in the import's
           * source-order callable stream. Keep its existing ordinary-call
           * publication, but do not record the same source statement twice.
           */
          publishImportedMixinDefinition(frame, child, false);
        } else {
          publishSelectedMixinDefinition(frame, child);
        }
        markSilentStatementBlockCommentTrivia(child, e);
        break;
      case 'VariableDeclaration':
        activateVariableDeclaration(child, frame, e);
        markSilentStatementBlockCommentTrivia(child, e);
        break;
      case 'MixinCall': {
        if (e.referenceImportDepth !== 0) {
          break;
        }
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => flushDocumentGroup(group);
        return mapMaybe(expandCall(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'Apply': {
        if (e.referenceImportDepth !== 0) {
          break;
        }
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => flushDocumentGroup(group);
        return mapMaybe(expandApply(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'Reference': {
        if (e.referenceImportDepth !== 0) {
          break;
        }

        // A final call step can splice a detached ruleset at document level.
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => flushDocumentGroup(group);
        return mapMaybe(expandReferenceCall(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'For': {
        if (e.referenceImportDepth !== 0) {
          return expandReferenceAncestorFor(child, null, null, frame, e, false, false);
        }

        // a top-level `each(...)` loop — its body emits at the document level.
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => flushDocumentGroup(group);
        return mapMaybe(expandFor(child, null, null, frame, group, flush, null, e), flush);
      }
      case 'If': {
        if (e.referenceImportDepth !== 0) {
          break;
        }
        const body = selectIfBody(child, frame, e);
        if (!body) {
          break;
        }
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => flushDocumentGroup(group);
        return mapMaybe(walkBody(body, null, null, frame, group, flush, null, e), flush);
      }
      case 'While': {
        if (e.referenceImportDepth !== 0) {
          break;
        }
        const group: Leaf[] = [];
        const flush = (): MaybePromise<void> => flushDocumentGroup(group);
        return mapMaybe(
          runWhile(child, frame, e, rules => walkBody(rules, null, null, frame, group, flush, null, e)),
          flush
        );
      }
      case 'Declaration':
      case 'Comment':
        if (e.referenceImportDepth === 0) {
          emitBeforeDocumentStatement(child);
          emitLeaf(evaluatedLeaf(child, frame), e, true);
          markAfterDocumentStatement(child);
        }
        break;

      // [atrule] top-level at-rules
      case 'AtRuleBlock':
        if (e.referenceImportDepth === 0 || referenceAtRuleShown(child, e)) {
          emitBeforeDocumentStatement(child);
          const emitted = endRevealContainer(revealContainerStart(child, e), e, expandAtRuleBlock(child, frame, e));
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
          const emitted = expandStyleImport(child, frame, e, importDocument);
          markAfterDocumentStatement(child);
          return emitted;
        }
      case 'ModuleImport':
        if (e.referenceImportDepth === 0) {
          emitBeforeDocumentStatement(child);
          emitModuleImport(child, frame, e);
          markAfterDocumentStatement(child);
        }
        break;
      case 'UnknownAtRuleBlock':
        if (e.referenceImportDepth === 0) {
          emitBeforeDocumentStatement(child);
          emitUnknownAtRuleBlock(child, e);
          markAfterDocumentStatement(child);
        }
        break;

      // a bare value-position call statement (`e('/* … */');`): evaluate + emit.
      case 'FunctionCall':
        if (e.referenceImportDepth !== 0) {
          break;
        }
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
function selectedIfBody(node: If, frame: Frame, e: EvalCtx): Statement[] | null {
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
   * The body's declarations are in this frame's index BEFORE the first
   * condition runs: a `$while` has no arm to select, so selecting the frame's
   * control flow registers its one body ({@link collectSelectedDeclIndex}).
   */
  if (frame.selectedDeclIndex === undefined && frame.declIndex?.controlFlow === true) {
    selectControlFlow(frame, e);
  }
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

/**
 * Build a frame's selected declaration index: the first time, by deciding its
 * control flow ({@link preselectControlFlow}); after an imported fact has
 * joined the frame, by rebuilding the stacks around the decisions already made.
 * Called only for a frame with a direct `$if`/`if()`/`$while` whose index is
 * not built. Without an evaluation context nothing can be decided yet, so the
 * read sees the frame's plain index.
 */
function selectControlFlow(frame: Frame, e: EvalCtx | undefined): void {
  if (frame.preselectedIfs !== undefined) {
    frame.selectedDeclIndex = collectSelectedDeclIndex(frame, frame.selectedIfBodies ?? EMPTY_SELECTED_IF_BODIES);
  } else if (e !== undefined) {
    preselectControlFlow(frame, e);
  }
}

/** An arm whose statements can add to the selected declaration index. */
const armDeclares = (body: readonly Statement[]): boolean =>
  body.some(statement => statement.type === 'VariableDeclaration' || statement.type === 'While' || statement.type === 'If');

/**
 * Decide a frame's direct control flow before its first scoped read or its
 * first control statement, whichever execution reaches first (ledger N15,
 * ruling J2): a selected arm's declarations are inline declarations at the
 * `if()`/`$if`, and scoped (`@name`, `$^name`) lookup is order-independent and
 * last-wins in the frame, so a scoped read written before it sees the arm too.
 * Every `$while` body registers as well ({@link collectSelectedDeclIndex}).
 *
 * Each `if()`/`$if` is decided ONCE per activation, here or, failing that, when
 * execution reaches it ({@link selectIfBody}): the arm whose declarations are
 * visible is always the arm that runs, and a condition runs once. Conditions
 * are decided in source order, each seeing the arms before it and neither its
 * own arm nor a later one, so `@c: red; if((iscolor(@c)), { @c: 1px; … })`
 * selects its arm and every other read of `@c` in the frame is `1px`.
 *
 * Deciding stops at the first statement that cannot be decided before
 * execution, and that statement and every one after it are decided when
 * execution reaches them, so a condition always sees exactly the arms before
 * it. Such a statement is one whose condition reads a binding
 * {@link readsInOrder}, or names one that exists only once execution has made
 * it — a variable a mixin call leaks into the frame.
 *
 * The conditions run on a statement-level context: whatever read triggered
 * this may be mid-way through another value (its exclusions, an optional
 * probe, a `calc()` or an `!important` sink), none of which is the condition's.
 */
function preselectControlFlow(frame: Frame, e: EvalCtx): void {
  const decided = new Map<If, Statement[] | null>();
  frame.preselectedIfs = decided;
  frame.selectedDeclIndex = collectSelectedDeclIndex(frame, frame.selectedIfBodies ?? EMPTY_SELECTED_IF_BODIES);
  const statements = frame.statements;
  if (!statements) {
    return;
  }
  let ctx: EvalCtx | undefined;
  for (const statement of statements) {
    if (statement.type !== 'If' || unloweredCall(statement) !== null) {
      continue;
    }
    if (ifReadsInOrder(statement)) {
      return;
    }
    ctx ??= {
      ...e,
      excluded: new Set(),
      optional: false,
      calcDepth: undefined,
      parenFrames: undefined,
      exprBoundary: undefined,
      importantSink: undefined,
      elideSink: undefined,
      mergeImportant: undefined,
      defaultFn: undefined
    };
    let body: Statement[] | null;
    try {
      body = selectedIfBody(statement, frame, ctx);
    } catch (error) {
      if (error instanceof JessError && error.code === 'resolve/name-not-found') {
        return;
      }
      throw error;
    }
    decided.set(statement, body);
    if (body !== null) {
      (frame.selectedIfBodies ??= new Map()).set(statement, body);
      if (armDeclares(body)) {
        frame.selectedDeclIndex = collectSelectedDeclIndex(frame, frame.selectedIfBodies);
      }
    }
  }
}

/**
 * The arm of an `if()`/`$if` that execution has reached: the decision
 * {@link preselectControlFlow} made for it, else its condition evaluated now,
 * with the selected arm published into this activation's scoped index.
 */
function selectIfBody(node: If, frame: Frame, e: EvalCtx): Statement[] | null {
  /* [P36] Not lowered where built-ins are not ambient: the body is the ordinary call statement. */
  const unlowered = unloweredCall(node);
  if (unlowered !== null) {
    return [unlowered];
  }
  if (frame.selectedDeclIndex === undefined && frame.declIndex?.controlFlow === true) {
    selectControlFlow(frame, e);
  }
  const decided = frame.preselectedIfs?.get(node);
  if (decided !== undefined) {
    return decided;
  }
  const body = selectedIfBody(node, frame, e);
  if (!body) {
    return null;
  }
  const selected = frame.selectedIfBodies ??= new Map();
  if (selected.get(node) !== body) {
    selected.set(node, body);
    if (frame.selectedDeclIndex !== undefined) {
      frame.selectedDeclIndex = collectSelectedDeclIndex(frame, selected);
    }
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

/** The top-level at-rule scope. The solver only reads a scope (never mutates), so
 * one array is safe to share. */
const EMPTY_SCOPE: number[] = [];

/**
 * [extend/dynamic] Build a selector-IR level from ALREADY-COMPOSED header text. Each
 * composed branch becomes one opaque descendant compound — its serialized text is
 * exact, and for a simple-class rule (`.col-1`) it is token-identical to the
 * AST-derived IR. A compound or complex header is held as one opaque compound: it
 * serializes and folds correctly, but a compound target cannot match one of its parts.
 * ponytail: used only where the selector IR is not known — a header composed against
 * a placement the recorder never opened, or an interpolated selector the walk could
 * not resolve as structure ({@link resolvedSelectorList}: a lone `@{name}` that may be
 * a captured list, a resolved `&`, an interpolated ruleset-mixin placement).
 */
function opaqueLevel(header: readonly string[]): Level {
  return header.map(text => descendantBranch([textSimple(text)]));
}

/** How an open rule's extend path starts (see {@link DynamicExtendState.pathKinds}). */
const PATH_NESTED = 0; // under the enclosing open rule
const PATH_ROOT = 1; // at a root context: its own selector alone
const PATH_OPAQUE = 2; // its header text, held as one opaque level
const PATH_OPAQUE_NESTED = 3; // its own-local header text, opaque, under the enclosing open rule
const PATH_ROOT_GUARD = 4; // a root `&` guard block: its own selector alone; its children are root rules

/**
 * [extend/dynamic] Open `rule` on the recorder's path, written with `header`: the
 * flat writer's composed header, or the nested writer's own-local one (`local`).
 * `rooted` — written at a root context; `resolved` — the walk's one resolution of an
 * interpolated selector ({@link resolvedSelectorList}), read in place of the rule's own.
 * Returns the open-rule depth to restore.
 */
function openDynamicPath(
  dyn: DynamicExtendState,
  rule: Ruleset,
  rooted: boolean,
  header: string[],
  local: boolean,
  resolved: SelectorList | undefined = undefined
): number {
  const depth = dyn.pathRules.length;

  /*
   * Under a root `&` guard block (`& when (…) { … }`), which the nested writer keeps
   * as a lone `&` wrapper, a rule composes as a root rule, as the flat writer has it.
   */
  if (!rooted && depth > 0 && dyn.pathKinds[depth - 1] === PATH_ROOT_GUARD) {
    rooted = true;
  }
  let kind = rooted ? PATH_ROOT : PATH_NESTED;
  if (rooted && local && header.length === 1 && header[0] === '&') {
    kind = PATH_ROOT_GUARD;
  } else if (!rooted && depth === 0) {
    kind = PATH_OPAQUE;
  } else if (resolved === undefined && rule.selector.selectors.some(selectorBranchHasInterp)) {
    kind = local && !rooted ? PATH_OPAQUE_NESTED : PATH_OPAQUE;
  }
  dyn.pathRules.push(rule);
  dyn.pathHeaders.push(header);
  dyn.pathKinds.push(kind);
  dyn.pathMemo.push(undefined);
  dyn.pathSelectors.push(resolved);
  return depth;
}

/**
 * [extend/dynamic] The extend path (ancestor levels, then own) of the open rule at
 * `index`, built from the rules' selector IR on first read only — most open rules are
 * never read. The walk already composed these selectors; this rebuilds no selector
 * text and evaluates nothing.
 */
function dynamicPathAt(dyn: DynamicExtendState, index: number): Level[] {
  let path = dyn.pathMemo[index];
  if (path === undefined) {
    const kind = dyn.pathKinds[index]!;
    const resolved = dyn.pathSelectors[index];
    const own = kind === PATH_OPAQUE || kind === PATH_OPAQUE_NESTED
      ? opaqueLevel(dyn.pathHeaders[index]!)
      : resolved !== undefined ? levelFromSelectorList(resolved) : ownLevelOf(dyn, dyn.pathRules[index]!);
    path = kind === PATH_ROOT || kind === PATH_ROOT_GUARD || kind === PATH_OPAQUE ? [own] : [...dynamicPathAt(dyn, index - 1), own];
    dyn.pathMemo[index] = path;
  }
  return path;
}

/**
 * [extend/dynamic] Record the extend facts of the innermost open rule, `rule`: its
 * path is the open rules it composed under, its placement the innermost one it lands
 * in. An inline extend narrows to its own branch only on a structured path. `target`
 * — the rule is also a match subject (false when the fold could not rewrite its
 * header, so solving it would be wasted work).
 */
function recordOpenRule(dyn: DynamicExtendState, rule: Ruleset, frame: Frame, e: Emit, target = true): void {
  const open = dyn.pathRules.length - 1;
  const kind = dyn.pathKinds[open]!;
  recordDynamicExtendFacts(
    dyn, rule, innermostExtendPlacement(frame, e), e.referenceImportDepth > 0,
    dynamicPathAt(dyn, open), kind === PATH_ROOT || kind === PATH_ROOT_GUARD || kind === PATH_NESTED, target,
    dyn.pathSelectors[open]
  );
}

/** [extend/dynamic] A rule's own selector level, built once per canonical rule. The
 * solver never mutates a level (composePath clones), so every placement shares it. */
function ownLevelOf(dyn: DynamicExtendState, rule: Ruleset): Level {
  let own = dyn.ownLevels.get(rule);
  if (own === undefined) {
    own = levelFromSelectorList(rule.selector);
    dyn.ownLevels.set(rule, own);
  }
  return own;
}

/**
 * [extend/dynamic] Run `run`, then restore the recorder's placement — at-rule scope,
 * sheet boundary and open-rule depth — however `run` settles.
 */
function withDynamicPlacement<T>(
  dyn: DynamicExtendState,
  depth: number,
  scope: number[],
  boundary: ExtendBoundary | null,
  run: () => MaybePromise<T>
): MaybePromise<T> {
  return settled(run, () => {
    dyn.scope = scope;
    dyn.boundary = boundary;
    dyn.pathRules.length = depth;
    dyn.pathHeaders.length = depth;
    dyn.pathKinds.length = depth;
    dyn.pathMemo.length = depth;
    dyn.pathSelectors.length = depth;
  });
}

/** Run `run`, then `restore` however it settles: returned, resolved, thrown or rejected. */
function settled<T>(run: () => MaybePromise<T>, restore: () => void): MaybePromise<T> {
  try {
    const result = run();
    if (isThenable(result)) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

/**
 * [extend/dynamic] The hidden `(reference)` rules a walk-recorded extend may reveal
 * (#355), and the hidden rules enclosing them. A hidden rule with no visible branch
 * is otherwise never rendered, so a placing-body extender found later in the walk
 * would have no header to fold into. `atoms` are the target atoms of the extends in
 * placing bodies — the only extends the static plan has not already applied — closed
 * over the hidden static extends they reach (an extender a recorded extend reveals
 * reveals its own targets). A hidden rule whose own level shares one, or whose body
 * holds an `@import` the walk places (`importing`), renders as a RESERVED block,
 * which the fold blanks when nothing reveals it. Reads the planner's facts; builds no
 * selector IR.
 */
function hiddenRulesToReveal(
  overlay: PlanOverlay,
  atoms: Set<string>,
  importing: ReadonlySet<Ruleset> | null
): { rules: Set<Ruleset>; ancestors: Set<Ruleset>; atRules: Set<AtRuleBlock> | null } | null {
  if (atoms.size === 0 && importing === null) {
    return null;
  }
  for (let size = -1; size !== atoms.size;) {
    size = atoms.size;
    for (const inst of overlay.instructions) {
      if (inst.extenderHidden && inst.extenderPath.some(level => level.some(b => branchSharesAtom(b, atoms)))) {
        collectBranchAtoms(inst.target, atoms);
      }
    }
  }
  const rules = new Set<Ruleset>();
  const ancestors = new Set<Ruleset>();
  let atRules: Set<AtRuleBlock> | null = null;
  for (const s of overlay.subjects) {
    if (!s.hidden
      || (!(s.parent !== null && rules.has(s.parent.rule))
        && importing?.has(s.rule) !== true
        && !s.ownLocal.some(b => branchSharesAtom(b, atoms)))) {
      continue;
    }
    rules.add(s.rule);
    for (let p = s.parent; p !== null && !rules.has(p.rule) && !ancestors.has(p.rule); p = p.parent) {
      ancestors.add(p.rule);
    }

    /* The hidden at-rules around it render as reserved containers too. */
    for (let owner = s.referenceAtRule; owner !== null && atRules?.has(owner.node) !== true; owner = owner.parent) {
      (atRules ??= new Set()).add(owner.node);
    }
  }
  recordAstExtendProfile?.('astExtend.preflight.revealRules', rules.size);
  return rules.size === 0 ? null : { rules, ancestors, atRules };
}

/**
 * [import:reference] Whether a hidden `(reference)` at-rule block renders: the extend
 * plan revealed a rule in it, or a walk-recorded extend may (a RESERVED container,
 * {@link revealContainerStart}).
 */
function referenceAtRuleShown(node: AtRuleBlock, e: Emit): boolean {
  return extendProjection(e)?.visibleReferenceAtRules?.has(node) === true
    || e.dynamicExtend?.revealAtRules?.has(node) === true;
}

/**
 * [import:reference] Where a hidden at-rule block about to be written starts, when only a
 * walk-recorded extend may reveal a rule in it (a RESERVED container); else -1.
 * {@link endRevealContainer} records the range, so the deferred fold blanks it if
 * nothing in it is revealed after all.
 */
function revealContainerStart(node: AtRuleBlock, e: Emit): number {
  return e.dynamicExtend === null || e.referenceImportDepth === 0
    || extendProjection(e)?.visibleReferenceAtRules?.has(node) === true
    ? -1
    : e.chunks.length;
}

/** [import:reference] Close the reserved container {@link revealContainerStart} opened. */
function endRevealContainer(start: number, e: Emit, written: MaybePromise<void>): MaybePromise<void> {
  const dyn = e.dynamicExtend;
  if (start < 0 || dyn === null) {
    return written;
  }
  return mapMaybe(written, () => {
    dyn.containerStarts.push(start);
    dyn.containerEnds.push(e.chunks.length);
  });
}

/** [extend/dynamic] The placement that keys a walk-recorded fact or header slot: the
 * innermost `$for`/mixin-call placement token on the frame chain, else the import
 * placement being emitted, else none (static). */
function innermostExtendPlacement(frame: Frame | null, e: Emit): object | undefined {
  for (let cursor = frame; cursor; cursor = cursor.parent) {
    if (cursor.extendPlacement) {
      return cursor.extendPlacement;
    }
  }
  return e.importPlacement;
}

/** [extend/splice] True when this rule is emitted through a mixin-call body splice —
 * its static extend-plan header (keyed on the shared definition node) does NOT apply
 * to this call-site placement (see {@link Frame.mixinSplice}). */
function reachedViaMixinSplice(frame: Frame | null): boolean {
  for (let cursor = frame; cursor; cursor = cursor.parent) {
    if (cursor.mixinSplice) {
      return true;
    }
  }
  return false;
}

/**
 * [extend/dynamic] Record the extend facts for a rule reached through a dynamic
 * expansion (a placing body or mixin call, or an import inside a ruleset), at the
 * at-rule scope, sheet boundary and placement it lands in. `path` is its extend path:
 * the flat writer's open rules (`dynamicPathAt`), or the nested writer's own-local
 * header. This only registers the fact — it never re-drives evaluation (ledger X12 /
 * EXTEND-SEMANTICS §1a). A rule the static plan already holds at this placement is
 * skipped by the callers.
 */
function recordDynamicExtendFacts(
  dyn: DynamicExtendState,
  rule: Ruleset,
  placement: object | undefined,
  hidden: boolean,
  path: Level[],
  structured: boolean,
  target: boolean,
  resolved: SelectorList | undefined
): void {
  const scope = dyn.scope;
  const boundary = dyn.boundary;
  if (target) {
    dyn.subjects.push({
      rule,
      path,
      scope,
      ownLocal: path[path.length - 1]!,
      parent: null,
      mayMatch: false,
      hidden,
      boundary,
      referenceAtRule: null,
      placement
    });
  }
  if (rule.extendInstructions) {
    for (const inst of rule.extendInstructions) {
      /*
       * An inline extend binds to its own branch, as `collectPlan` reads it: in the
       * walk's resolution of the rule's selector when there is one.
       */
      const at = inst.subject && resolved !== undefined ? rule.selector.selectors.indexOf(inst.subject.selectors[0]!) : -1;
      const extenderPath = inst.subject && structured
        ? [...path.slice(0, -1), at >= 0 ? [branchFromSelector(resolved!.selectors[at]!)] : levelFromSelectorList(inst.subject)]
        : path;
      recordDynamicInstruction(dyn, inst, extenderPath, hidden);
    }
  }
}

/** [extend/dynamic] Record one `:extend()` the walk reached, extended by `extenderPath`
 * at the walk's current scope and sheet boundary. */
function recordDynamicInstruction(dyn: DynamicExtendState, inst: ExtendInstruction, extenderPath: Level[], hidden: boolean): void {
  let targets = dyn.targetBranches.get(inst);
  if (targets === undefined) {
    targets = inst.target.selectors.map(branchFromSelector);
    dyn.targetBranches.set(inst, targets);
  }
  for (const target of targets) {
    dyn.instructions.push({
      target,
      partial: inst.partial,
      extenderPath,
      scope: dyn.scope,
      order: dyn.order++,
      extenderHidden: hidden,
      boundary: dyn.boundary
    });
  }
}

/**
 * [extend/dynamic] The body-form `&:extend()`s of a body the walk places: a called
 * definition's (ledger X16, jess#356), a called detached ruleset's or an at-rule
 * block's (X19). The rule the body lands in — the innermost open rule — extends, at the
 * walk's current scope, as if the extend were written in that rule's own body (lessc
 * copies the Extend into the caller). A body outside every rule extends nothing. A
 * ruleset called as a mixin brings only its body-form extends; an inline one (with a
 * `subject`) binds to its own selector.
 */
function recordBodyExtends(dyn: DynamicExtendState, instructions: readonly ExtendInstruction[], e: Emit): void {
  const open = dyn.pathRules.length - 1;
  if (open < 0 || dyn.pathKinds[open] === PATH_ROOT_GUARD) {
    return;
  }
  let path: Level[] | undefined;
  for (const inst of instructions) {
    if (inst.subject === undefined) {
      recordDynamicInstruction(dyn, inst, path ??= dynamicPathAt(dyn, open), e.referenceImportDepth > 0);
    }
  }
}

/** [extend/dynamic] Register the header chunk `flushBlock` just wrote as a rewritable
 * FLAT target slot (keyed per emission by the placement token). */
function recordDynExtendSlot(e: Emit, rule: Ruleset, frame: Frame, emitted: string[], reserved: boolean): void {
  const dyn = e.dynamicExtend;
  if (!dyn || dyn.pendingHeaderChunk < 0) {
    return;
  }
  dyn.slots.push({
    rule,
    token: innermostExtendPlacement(frame, e),
    chunkIndex: dyn.pendingHeaderChunk,
    indent: dyn.pendingHeaderIndent,
    hoistMode: e.hoistMode,
    emitted,
    hiddenRef: e.referenceImportDepth > 0,
    reserved,
    blockEnd: e.chunks.length,
    nested: false
  });
  dyn.pendingHeaderChunk = -1;
}

/** [extend/dynamic] Register a NESTED-writer header chunk as a rewritable target slot.
 * The deferred rewrite recomposes it from the re-solved own-local `nestedPlan` header. */
function recordNestedDynExtendSlot(e: Emit, rule: Ruleset, frame: Frame, chunkIndex: number, indent: string, emitted: string[], blockEnd: number): void {
  const dyn = e.dynamicExtend;
  if (!dyn) {
    return;
  }
  dyn.slots.push({
    rule,
    token: innermostExtendPlacement(frame, e),
    chunkIndex,
    indent,
    hoistMode: e.hoistMode,
    emitted,
    hiddenRef: e.referenceImportDepth > 0,
    reserved: false,
    blockEnd,
    nested: true
  });
}

/**
 * [extend/dynamic] The extend results once the walk-recorded facts join the static
 * plan, or null when they cannot change any header. A recorded rule that shares no
 * atom with any extend target can neither match nor chain (the planner's `mayMatch`
 * argument), so it is left out; with none left and no recorded extend, the static
 * results already stand and nothing is re-solved.
 */
function resolveDynamicExtends(dyn: DynamicExtendState, base: ExtendResults | null, guardedNesting: boolean): ExtendResults | null {
  const atoms = new Set<string>(base?.targetAtoms);
  for (const inst of dyn.instructions) {
    collectBranchAtoms(inst.target, atoms);
  }
  const subjects = dyn.subjects.filter(s => s.path.some(level => level.some(b => branchSharesAtom(b, atoms))));
  recordAstExtendProfile?.('astExtend.fold.recordedSubjects', dyn.subjects.length);
  recordAstExtendProfile?.('astExtend.fold.keptSubjects', subjects.length);
  if (subjects.length === 0 && dyn.instructions.length === 0) {
    return null;
  }
  const overlay: PlanOverlay = {
    subjects: [...dyn.baseOverlay.subjects, ...subjects],
    instructions: [...dyn.baseOverlay.instructions, ...dyn.instructions],
    atRuleScopes: dyn.atRuleScopes
  };
  return computeExtends(dyn.root, overlay, guardedNesting);
}

/**
 * [extend/dynamic] DEFERRED REWRITE. After the ONE render walk, re-solve extend with
 * the STATIC plan plus the walk-recorded dynamic facts, then overwrite each recorded
 * target header slot whose complete selector now differs from what was emitted, and
 * blank each hidden `(reference)` block left with no visible branch. No evaluation is
 * re-driven — this reads resolved static shapes and rewrites text (ledger X12 /
 * EXTEND-SEMANTICS §1a).
 */
function foldDynamicExtends(e: Emit): void {
  const dyn = e.dynamicExtend;
  if (!dyn) {
    return;
  }
  const resolved = resolveDynamicExtends(dyn, e.extends, e.collapseMode !== 'compact');
  if (resolved !== null) {
    e.extends = resolved;
  }
  let revealed: number[] | null = null;
  for (const slot of dyn.slots) {
    let visible: string[] | null;
    if (resolved === null) {
      /* Nothing recorded changes a header: only a RESERVED block, which nothing revealed, goes. */
      visible = slot.reserved ? null : slot.emitted;
    } else if (slot.nested) {
      /*
       * NESTED writer: recompose from the own-local `nestedPlan` header (a flat
       * composed header would double the ancestor prefix at a nested position). A
       * flattened/hoisted nested plan is left as emitted — restructuring is not a
       * deferred-rewrite operation (a bounded follow-up, see EXTEND-SEMANTICS §1a).
       */
      const plan = placementProjection(resolved, slot.token)?.nestedPlan.get(slot.rule);
      visible = plan && !plan.flatten
        ? withoutPlaceholders(plan.header)
        : slot.emitted;
    } else {
      const projection = placementProjection(resolved, slot.token);
      const header0 = slot.hoistMode
        ? projection?.hoistHeader.get(slot.rule) ?? projection?.flatByRule.get(slot.rule) ?? slot.emitted
        : projection?.flatByRule.get(slot.rule) ?? slot.emitted;
      visible = visibleHeaderCore(slot.rule, header0, projection, slot.hiddenRef);
    }
    if (visible === null) {
      /*
       * [import:reference] A hidden `(reference)` rule with no visible extender folded
       * in emits nothing: blank the block it was emitted into. A non-reference rule
       * never resolves to null here, so this only fires for hidden reference blocks.
       */
      if (slot.hiddenRef) {
        for (let i = slot.chunkIndex; i < slot.blockEnd; i++) {
          e.chunks[i] = '';
        }
      }
      continue;
    }
    if (slot.reserved && dyn.containerStarts.length > 0) {
      (revealed ??= []).push(slot.chunkIndex);
    }
    if (arraysEqualText(visible, slot.emitted)) {
      continue;
    }
    e.chunks[slot.chunkIndex] = slot.indent
      ? visible.join(',\n' + slot.indent)
      : visible.join(',\n');
  }

  /*
   * [import:reference] A hidden at-rule written only as a reserved container goes with
   * its reserved rules when none of them was revealed. Slots are recorded in emission
   * order, so the revealed chunks ascend and each container binary-searches them.
   */
  for (let c = 0; c < dyn.containerStarts.length; c++) {
    const start = dyn.containerStarts[c]!;
    const end = dyn.containerEnds[c]!;
    let lo = 0;
    let hi = revealed?.length ?? 0;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (revealed![mid]! < start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (revealed === null || lo === revealed.length || revealed[lo]! >= end) {
      for (let i = start; i < end; i++) {
        e.chunks[i] = '';
      }
    }
  }
}

/** [extend/dynamic] Byte-array header-branch equality (change detection for a slot). */
function arraysEqualText(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
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
 * serializer stays byte-identical. Shared by the live walk (`visibleHeader`) and the
 * deferred fold, so the two never diverge.
 *
 *  - extend folded a per-branch mask (`hiddenByRule`, aligned 1:1 with the FLAT
 *    header): keep the branches whose mask bit is false. This also handles a VISIBLE
 *    rule that received a hidden extender branch (drop just that branch).
 *  - no mask, and the rule is placed inside a `(reference)` import (`hidden`) where
 *    extend never changed it: all its (seed-only) branches are hidden → drop it.
 *    Hiding follows the placement, not the canonical rule: the same rule reached by a
 *    plain import, or called as a mixin from outside the reference import, is visible.
 */
function visibleHeaderCore(
  rule: Ruleset,
  header: string[],
  projection: ExtendResults | ExtendPlacementResults | null,
  hidden: boolean
): string[] | null {
  const mask = projection?.hiddenByRule.get(rule);
  if (mask?.length === header.length) {
    const vis = header.filter((_, i) => mask[i] !== true);
    return vis.length > 0 ? withoutPlaceholders(vis) : null;
  }
  if (hidden && projection?.flatByRule.has(rule) !== true) {
    return null;
  }
  return withoutPlaceholders(header);
}

/**
 * The extend projection of one render placement: the static projection for the
 * static placement (`token` undefined), else that placement's own — null when the
 * plan projected nothing there. Never the static projection for a placed copy: it
 * holds the static copy of the same canonical rules (#359).
 */
function placementProjection(
  ext: ExtendResults,
  token: object | undefined
): ExtendResults | ExtendPlacementResults | null {
  return token === undefined ? ext : ext.byPlacement?.get(token) ?? null;
}

/**
 * The extend projection the walk emits under. The pre-walk plan knows the static
 * placement and each planned import placement; a loop iteration or mixin call is a
 * placement only the deferred fold projects, so the walk reads its import placement.
 */
function extendProjection(e: Emit): ExtendResults | ExtendPlacementResults | null {
  return e.extends === null ? null : placementProjection(e.extends, e.importPlacement);
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
  return visibleHeaderCore(rule, header, extendProjection(e), e.referenceImportDepth > 0);
}

/** A hidden reference subject emits only when its current extend projection has
 * at least one visible branch. A missing mask on a projected rule means every
 * surviving branch is visible (not that visibility information is absent). */
function referenceRuleIsVisible(rule: Ruleset, frame: Frame, e: Emit): boolean {
  const ext = extendProjection(e);
  if (ext?.flatByRule.has(rule) !== true) {
    return false;
  }
  const mask = ext.hiddenByRule.get(rule);
  if (mask === undefined) {
    return true;
  }
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluate shared ruleset gates and placement, then call the selected writer.
 * The optional nested arguments are existing writer state; their presence chooses
 * the projection without consulting the output setting during evaluation.
 */
function expandRule(
  rule: Ruleset,
  parent: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  imp = false,
  expandBubbledSelectorList = false,
  nestedSource?: NestedHeaderSource | null,
  nestedHoist?: HoistEntry[]
): MaybePromise<void> {
  if (nestedSource !== undefined && nestedHoist !== undefined) {
    const nestedPlan = extendProjection(e)?.nestedPlan.get(rule);
    if (nestedPlan?.flatten && !reachedViaMixinSplice(frame)) {
      recordAstExtendProfile?.('astExtend.emit.nestedHoistPlacements');
      nestedHoist.push({ rule, frame, bubble: nestedPlan.hoistBubble ?? 1, wrappers: null });
      return;
    }
  }

  // [guards] a guarded ruleset emits its block only when the guard is true.
  return mapMaybe(ruleGuardPasses(rule, frame, e), (passes) => {
    if (!passes) {
      return;
    }
    if (nestedSource !== undefined) {
      return mapMaybe(transparentShells(rule, frame, e), shells => (shells !== null
        ? emitTransparentShells(
            shells,
            { parent: nestedSource, selector: rule.selector, frame },
            frame,
            e,
            imp
          )
        : writeNestedRule(
            rule,
            frame,
            e,
            imp,
            nestedSource,
            nestedHoist
          )));
    }

    /*
     * [extend/dynamic] With recording armed, an interpolated selector is resolved once,
     * structurally, and both the header and the recorder read that one resolution.
     */
    if (e.dynamicExtend !== null && rule.selector.selectors.some(selectorBranchHasInterp)) {
      return mapMaybe(resolvedSelectorList(rule.selector, frame, e), (resolved) => {
        const selector = resolved ?? rule.selector;
        const rawComposed =
          parent === null ? rootStrings(selector, frame, e) : compose(parent, selector, frame, e);
        return mapMaybe(rawComposed, rawComposed =>
          flattenResolved(rule, selector, resolved !== null, parent, ancestor, frame, e, imp, rawComposed, expandBubbledSelectorList));
      });
    }
    const rawComposed =
      parent === null ? rootStrings(rule.selector, frame, e) : compose(parent, rule.selector, frame, e);
    return mapMaybe(rawComposed, rawComposed =>
      flattenResolved(rule, rule.selector, false, parent, ancestor, frame, e, imp, rawComposed, expandBubbledSelectorList));
  });
}

/** Continue a flatten after its selector interpolation has resolved. Keeping this
 * separate preserves the static selector fast path: `mapMaybe` invokes it inline
 * when the selector has no async slot. `selector` is the rule's selector, or its
 * one resolution when extend recording is armed (`resolved`). */
function flattenResolved(
  rule: Ruleset,
  selector: SelectorList,
  resolved: boolean,
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

  /* `undefined`: the header itself, once resolved; `null`: the children join their parent list ({@link parentUnits}). */
  let childAncestor: string | null | undefined;

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
    childAncestor = childComposed === null ? '' : ancestorUnit(childComposed, e);
  } else if (selectorListHasAmpersand(selector)) {
    headerComposed = parent.length < 2 ? rawComposed : composeHeader(parent, selector, frame, e);

    /*
     * `headerComposed` can be pending only for an interpolated selector. The
     * raw composed list is already the correct parent context for children.
     */
    childAncestor = ancestorUnit(rawComposed, e);
  } else if (expandBubbledSelectorList) {
    headerComposed = rawComposed;
    childAncestor = ancestorUnit(rawComposed, e);
  } else {
    headerComposed = ancestor !== null
      ? opaqueJoin(ancestor, selector, frame, e)
      : combineAll(parentUnits(parent, e).map(unit => opaqueJoin(unit, selector, frame, e)), units => units.flat());

    /* The header itself, once resolved, as ONE unit: every branch of it is an
     * ancestor of the children (`.a { .b, .c { e {} } }` → `:is(.a .b, .a .c) e`). */
    childAncestor = undefined;
  }
  return mapMaybe(headerComposed, (headerComposed) => {
    const dyn = e.dynamicExtend;
    const ancestorOfChildren = childAncestor === undefined ? ancestorUnit(headerComposed, e) : childAncestor;
    if (dyn === null) {
      return flattenWithHeader(
        rule, parent, frame, e, imp, childComposed, headerComposed, ancestorOfChildren, expandBubbledSelectorList
      );
    }

    /* [extend/dynamic] The rule is open on the recorder's path while its body emits. */
    return withDynamicPlacement(
      dyn,
      openDynamicPath(dyn, rule, parent === null, headerComposed, false, resolved ? selector : undefined),
      dyn.scope,
      dyn.boundary,
      () => flattenWithHeader(
        rule, parent, frame, e, imp, childComposed, headerComposed, ancestorOfChildren, expandBubbledSelectorList
      )
    );
  });
}

/** Establish one ordinary visible ruleset activation for either writer. */
function activateRuleFrame(rule: Ruleset, frame: Frame, e: EvalCtx): Frame {
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
  (frame.rulePlacements ??= new Map()).set(rule, childFrame);
  return childFrame;
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
  childAncestor: string | null,
  expandBubbledSelectorList: boolean
): MaybePromise<void> {
  /*
   * [extend] the rule's HEADER uses its fully-extended composed branches;
   * children still compose against the RAW composed selector and extend
   * independently (the composed model needs no parent-child override). Absent an
   * extend override the header is byte-identical to the no-extend serializer.
   */
  const projection = extendProjection(e);

  /*
   * [extend/splice] The static plan (`flatByRule`) is keyed on the rule NODE at its
   * own placement, but a ruleset called as a mixin splices that same node under a
   * NEW call-site selector, so there the composed call-site header is authoritative.
   * `flatByRule` only holds extend-TARGET rules, so this is a no-op for every other rule.
   */
  const flat = projection?.flatByRule.get(rule);
  const hoist = e.hoistMode ? projection?.hoistHeader.get(rule) : undefined;

  /*
   * [extend/dynamic] A rule reached through a dynamic expansion (a placing body, a
   * mixin call — including a ruleset called as a mixin — or an import inside a ruleset)
   * records its extend facts here, at its call-site placement; its path is the open
   * rules it composed under, and no evaluation is re-driven. A static rule at its own
   * placement is already in the pre-walk plan (ledger X12). The frame-chain splice
   * check runs only for a static rule the plan touched or the walk records — any
   * other rule keeps the O(1) path.
   */
  const dyn = e.dynamicExtend;
  const isStatic = dyn === null || dyn.staticRules.has(rule);
  const viaCall = (flat !== undefined || hoist !== undefined || (dyn !== null && isStatic))
    && reachedViaMixinSplice(frame);
  const spliced = viaCall && (flat !== undefined || hoist !== undefined);
  const header0 = spliced
    ? headerComposed
    : e.hoistMode
      ? hoist ?? flat ?? headerComposed
      : flat ?? headerComposed;
  const recorded = dyn !== null && (!isStatic || viaCall);
  if (recorded) {
    recordOpenRule(dyn, rule, frame, e);
  }

  /*
   * [import:reference] drop the header branches that originate ONLY from hidden
   * `(reference)` rules; a rule left with no visible branch emits nothing (its body
   * still emits when the rule is pulled in as a mixin — a separate expansion path).
   * A hidden rule the deferred fold may still reveal emits a RESERVED block that the
   * fold rewrites or blanks: one the walk records here, or a planned one a recorded
   * extend may reach (#355).
   */
  let header = visibleHeader(rule, header0, frame, e);
  const reserved = header === null && e.referenceImportDepth > 0
    && (recorded || dyn?.revealRules?.has(rule) === true);
  if (reserved) {
    header = withoutPlaceholders(header0);
  }
  const referenceAncestor = header === null
    && (projection?.visibleReferenceRuleAncestors?.has(rule) === true
      || (dyn?.revealAncestors?.has(rule) === true && e.referenceImportDepth > 0));
  if (header === null && !referenceAncestor) {
    return;
  }
  const childFrame = activateRuleFrame(rule, frame, e);

  /*
   * [import:reference] A hidden parent selector can be structurally necessary
   * even though none of its own branches or leaves is visible: `.parent .target`
   * must compose before a visible `.target` extender can emit. Walk only the
   * constructs admitted by the typed extend preflight (rules, at-rules and
   * concrete `$for` placements); direct declarations and calls remain hidden.
   */
  if (referenceAncestor) {
    const executeReferenceAncestor = () => mapMaybe(
      activateBodyDependencies(rule.rules, childFrame, e),
      () => walkReferenceAncestorBody(
        rule.rules,
        childComposed,
        childComposed === null ? null : childAncestor,
        childFrame,
        e,
        imp,
        expandBubbledSelectorList
      )
    );
    return withSourceOwner(e, childFrame.sourceOwner, executeReferenceAncestor);
  }

  /* `header` is non-null below; the reference-ancestor lane returned above. */
  const visible = header!;
  const group: Leaf[] = [];
  const flush = (): MaybePromise<void> => {
    if (group.length || e.pendingLeafBlockCommentOwner === group) {
      const trailingBlockComments = takePendingLeafBlockComments(e, group);

      /*
       * [adjacent-merge] `parent` (the parent expansion this rule was composed
       * against) keys sibling merges: two nested rulesets with the same parent ref
       * and header merge; top-level rules (`parent === null`) never do.
       */
      return mapMaybe(flushBlock(
        visible, group, e, rule.selector, parent, trailingBlockComments
      ), () => {
        recordDynExtendSlot(e, rule, frame, visible, reserved);
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
  const emitBlock = (
    leaves: Leaf[],
    trailingBlockComments: readonly string[]
  ): MaybePromise<void> => {
    if (leaves.length || trailingBlockComments.length !== 0) {
      return mapMaybe(flushBlock(
        visible, leaves, e, rule.selector, parent, trailingBlockComments
      ), () => {
        recordDynExtendSlot(e, rule, frame, visible, reserved);
      });
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
      return flush();
    }
    queueLeadingGroup(group, partition, e);
    flushPending(partition);
    return runTrailing(0);
  };

  /*
   * [G28] The rule's comments are trivia in its body span, replayed by its own
   * walk: each lands before the leaf that follows it, and one after the last
   * statement trails the block. Every placement of the rule writes its own copy.
   */
  const executeBody = (): MaybePromise<void> => {
    const bodyTrivia = bodyTriviaReplay(rule, e);
    return mapMaybe(
      mapMaybe(
        activateBodyDependencies(rule.rules, childFrame, e),
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
          expandBubbledSelectorList,
          bodyTrivia
        )
      ),
      () => {
        queueBodyTriviaTail(bodyTrivia, group, partition, e);
        e.emittedBlockTrivia.closeCopy(bodyTrivia);
        return finish();
      }
    );
  };

  /*
   * A Ruleset can be rendered from an imported document before it is later called
   * as a ruleset-mixin. Its canonical body owns the imported document's source
   * identity in both placements, so nested `(inline)` imports resolve from that
   * document rather than the caller/root document, and its comments are read
   * from that document's trivia.
   */
  return withSourceOwner(e, childFrame.sourceOwner, executeBody);
}

/** [partition] Queue the direct leaves preceding a collapsed child as one parent block. */
function queueLeadingGroup(group: Leaf[], p: Partition, e: Emit): void {
  if (group.length || e.pendingLeafBlockCommentOwner === group) {
    const batch = group.splice(0, group.length);
    let trailingBlockComments = takePendingLeafBlockComments(e, group);
    const emit = (additionalBlockComments?: string[]): MaybePromise<void> => {
      if (additionalBlockComments !== undefined) {
        if (trailingBlockComments.length === 0) {
          trailingBlockComments = additionalBlockComments;
        } else {
          trailingBlockComments.push(...additionalBlockComments);
        }
        return;
      }
      return p.emitBlock(batch, trailingBlockComments);
    };
    p.lastLeadingGroup = batch;
    p.lastLeadingEmission = emit;
    p.trailing.push(emit);
  }
}

/** [partition] Move any buffered post-child leaf run into `trailing` as one block. */
function flushPending(p: Partition): void {
  if (p.pending.length) {
    const batch = p.pending;
    p.pending = [];
    p.trailing.push(() => p.emitBlock(batch, EMPTY_LEAF_BLOCK_COMMENTS));
  }
}

/** [partition] Buffer every ordinary leaf after an emitted collapsed child. */
function addLeaf(
  group: Leaf[],
  partition: Partition | null,
  leaf: Leaf,
  _forceLeading: boolean,
  e: Emit
): void {
  const pendingBlockComments = e.pendingLeafBlockCommentOwner === group
    ? e.pendingLeafBlockComments
    : null;
  if (pendingBlockComments !== null) {
    e.pendingLeafBlockComments = null;
    e.pendingLeafBlockCommentOwner = null;
    leaf.leadingBlockComments = pendingBlockComments;
  }
  if (partition && partition.encounteredContainer) {
    partition.pending.push(leaf);
  } else {
    group.push(leaf);
  }
}

/**
 * Sparse comment cursor over one body while it is walked. A comment between two
 * statements is queued, in source order, onto the leaf written next; a comment
 * inside a statement belongs to that statement's own writer.
 */
interface BodyTriviaReplay {
  readonly table: CommentTable;
  readonly end: number;
  index: number;

  /** The end of the last declaration walked: the run starting there is its inline comment. */
  declarationEnd: number | undefined;

  /** The states {@link EmittedTrivia.openCopy} saved, indexed from the body's first run. */
  readonly saved: SavedRuns | undefined;
}

/**
 * Open the comment replay for ONE written copy of a body — a rule at its place,
 * a mixin call, a detached ruleset call, a ruleset argument, a loop iteration:
 * its runs are freed for this copy, and {@link EmittedTrivia.closeCopy}
 * restores them once the body is walked.
 */
function bodyTriviaReplay(owner: object, e: Emit, span?: ReplaySpan): BodyTriviaReplay | undefined {
  const trivia = e.trivia;
  if (trivia === undefined) {
    return undefined;
  }
  const table = commentTableOf(trivia);
  if (table.runs.length === 0) {
    return undefined;
  }
  let start = span?.start ?? bodyStartOf(owner);
  let end: number;
  if (span !== undefined) {
    end = span.end;
  } else if (start === NO_SPAN) {
    const body = bodySpanForTriviaReplay(owner, e);
    if (body === undefined) {
      return undefined;
    }
    start = body.start;
    end = body.end;
  } else {
    end = bodyEndOf(owner);
  }
  const low = firstRunAtOrAfter(table, start);
  return low < table.runs.length && table.runStart[low]! < end
    ? { table, end, index: low, declarationEnd: undefined, saved: e.emittedBlockTrivia.openCopy(table, low, end) }
    : undefined;
}

/**
 * Take the body's comment runs from the cursor up to offset `end` that nothing
 * owns yet, as text. An exact declaration-tail run (at `inlineStart`) stays
 * leaf-owned, so it keeps its inline placement when the leaves are written.
 */
function takeBodyTrivia(
  replay: BodyTriviaReplay,
  end: number,
  inlineStart: number | undefined,
  e: Emit
): string[] | undefined {
  let comments: string[] | undefined;
  const table = replay.table;
  while (replay.index < table.runs.length) {
    const i = replay.index;
    if (table.runStart[i]! >= end || table.runStart[i]! >= replay.end) {
      break;
    }
    replay.index++;
    if (
      table.runStart[i] !== inlineStart
      && table.runEnd[i]! <= replay.end
      && !e.emittedBlockTrivia.hasIndex(table, i)
      && runHasBlockComment(table, i)
    ) {
      pushRunComments(table, i, comments ??= [], e);
    }
  }
  return comments;
}

function queueBodyTriviaBefore(
  replay: BodyTriviaReplay | undefined,
  before: Statement,
  group: Leaf[],
  e: Emit
): void {
  if (replay === undefined) {
    return;
  }
  const end = statementStartOf(before);
  if (end === undefined) {
    return;
  }
  const comments = takeBodyTrivia(replay, end, replay.declarationEnd, e);
  if (comments !== undefined) {
    queueLeafBlockComments(e, group, comments);
  }
}

/**
 * Queue the comments before `node` onto the next leaf, then step over the
 * comments `node` writes itself — an at-rule body walk's one replay step.
 */
function replayBodyTriviaBefore(replay: BodyTriviaReplay | undefined, node: Statement, group: Leaf[], e: Emit): void {
  queueBodyTriviaBefore(replay, node, group, e);
  if (node.type === 'Declaration' || ownsItsComments(node, true)) {
    skipBodyTrivia(replay, node, e);
  }
}

/**
 * Step the replay over one statement's own span. A comment inside a declaration
 * value, a nested rule, an at-rule, a call's arguments or a loop body belongs
 * to that statement's writer, never to the block the statement sits in.
 */
function skipBodyTrivia(replay: BodyTriviaReplay | undefined, statement: Statement, e: Emit): void {
  if (replay === undefined) {
    return;
  }
  const table = replay.table;
  const end = statementEndOf(statement);
  if (end === undefined) {
    /*
     * A custom property is unspanned (its value keeps its comments, and a span
     * would claim the run after it). The comments inside its value, and its
     * trailing edge, are the value's own (customPropertyValueWithTrivia):
     * claimed, not stepped over, so the comments before them stay in place for
     * the next statement.
     */
    const value = statement.type === 'Declaration' && !isValueSlotArray(statement.value) ? statement.value : undefined;
    const valueStart = value === undefined ? NO_SPAN : sourceStartOf(value);
    if (valueStart !== NO_SPAN) {
      const valueEnd = sourceEndOf(value!);
      for (let i = Math.max(replay.index, firstRunAtOrAfter(table, valueStart)); i < table.runs.length && table.runStart[i]! < valueEnd; i++) {
        if (table.runEnd[i]! <= valueEnd) {
          e.emittedBlockTrivia.addIndex(table, i);
        }
      }
      const trailing = customValueTrailingRun(table, valueEnd);
      if (trailing >= 0) {
        e.emittedBlockTrivia.addIndex(table, trailing);
      }
    }
    return;
  }
  while (replay.index < table.runs.length && table.runStart[replay.index]! < end) {
    replay.index++;
  }
  replay.declarationEnd = statement.type === 'Declaration' ? end : undefined;
}

/**
 * Whether a statement writes the comments inside its own span (see
 * {@link skipBodyTrivia}). A collapsed nested rule is decided where it is
 * placed: one merged into this block (`& { … }`) is walked with this body's
 * replay, so its comments land between the leaves around them.
 */
function ownsItsComments(node: Statement, nested: boolean): boolean {
  switch (node.type) {
    case 'Ruleset':
      return nested;
    case 'AtRuleBlock':
    case 'AtRuleStatement':
    case 'UnknownAtRuleBlock':
    case 'StyleImport':
    case 'ModuleImport':
    case 'MixinCall':
    case 'Apply':
    case 'Reference':
    case 'FunctionCall':
    case 'For':
      return true;
    default:
      return false;
  }
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
  const target = partition?.encounteredContainer === true && partition.lastLeadingGroup !== undefined
    ? partition.lastLeadingGroup
    : group;
  const comments = takeBodyTrivia(replay, replay.end, replay.declarationEnd, e);
  if (comments !== undefined) {
    if (target === partition?.lastLeadingGroup && partition.lastLeadingEmission !== undefined) {
      partition.lastLeadingEmission(comments);
    } else {
      queueLeafBlockComments(e, target, comments);
    }
  }
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
  emitBlock: (
    leaves: Leaf[],
    trailingBlockComments: readonly string[]
  ) => MaybePromise<void>;

  /** The direct run that immediately precedes the next collapsed child. */
  lastLeadingGroup?: Leaf[];

  /** Its queued writer; an argument transfers body-tail trivia before emission. */
  lastLeadingEmission?: (additionalBlockComments?: string[]) => MaybePromise<void>;
}

/*
 * [V19] The single source-order body evaluator. It dispatches every `Statement`
 * kind exactly once, resolving the lookup-dependent facts (property publication,
 * callable selection, control-flow, imports, trivia ownership) that must never
 * depend on the output setting, then hands each placement to the selected write
 * projection. `collapseNesting` selects the projection ONCE at the serialize
 * boundary and is threaded here as `nested`; no evaluator, lookup, expansion,
 * control-flow, or import path reads the setting again.
 *
 * The COLLAPSED projection (`nested === false`) owns selector composition,
 * parent-block partitioning, at-rule bubbling and flattened block layout via the
 * `composed`/`ancestor`/`group`/`flush`/`partition` state. The NESTED projection
 * (`nested === true`) owns authored selector headers, nesting indentation,
 * adjacent-block coalescing and the extend-driven hoist projection via the
 * `buf`/`sharedLeaves`/`source`/`placement`/`hoist` state. The two never both run
 * in one render.
 */
const MOOT_LEAVES: Leaf[] = [];
const MOOT_FLUSH = (): void => {};
const NOOP_BEFORE_STATEMENT = (_node: Statement): void => {};
const NOOP_TRAILING_TRIVIA = (): void => {};

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
  bodyTrivia?: BodyTriviaReplay,

  /*
   * [V19] Nested write-projection state. Present (with `nested === true`) only when
   * the serialize boundary selected `collapseNesting:false`. The collapsed
   * parameters above are moot when nested; the nested parameters below are moot
   * when collapsed.
   */
  nested = false,
  hoist?: HoistEntry[],
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer,
  owner?: object
): MaybePromise<void> {
  /*
   * buffer consecutive DIRECT leaves so a `+`/`+_` merge group can fold at
   * last-occurrence; flush when an interrupting nested rule/at-rule appears. Only
   * a nested projection buffers; the collapsed projection places into `group`.
   */
  const buf: Leaf[] = nested ? (sharedLeaves?.leaves ?? []) : MOOT_LEAVES;

  /*
   * [G28] A nested rule's own body: this walk owns its comment replay
   * ({@link bodyTriviaReplay}), queued before each statement like every other
   * body's. A shared or inline walk uses the replay it was handed.
   */
  const ownsReplay = nested && sharedLeaves === undefined && owner !== undefined && bodyTrivia === undefined;
  if (ownsReplay) {
    bodyTrivia = bodyTriviaReplay(owner, e);
  }
  let rootTriviaCursor: number | undefined;
  let inlineLeaves: NestedLeafBuffer | undefined;
  let flushBuf: () => void = MOOT_FLUSH;
  let emitBeforeRootStatement: (node: Statement) => void = NOOP_BEFORE_STATEMENT;
  let markAfterRootStatement: (node: Statement) => void = NOOP_BEFORE_STATEMENT;
  let emitTrailingRootTrivia: () => void = NOOP_TRAILING_TRIVIA;
  let placeLeaf: (leaf: Leaf) => void;
  if (nested) {
    flushBuf = sharedLeaves?.flush ?? (() => {
      if (buf.length === 0 && e.pendingLeafBlockCommentOwner !== buf) {
        return;
      }
      const trailingBlockComments = takePendingLeafBlockComments(e, buf);
      const mergeMode = mergeGroupMode(buf);
      if (mergeMode !== MERGE_NONE) {
        mergeFold(
          buf,
          e,
          blockIndent(e),
          emitNestedLeaf,
          mergeMode
        );
      } else {
        for (let index = 0; index < buf.length;) {
          const leaf = buf[index]!;
          const sourceOwner = leaf.frame.sourceOwner;
          if (
            sourceOwner !== null
            && sourceOwner !== undefined
            && e.context !== undefined
            && sourceOwner !== e.context.documentContext
          ) {
            let end = index + 1;
            while (end < buf.length && buf[end]!.frame.sourceOwner === sourceOwner) {
              end++;
            }
            const start = index;
            settledEmission(withSourceOwner(e, sourceOwner, () => {
              for (let at = start; at < end; at++) {
                emitNestedLeafOwned(buf[at]!, e);
              }
            }), leaf.node, e);
            index = end;
            continue;
          }
          emitNestedLeafOwned(leaf, e);
          index++;
        }
      }
      if (trailingBlockComments.length !== 0) {
        const indent = blockIndent(e);
        for (const comment of trailingBlockComments) {
          putBlockComment(e, indent, comment);
        }
      }
      buf.length = 0;
    });
    inlineLeaves = sharedLeaves ?? { leaves: buf, flush: flushBuf, propertyScope: frame };
    rootTriviaCursor = frame.parent === null && sharedLeaves === undefined ? 0 : undefined;

    /*
     * Every root statement of the document, not just this walk's: a document
     * split at its imports is walked in runs, and each run's replay starts at
     * the document's start.
     */
    const rootTriviaExclusions = rootTriviaCursor === undefined
      ? []
      : (frame.statements ?? statements).map((statement) => {
          const start = statementStartOf(statement);
          const end = statementEndOf(statement);
          return start === undefined || end === undefined ? undefined : { start, end };
        }).filter(isReplaySpan);
    emitBeforeRootStatement = (node: Statement): void => {
      if (rootTriviaCursor === undefined) {
        return;
      }
      emitBlockCommentTriviaBetween(e, rootTriviaCursor, statementStartOf(node), '', rootTriviaExclusions);
    };
    markAfterRootStatement = (node: Statement): void => {
      if (rootTriviaCursor === undefined) {
        return;
      }
      rootTriviaCursor = statementEndOf(node) ?? rootTriviaCursor;
    };
    emitTrailingRootTrivia = (): void => {
      if (rootTriviaCursor === undefined) {
        return;
      }
      emitTopLevelBlockCommentsBetween(e, rootTriviaCursor, Number.MAX_SAFE_INTEGER, '');
    };
    placeLeaf = (leaf: Leaf): void => {
      const pendingBlockComments = e.pendingLeafBlockCommentOwner === buf
        ? e.pendingLeafBlockComments
        : null;
      if (pendingBlockComments !== null) {
        e.pendingLeafBlockComments = null;
        e.pendingLeafBlockCommentOwner = null;
        leaf.leadingBlockComments = pendingBlockComments;
      }
      buf.push(leaf);
    };
  } else {
    placeLeaf = (leaf: Leaf): void => {
      addLeaf(group, partition, leaf, forceLeading, e);
    };
  }
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;
      if (node.type !== 'Declaration' && node.type !== 'Comment') {
        queueBodyTriviaBefore(bodyTrivia, node, nested ? buf : group, e);
        if (ownsItsComments(node, nested)) {
          skipBodyTrivia(bodyTrivia, node, e);
        }
      }

      /*
       * Root sibling grouping is source-adjacent only. Any non-Ruleset—including a
       * silent declaration/definition—forms a hard boundary. (Nested projection only.)
       */
      if (nested && frame.parent === null && node.type !== 'Ruleset') {
        e.lastBlock.parentKey = null;
      }
      switch (node.type) {
        case 'Declaration':
        case 'Comment': {
          /*
           * Lookup publication, nested-property expansion, and the monomorphic
           * placement shape are evaluator facts shared by both output projections.
           */
          if (nested) {
            if (e.referenceImportDepth > 0) {
              break;
            }
            evaluateLeafStatement(
              node,
              frame,
              sharedLeaves?.propertyScope ?? frame,
              e,
              imp,
              applyExpansion,
              bodyTrivia,
              buf,
              placeLeaf
            );
          } else {
            evaluateLeafStatement(
              node,
              frame,
              propertyScope,
              e,
              imp,
              applyExpansion,
              bodyTrivia,
              group,
              placeLeaf
            );
          }
          break;
        }
        case 'Ruleset': {
          if (nested) {
            if (e.referenceImportDepth > 0) {
              break;
            }
            flushBuf();
            emitBeforeRootStatement(node);

            /*
             * A rule a mixin's body places keeps its authored `&` header, as any
             * nested rule does: nested inside the caller, `&` already is the
             * caller (jess#345).
             */
            const emitted = expandRule(node, null, null, frame, e, imp, false, source, hoist);
            if (isThenable(emitted)) {
              return emitted.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
            markAfterRootStatement(node);
            break;
          }

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
                expandBubbledSelectorList,
                bodyTrivia
              );
            };
            const passes = ruleGuardPasses(rule, frame, e);
            const emitted = mapMaybe(passes, emitSelf);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
            break;
          }

          /*
           * [partition] Queue the leading parent block before this collapsed child.
           * Without a partition (top level / at-rule body) it flushes and emits
           * inline in source order.
           */
          if (partition) {
            queueLeadingGroup(group, partition, e);
            flushPending(partition);
            partition.encounteredContainer = true;
            skipBodyTrivia(bodyTrivia, rule, e);
            partition.trailing.push(() => expandRule(rule, rComposed, rAncestor, rFrame, e, imp, expandBubbledSelectorList));
          } else {
            skipBodyTrivia(bodyTrivia, rule, e);
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => mapMaybe(
                expandRule(rule, rComposed, rAncestor, rFrame, e, imp, expandBubbledSelectorList),
                () => run(index + 1)
              ));
            }
            const emitted = expandRule(rule, rComposed, rAncestor, rFrame, e, imp, expandBubbledSelectorList);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'MixinCall':
          if (nested) {
            const emitted = expandCall(
              node,
              null,
              null,
              frame,
              inlineLeaves!.leaves,
              inlineLeaves!.flush,
              null,
              e,
              imp,
              false,
              undefined,
              inlineLeaves!.propertyScope,
              applyExpansion,
              source,
              inlineLeaves!
            );
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          } else {
            const expanded = expandCall(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, undefined, propertyScope, applyExpansion);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'Apply':
          if (nested) {
            const emitted = expandApply(
              node,
              null,
              null,
              frame,
              inlineLeaves!.leaves,
              inlineLeaves!.flush,
              null,
              e,
              imp,
              false,
              inlineLeaves!.propertyScope,
              source,
              inlineLeaves!
            );
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          } else {
            const expanded = expandApply(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'Reference':
          if (nested) {
            const emitted = expandReferenceCall(
              node,
              null,
              null,
              frame,
              inlineLeaves!.leaves,
              inlineLeaves!.flush,
              null,
              e,
              imp,
              false,
              inlineLeaves!.propertyScope,
              applyExpansion,
              source,
              inlineLeaves!
            );
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          } else {
            const expanded = expandReferenceCall(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'For':
          if (nested) {
            const emitted = expandFor(
              node,
              null,
              null,
              frame,
              inlineLeaves!.leaves,
              inlineLeaves!.flush,
              null,
              e,
              imp,
              false,
              inlineLeaves!.propertyScope,
              applyExpansion,
              source,
              inlineLeaves!
            );
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          } else {
            const expanded = expandFor(node, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'If': {
          if (nested) {
            flushBuf();
            const body = selectIfBody(node, frame, e);
            if (body) {
              const emitted = nestedBody(body, frame, e, hoist, imp, source, undefined, applyExpansion, undefined, bodyTrivia);
              if (isThenable(emitted)) {
                return emitted.then(() => run(index + 1));
              }
            }
            break;
          }
          const body = selectIfBody(node, frame, e);
          if (body) {
            const emitted = walkBody(body, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion, expandBubbledSelectorList, bodyTrivia);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'While': {
          if (nested) {
            flushBuf();
            const emitted = runWhile(node, frame, e, rules => nestedBody(rules, frame, e, hoist, imp, source, undefined, applyExpansion, undefined, bodyTrivia));
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
            break;
          }
          const emitted = runWhile(node, frame, e, rules => walkBody(
            rules, composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion,
            expandBubbledSelectorList, bodyTrivia
          ));
          if (isThenable(emitted)) {
            return emitted.then(() => run(index + 1));
          }
          break;
        }
        case 'AtRuleBlock': {
          /*
           * [import:reference] A hidden `(reference)` at-rule in a body — a reserved
           * rule's, or a `(reference)` sheet's imported inside a ruleset — renders only
           * where an extend may reveal a rule in it: one the plan revealed, or any while
           * the walk records extends (a reserved container the deferred fold blanks
           * when nothing in it is revealed).
           */
          if (e.referenceImportDepth !== 0 && e.dynamicExtend === null && !referenceAtRuleShown(node, e)) {
            break;
          }
          if (nested) {
            flushBuf();
            emitBeforeRootStatement(node);
            const emitted = endRevealContainer(revealContainerStart(node, e), e, expandAtRuleBlock(node, frame, e, null, source, hoist));
            if (isThenable(emitted)) {
              return emitted.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
            markAfterRootStatement(node);
            break;
          }

          /*
           * [atrule-bubbling] an at-rule nested inside a ruleset body PROJECTS to this
           * block level (flat mode already emits everything at `e.depth`), carrying the
           * enclosing composed selector as its body context so a bubbleable at-rule
           * wraps the ruleset's selector inside. The decl group flushes first so the
           * at-rule sits after the ruleset's own block, matching Less's bubbling order.
           *
           * [atrule-nested] `@starting-style` / unknown at-rules stay INSIDE this
           * block (no bubble): buffer with the decl group so they emit in source
           * order within the parent ruleset. Everything else bubbles out — a bubbling
           * at-rule is a container, so (partitioned) it defers to `trailing` after the
           * leading block, matching the legacy flatten order.
           */
          if (staysNested(node.name)) {
            addLeaf(group, partition, evaluatedLeaf(node, frame), forceLeading, e);
            break;
          }
          const atNode = node;
          const atFrame = frame;
          const atComposed = composed;

          /*
           * [atrule-nest] A bubbleable at-rule projects to the level of its nearest
           * enclosing stay-open at-rule body: the selectors it bubbles THROUGH are
           * re-emitted inside it, so they add no output nesting, but each enclosing
           * `@media`/`@supports`/… body does. Its header indent is therefore the
           * enclosing at-rule-body count (`atRuleBodyDepth`) — 0 at the document root
           * (flush), 1 directly inside one `@media`, and so on — rather than the
           * ambient `e.depth`, which also counts the bubbled-through selector blocks.
           */
          const targetDepth = e.atRuleBodyDepth;
          const emitAt = (): MaybePromise<void> => {
            const reserved = revealContainerStart(atNode, e);
            if (targetDepth === e.depth) {
              return endRevealContainer(reserved, e, expandAtRuleBlock(atNode, atFrame, e, atComposed));
            }
            const savedDepth = e.depth;
            e.depth = targetDepth;
            const restore = (): void => {
              e.depth = savedDepth;
            };
            const r = endRevealContainer(reserved, e, expandAtRuleBlock(atNode, atFrame, e, atComposed));
            if (isThenable(r)) {
              return r.then(restore, (err) => {
                restore();
                throw err;
              });
            }
            restore();
            return r;
          };
          if (partition) {
            queueLeadingGroup(group, partition, e);
            flushPending(partition);
            partition.encounteredContainer = true;
            partition.trailing.push(emitAt);
          } else {
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => mapMaybe(
                emitAt(),
                () => run(index + 1)
              ));
            }
            const emitted = emitAt();
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'AtRuleStatement': {
          if (nested) {
            flushBuf();
            emitBeforeRootStatement(node);
            emitAtRuleStatement(node, frame, e);
            markAfterRootStatement(node);
            break;
          }

          /*
           * [diagnostic] An SCSS `@debug`/`@warn`/`@error` reports (or halts) and
           * emits no CSS. Guard here as well as in `emitAtRuleStatement`: the
           * flatten path would otherwise treat a diagnostic in a selector context
           * as a nested leaf (`staysNested` is true for these names) and never
           * reach that function. The marker (not the name) scopes this to SCSS.
           */
          if (isDiagnosticStatement(node)) {
            emitDiagnosticDirective(node, frame, e);
            break;
          }

          /*
           * A leaf only exists inside a SELECTOR context: the group it joins is
           * flushed as `<selector> { … }`. In a root-level control-flow body
           * (`@if true { @import "a.css"; }`) there is no selector, and flushing
           * the group would invent an anonymous ` { … }` wrapper around the
           * statement. Emit it at the current cursor instead — where a plain CSS
           * `@import` at root belongs.
           */
          if (staysNested(node.name) && composed !== null && composed.length > 0) {
            addLeaf(group, partition, evaluatedLeaf(node, frame), forceLeading, e);
            break;
          }
          const atNode = node;
          if (partition) {
            queueLeadingGroup(group, partition, e);
            flushPending(partition);
            partition.encounteredContainer = true;
            partition.trailing.push(() => emitAtRuleStatement(atNode, frame, e));
          } else {
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => {
                emitAtRuleStatement(node, frame, e);
                return run(index + 1);
              });
            }
            emitAtRuleStatement(node, frame, e);
          }
          break;
        }
        case 'Plugin':
          break;
        case 'StyleImport': {
          if (nested) {
            flushBuf();
            emitBeforeRootStatement(node);

            /*
             * A `(reference)` sheet takes the reference dispatcher, as at the document
             * root: the nested writer skips every hidden rule, so a rule an extend
             * reveals would never be written.
             */
            const imported = expandStyleImport(
              node,
              frame,
              e,
              e.importDocument,
              e.referenceImportDepth > 0 || importOptionWords(node.options).includes('reference')
                ? undefined
                : (document, importFrame) => nestedBody(document.rules, importFrame, e, hoist, imp, source)
            );
            if (isThenable(imported)) {
              return imported.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
            markAfterRootStatement(node);
            break;
          }

          /*
           * [inline-import] `@import (inline)` INSIDE a rule body belongs in that
           * rule's block (`div { …raw… }`), not flushed and spliced at document
           * root. Buffer it as an ordinary leaf; `emitLeafOwned` emits its raw bytes
           * inside the block, reserving an async-patch chunk for the (async) read.
           */
          if (composed !== null && partition !== null && e.referenceImportDepth === 0
            && importHasOption(importRequestOptions(node.options), 'inline')) {
            addLeaf(group, partition, evaluatedLeaf(node, frame), forceLeading, e);
            break;
          }

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
             *
             * A loaded sheet runs as this rule's body, exactly as if it were written
             * here (ledger A2: `@import` is a source fold; N10: imported bodies are
             * lexical splices at the import position): its rules nest under this
             * rule's selector (`.wrap { @import "t.less"; }` emits `.wrap .sm`,
             * jess#358), inside a `(reference)` sheet too, where this rule hides them.
             * An import that is itself `(reference)` keeps the reference dispatcher,
             * which hides the sheet's own declarations as well.
             */
            const emitLoaded = composed === null
              ? undefined
              : importOptionWords(node.options).includes('reference')

                /*
                 * A `(reference)` sheet runs as this rule's body too, so its rules nest
                 * under it, hidden unless an extend reveals them; its own declarations
                 * stay hidden in a leaf group nothing writes.
                 */
                ? (document: Stylesheet, importFrame: Frame) => walkBody(
                    document.rules, composed, ancestor, importFrame, [],
                    MOOT_FLUSH, null, e, imp, forceLeading, propertyScope
                  )
                : (document: Stylesheet, importFrame: Frame) => walkBody(
                    document.rules, composed, ancestor, importFrame, group,
                    flush, partition, e, imp, forceLeading, propertyScope
                  );
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => mapMaybe(
                expandStyleImport(node, frame, e, e.importDocument, emitLoaded),
                () => run(index + 1)
              ));
            }
            const imported = expandStyleImport(node, frame, e, e.importDocument, emitLoaded);
            if (isThenable(imported)) {
              return imported.then(() => run(index + 1));
            }
          } else if (partition !== null && composed !== null) {
            addLeaf(group, partition, evaluatedLeaf(node, frame), forceLeading, e);
          } else {
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => mapMaybe(
                expandStyleImport(node, frame, e, e.importDocument),
                () => run(index + 1)
              ));
            }

            /*
             * `(inline)` is intentionally not a document parse, but it is still
             * asynchronous Context IO. Keep this body cursor alive so a deferred
             * callable's document scope survives the raw-byte read.
             */
            const imported = expandStyleImport(node, frame, e, e.importDocument);
            if (isThenable(imported)) {
              return imported.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'ModuleImport': {
          if (nested) {
            flushBuf();
            emitBeforeRootStatement(node);
            emitModuleImport(node, frame, e);
            markAfterRootStatement(node);
            break;
          }
          const importNode = node;
          if (partition) {
            queueLeadingGroup(group, partition, e);
            flushPending(partition);
            partition.encounteredContainer = true;
            partition.trailing.push(() => emitModuleImport(importNode, frame, e));
          } else {
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => {
                emitModuleImport(node, frame, e);
                return run(index + 1);
              });
            }
            emitModuleImport(node, frame, e);
          }
          break;
        }
        case 'UnknownAtRuleBlock': {
          if (nested) {
            flushBuf();
            emitBeforeRootStatement(node);
            emitUnknownAtRuleBlock(node, e);
            markAfterRootStatement(node);
            break;
          }
          const opaqueNode = node;
          if (partition) {
            queueLeadingGroup(group, partition, e);
            flushPending(partition);
            partition.encounteredContainer = true;
            partition.trailing.push(() => emitUnknownAtRuleBlock(opaqueNode, e));
          } else {
            const flushed = flush();
            if (isThenable(flushed)) {
              return flushed.then(() => {
                emitUnknownAtRuleBlock(node, e);
                return run(index + 1);
              });
            }
            emitUnknownAtRuleBlock(node, e);
          }
          break;
        }
        case 'FunctionCall': {
          // a bare value-position call statement (`e('/* … */');`): evaluate + emit.
          if (nested) {
            flushBuf();
            emitBeforeRootStatement(node);
            const emitted = emitCallStatement(node, frame, e);
            if (isThenable(emitted)) {
              return emitted.then(() => {
                markAfterRootStatement(node);
                return run(index + 1);
              });
            }
            markAfterRootStatement(node);
            break;
          }
          const placed = placeStatementCall(node, frame, e, placeLeaf);
          if (isThenable(placed)) {
            return placed.then(() => run(index + 1));
          }
          break;
        }
        case 'MixinDefinition':
        case 'VariableDeclaration':
          evaluateSilentStatement(node, frame, e);
          break;
      }
    }
    if (nested) {
      if (ownsReplay) {
        queueBodyTriviaTail(bodyTrivia, buf, null, e);
      }
      if (!sharedLeaves) {
        flushBuf();
        emitTrailingRootTrivia();
      }
      if (ownsReplay) {
        e.emittedBlockTrivia.closeCopy(bodyTrivia);
      }
    }
  };
  return run(0);
}

/**
 * [V19] Nested write-projection entry to the one body evaluator {@link walkBody}.
 * A pure calling-convention adapter (no statement dispatch of its own): it maps
 * the nested-projection argument shape to `walkBody`'s unified signature so the
 * nested writers and the serialize boundary invoke the single evaluator.
 */
function nestedBody(
  statements: Statement[],
  frame: Frame,
  e: Emit,
  hoist?: HoistEntry[],
  imp = false, // [important] call-level `!important` forced onto this body's decls
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer,
  applyExpansion = false,
  owner?: object,
  bodyTrivia?: BodyTriviaReplay
): MaybePromise<void> {
  return walkBody(
    statements, null, null, frame, MOOT_LEAVES, MOOT_FLUSH, null, e, imp, false, frame,
    applyExpansion, false, bodyTrivia, true, hoist, source, sharedLeaves, owner
  );
}

/**
 * [import:reference] Traverse a hidden selector container solely as typed
 * structure for a visible descendant. This deliberately mirrors the extend
 * preflight's admission surface: Ruleset, AtRuleBlock and concrete For
 * placements, plus the silent declarations needed to resolve their selectors
 * and values. Everything that could emit the hidden container's own bytes is
 * skipped.
 */
function walkReferenceAncestorBody(
  statements: readonly Statement[],
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  imp: boolean,
  expandBubbledSelectorList: boolean
): MaybePromise<void> {
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;
      let emitted: MaybePromise<void>;
      switch (node.type) {
        case 'Ruleset':
          emitted = expandRule(node, composed, ancestor, frame, e, imp, expandBubbledSelectorList);
          break;
        case 'AtRuleBlock':
          emitted = referenceAtRuleShown(node, e)
            ? endRevealContainer(revealContainerStart(node, e), e, expandAtRuleBlock(node, frame, e, composed))
            : undefined;
          break;
        case 'For':
          emitted = expandReferenceAncestorFor(
            node,
            composed,
            ancestor,
            frame,
            e,
            imp,
            expandBubbledSelectorList
          );
          break;
        case 'MixinDefinition':
          publishSelectedMixinDefinition(frame, node);
          markSilentStatementBlockCommentTrivia(node, e);
          emitted = undefined;
          break;
        case 'VariableDeclaration':
          activateVariableDeclaration(node, frame, e);
          markSilentStatementBlockCommentTrivia(node, e);
          emitted = undefined;
          break;
        default:
          emitted = undefined;
          break;
      }
      if (isThenable(emitted)) {
        return emitted.then(() => run(index + 1));
      }
    }
  };
  return run(0);
}

/** Concrete `$for` placements for the cold reference-ancestor traversal. */
function expandReferenceAncestorFor(
  node: For,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  imp: boolean,
  expandBubbledSelectorList: boolean
): MaybePromise<void> {
  return mapMaybe(forItems(node.iterable, frame, e), (items) => {
    const run = (start: number): MaybePromise<void> => {
      const collectionEntries = Array.isArray(items)
        ? null
        : items instanceof CollectionOverlay
          ? items.items
          : 'evaluatedItems' in items
            ? null
            : items.entries;
      const plainItems = Array.isArray(items) ? items : null;
      const evaluatedItems = !Array.isArray(items) && 'evaluatedItems' in items
        ? items.evaluatedItems
        : null;
      const length = collectionEntries?.length ?? plainItems?.length ?? evaluatedItems!.length;
      for (let index = start; index < length; index++) {
        const collectionEntry = collectionEntries?.[index];
        const item = collectionEntry === undefined ? plainItems?.[index] ?? null : null;
        const evaluatedItem = collectionEntry === undefined ? evaluatedItems?.[index] ?? null : null;
        const bindingIndex = dimension(index + 1);
        const destructured = node.binding.kind !== 'tuple'
          ? null
          : collectionEntry !== undefined
            ? groupItems(collectionEntry.value)
            : evaluatedItem !== null
              ? groupItems(evaluatedItem)
              : null;
        const bindings = collectionEntry === undefined && evaluatedItem === null
          ? bindForEntry(node, item!.value, item!.key, bindingIndex, destructured)
          : collectionEntry === undefined
            ? bindForEntry(node, EVALUATED_BINDING, null, bindingIndex, destructured)
            : bindForEntry(
                node,
                EVALUATED_BINDING,
                EVALUATED_BINDING,
                bindingIndex,
                destructured
              );
        const bindingValueFrames = item === null
          ? undefined
          : bindingValuesForItem(bindings, item, item.valueFrame);
        const cells = cellsForParams(
          bindings,
          bindingValueFrames,
          undefined,
          collectionEntry === undefined && evaluatedItem === null ? undefined : node.binding,
          collectionEntry,
          destructured,
          evaluatedItem
        );
        const loopFrame: Frame = {
          parent: frame,
          mixins: collectMixins(node.rules),
          declIndex: collectDeclIndex(node.rules, bindings, cells),
          cells,
          reassign: null,
          statements: node.rules,
          sourceOwner: frame.sourceOwner ?? null,
          extendPlacement: e.dynamicExtend === null ? undefined : {},
          bindingValueFrames
        };
        if (item !== null) {
          bindForDetached(loopFrame, bindings, item);
        }
        const emitted = mapMaybe(
          activateBodyDependencies(node.rules, loopFrame, e),
          () => walkReferenceAncestorBody(
            node.rules,
            composed,
            ancestor,
            loopFrame,
            e,
            imp,
            expandBubbledSelectorList
          )
        );
        if (isThenable(emitted)) {
          return emitted.then(() => run(index + 1));
        }
      }
    };
    return run(0);
  });
}

/** Enter one at-rule body level around a structural reference-only loop. */
function expandNestedReferenceAncestorFor(
  node: For,
  composed: string[] | null,
  ancestor: string | null,
  frame: Frame,
  e: Emit,
  expandBubbledSelectorList: boolean
): MaybePromise<void> {
  e.depth++;
  let emitted: MaybePromise<void>;
  try {
    emitted = expandReferenceAncestorFor(
      node,
      composed,
      ancestor,
      frame,
      e,
      false,
      expandBubbledSelectorList
    );
  } catch (error) {
    e.depth--;
    throw error;
  }
  if (isThenable(emitted)) {
    return emitted.then(() => {
      e.depth--;
    }, (error) => {
      e.depth--;
      throw error;
    });
  }
  e.depth--;
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
  applyExpansion = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer
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
    const bindingsTrackedAtDispatch = e.pluginHost?.invokeRawFunction !== undefined
      && (e.scopedFunctionNames?.size ?? 0) > 0;
    const runDispatch = (): MaybePromise<void> => mapMaybe(dispatch(candidates, call, frame, e, homes, true), (selected) => {
      queueCommentOnlySelectedBodies(selected, e, group);
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
      const run = (start: number): MaybePromise<void> => {
        for (let index = start; index < selected.length; index++) {
          const { def, bindings, boundSourceKeys } = selected[index]!;

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
            declIndex: collectDeclIndex(def.rules, bindings), cells: cellsForParams(bindings, undefined, frame), reassign: null,
            statements: def.rules,
            sourceOwner: sourceOwnerForBody(def.rules, frame, e),
            mixinUrlBindings: undefined,
            mixinValueBindings: undefined,
            mixinSplice: true,

            /*
             * [extend/dynamic] Each call places its body's rules apart (see
             * Frame.extendPlacement). Every field is declared, so every call frame
             * keeps one shape.
             */
            extendPlacement: e.dynamicExtend === null ? undefined : {},
            fallback: namespaced || homeFrame === frame ? undefined : frame,
            callerFallback: namespaced || homeFrame === frame ? undefined : true
          };
          takeMixinValueBindings(boundSourceKeys, e, callFrame);
          captureArgDefFrames(bindings, frame, callFrame);
          if (e.dynamicExtend !== null && def.extendInstructions !== undefined) {
            recordBodyExtends(e.dynamicExtend, def.extendInstructions, e);
          }

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
          let bodyTrivia: BodyTriviaReplay | undefined;
          const executeBody = () => {
            bodyTrivia = def.rules.length === 0 ? undefined : bodyTriviaReplay(def, e);
            const pluginVersion = e.fnScopeVersion ?? 0;
            return mapMaybe(
              activateBodyDependencies(def.rules, callFrame, e),
              () => {
                if (!bindingsTrackedAtDispatch && (e.fnScopeVersion ?? 0) !== pluginVersion && bindings !== null) {
                  capturePreparedBodyPluginBindings(def, call, bindings, frame, homeFrame, e);
                }
                if (sharedLeaves !== undefined) {
                  return nestedBody(
                    def.rules,
                    callFrame,
                    e,
                    undefined,
                    bodyImp,
                    source,
                    sharedLeaves,
                    applyExpansion,
                    undefined,
                    bodyTrivia
                  );
                }
                return walkBody(
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
                );
              }
            );
          };
          const emitted = withSourceOwner(e, callFrame.sourceOwner, executeBody);
          if (isThenable(emitted)) {
            return emitted.then(() => {
              queueBodyTriviaTail(bodyTrivia, sharedLeaves?.leaves ?? group, sharedLeaves === undefined ? partition : null, e);
              e.emittedBlockTrivia.closeCopy(bodyTrivia);
              leakBodyVars(frame, def.rules, callFrame, e);
              publishOrderedMixins(frame, frameOrderedMixins(callFrame, e), callFrame);
              if (def.ruleMixin !== true) {
                publishExplicitRulesets(frame, def.rules, callFrame);
              }
              return run(index + 1);
            });
          }
          queueBodyTriviaTail(bodyTrivia, sharedLeaves?.leaves ?? group, sharedLeaves === undefined ? partition : null, e);
          e.emittedBlockTrivia.closeCopy(bodyTrivia);

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
        }
      };
      try {
        const expanded = run(0);
        if (isThenable(expanded)) {
          return expanded.then(
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
        return expanded;
      } catch (error) {
        e.mixinDepth--;
        throw error;
      }
    });
    return runDispatch();
  });
}

function queueCommentOnlySelectedBodies(
  selected: readonly Selection[],
  e: Emit,
  group: Leaf[]
): void {
  for (const { def } of selected) {
    if (def.guard !== undefined || def.rules.length !== 0) {
      continue;
    }
    const owner = e.context?.sourceOwnerForBody?.(def.rules) ?? null;
    if (owner !== null && owner !== e.context?.documentContext) {
      settledEmission(withSourceOwner(e, owner, () => {
        const comments = bodyBlockCommentTexts(def, e);
        if (comments.length !== 0) {
          queueLeafBlockComments(e, group, comments);
        }
      }), def, e);
    } else {
      const comments = bodyBlockCommentTexts(def, e);
      if (comments.length !== 0) {
        queueLeafBlockComments(e, group, comments);
      }
    }
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
  flush: () => MaybePromise<void>,
  partition: Partition | null,
  e: Emit,
  imp = false,
  forceLeading = false,
  propertyScope: Frame = frame,
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

        /*
         * [extend/dynamic] Like a ruleset called as a mixin, an applied body splices the
         * ruleset's own nested rules: each application is its own placement, written at
         * the composed apply-site selector (Frame.mixinSplice, Frame.extendPlacement).
         */
        mixinSplice: true,
        extendPlacement: e.dynamicExtend === null ? undefined : {},
        ...(home === frame ? {} : { fallback: frame, callerFallback: true })
      };
      const emitted = withSourceOwner(e, applyFrame.sourceOwner, () => mapMaybe(
        activateBodyDependencies(rule.rules, applyFrame, e),
        () => sharedLeaves === undefined
          ? walkBody(
              rule.rules,
              composed,
              ancestor,
              applyFrame,
              group,
              flush,
              partition,
              e,
              imp,
              forceLeading,
              propertyScope,
              true
            )
          : nestedBody(
              rule.rules,
              applyFrame,
              e,
              undefined,
              imp,
              source,
              sharedLeaves,
              true
            )
      ));
      if (isThenable(emitted)) {
        return emitted.then(() => run(index + 1));
      }
    }
  };
  return mapMaybe(gather, () => run(0));
}

/**
 * Dispatch in a position that cannot suspend. Namespace-path descent dispatches
 * an intermediate namespace's implicit zero-argument call while it builds a
 * scope index, from a caller that would have to be restructured, so an
 * awaitable dispatch is reported rather than guessed at.
 *
 * TODO(maybe-promise-sync-islands): fold this onto the awaitable lane.
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

/** Move selected typed snapshots onto the activation that owns their bindings. */
function takeMixinValueBindings(
  keys: readonly CallValue[] | null,
  e: EvalCtx,
  frame: Frame
): void {
  if (keys === null) {
    return;
  }
  for (const key of keys) {
    const url = e.mixinUrlBindings?.get(key);
    if (url !== undefined) {
      (frame.mixinUrlBindings ??= new Map()).set(key, url);
      e.mixinUrlBindings!.delete(key);
    }
    const value = e.mixinValueBindings?.get(key);
    if (value !== undefined) {
      (frame.mixinValueBindings ??= new Map()).set(key, value);
      e.mixinValueBindings!.delete(key);
    }
  }
  if (e.mixinUrlBindings?.size === 0) {
    e.mixinUrlBindings = null;
  }
  if (e.mixinValueBindings?.size === 0) {
    e.mixinValueBindings = null;
  }
}

/** Release provenance selected by a dispatch probe that executes no activation. */
function discardSelectedBoundSources(keys: readonly CallValue[] | null, e: EvalCtx): void {
  if (keys === null) {
    return;
  }
  for (const key of keys) {
    e.pluginRawBindings?.delete(key);
    e.mixinUrlBindings?.delete(key);
    e.mixinValueBindings?.delete(key);
  }
  if (e.mixinUrlBindings?.size === 0) {
    e.mixinUrlBindings = null;
  }
  if (e.mixinValueBindings?.size === 0) {
    e.mixinValueBindings = null;
  }
}

/** Delete typed default facts belonging to candidates that dispatch did not select. */
function cleanupDefaultMixinValues(
  byBindings: Map<Map<string, CallValue>, Binding[]> | null,
  e: EvalCtx
): void {
  if (byBindings === null) {
    return;
  }
  for (const keys of byBindings.values()) {
    discardSelectedBoundSources(keys, e);
  }
}

/** Attach selected typed-default keys to the Selection that owns their activation. */
function finishDefaultMixinValues(
  selected: Selection[],
  byBindings: Map<Map<string, CallValue>, Binding[]> | null,
  e: EvalCtx
): Selection[] {
  if (byBindings === null) {
    return selected;
  }
  for (let index = 0; index < selected.length; index++) {
    const selection = selected[index]!;
    const keys = selection.bindings === null ? undefined : byBindings.get(selection.bindings);
    if (keys === undefined) {
      continue;
    }
    byBindings.delete(selection.bindings!);
    selection.boundSourceKeys = selection.boundSourceKeys === null
      ? keys
      : [...selection.boundSourceKeys, ...keys];
  }
  cleanupDefaultMixinValues(byBindings, e);
  return selected;
}

/** Closure-bearing args capture their literal home frame in render-local state. */
function captureArgDefFrames(bindings: Map<string, Binding> | null, callerFrame: Frame, callFrame: Frame): void {
  if (!bindings) {
    return;
  }
  for (const v of bindings.values()) {
    if (isValueSlotArray(v)) {
      continue;
    }
    if (isValueBlock(v)) {
      bindDetached(callFrame, v, callerFrame, callerFrame.sourceOwner ?? null);
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
      const b = eagerSnapshot(v, callFrame, e);
      if (isThenable(b)) {
        observeRejectedThenable(b);
        continue;
      }
      snap = b;
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
        statements: statement.rules,

        /* The rule sits in the called body, so it is that body's document's source. */
        sourceOwner: callFrame.sourceOwner
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
      const hit = lookupVarIn(cursor, literalName(cur), e);
      cur = hit?.value;
      cursor = hit?.frame ?? cursor;
      continue;
    }
    if (cur.type === 'Reference') {
      if (moduleReferenceCall(cur, cursor, e) !== undefined) {
        return undefined;
      }
      const resolved = resolveReferenceResult(cur, cursor, e);
      cur = resolved?.value;
      cursor = resolved?.frame ?? cursor;
      continue;
    }
    if (cur.type === 'IfValue') {
      if (unloweredCall(cur) !== null) {
        return undefined;
      }
      cur = pickIfBranch(cur, cursor, e);
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** An anonymous mixin is callable, not a CSS declaration value. Jess collection
 * data is a real value and SCSS nested-property blocks are flattened
 * elsewhere, so only value-block resolution is rejected here. */
function assertDeclarationValueIsNotRuleset(node: Declaration, frame: Frame | null, e: EvalCtx): void {
  if (!isValueSlotArray(node.value) && (node.value.type === 'Collection' || node.value.type === 'NestedPropertyBlock')) {
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
  sourceOwner: object | null = null,
  bindings: Map<string, CallValue> | null = null,
  extendPlacement: object | undefined = undefined
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

    // A `using (…)` content block seeds its params here (`@content(args)`).
    declIndex: collectDeclIndex(body, bindings), cells: cellsForParams(bindings), reassign: null,
    fallback: frame, // caller scope is the fallback
    callerFallback: true, // [R16] but invisible to plain variable reads by default
    statements: body,
    sourceOwner,

    /* [extend/dynamic] each call places its body's rules apart (Frame.extendPlacement) */
    extendPlacement
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
  imp = false,
  forceLeading = false, // [partition] inherited leading-hoist context
  propertyScope: Frame = frame,
  applyExpansion = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer
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
  const resolved = resolveReferenceResult(call, frame, e, true);
  if (!resolved) {
    /*
     * [content] `@content` / `$content()` with no block bound to THIS mixin's own
     * activation splices EMPTY (dart-sass): the block binds only when the mixin was
     * `@include`d with one (`mixin-dispatch.ts` — `bound.set('content', …)` on its
     * own frame), so an unresolved `content` means "no block here", not an error and
     * not a cross-frame read. Every OTHER unresolved reference is still a hard miss.
     */
    if (call.base.type === 'Lookup' && call.base.kind === 'var' && call.base.name !== 'content') {
      unresolvedSymbol(call, `@${call.base.name}`, e);
    }
    return;
  }
  if (isMixinCallValue(resolved.value)) {
    const home = resolved.frame ?? frame;
    return expandCall(
      resolved.value,
      composed,
      ancestor,
      home,
      group,
      flush,
      partition,
      e,
      imp,
      forceLeading,
      undefined,
      propertyScope,
      applyExpansion,
      source,
      sharedLeaves
    );
  }
  const dr = resolveValueBlock(resolved.value, resolved.frame, e);
  if (!dr) {
    throw ERR.typeMismatch({
      node: call,
      ...callSiteLocation(call, e),
      meta: {
        callee: call.raw,
        expected: 'detached ruleset or mixin call',
        got: isValueSlotArray(resolved.value) ? 'a value list' : resolved.value.type
      }
    });
  }

  /*
   * A detached ruleset passed as a mixin argument closes over the caller frame
   * captured at argument binding time. `resolved.frame` owns the parameter cell,
   * not the detached body; using it here lets a same-named mixin local shadow the
   * argument's free variables. A direct declaration has the same lexical frame
   * either way, so consult the render-local closure fact when it exists.
   */
  const binding = detachedBinding(resolved.frame ?? frame, dr);
  const definitionFrame = binding?.lexicalFrame ?? resolved.frame;
  const splice = (bindings: Map<string, CallValue> | null): MaybePromise<void> => {
    const r = referenceCallFrame(
      dr,
      frame,
      definitionFrame,
      binding?.sourceOwner ?? resolved.sourceOwner,
      bindings,
      e.dynamicExtend === null ? undefined : {}
    );
    const drBody = valueBlockBody(r.dr);
    if (e.dynamicExtend !== null && r.dr.type === 'AnonymousMixin' && r.dr.extendInstructions !== undefined) {
      recordBodyExtends(e.dynamicExtend, r.dr.extendInstructions, e);
    }

    /*
     * The block's comments are trivia inside its body span, replayed exactly as
     * a mixin body's are: its declaration HOLDS them, and each call writes its
     * own copy. The replay is opened under the block's own source owner, so a
     * block bound in an imported document reads that document's trivia.
     */
    const executeBody = () => {
      const bodyTrivia = drBody.length === 0 ? undefined : bodyTriviaReplay(r.dr, e);
      const walked = mapMaybe(
        activateBodyDependencies(drBody, r.callFrame, e),
        () => sharedLeaves === undefined
          ? walkBody(
              drBody,
              composed,
              ancestor,
              r.callFrame,
              group,
              flush,
              partition,
              e,
              imp,
              forceLeading,
              propertyScope,
              applyExpansion,
              false,
              bodyTrivia
            )
          : nestedBody(
              drBody,
              r.callFrame,
              e,
              undefined,
              imp,
              source,
              sharedLeaves,
              applyExpansion,
              undefined,
              bodyTrivia
            )
      );
      if (bodyTrivia === undefined) {
        return walked;
      }
      return mapMaybe(walked, () => {
        queueBodyTriviaTail(bodyTrivia, sharedLeaves?.leaves ?? group, sharedLeaves === undefined ? partition : null, e);
        e.emittedBlockTrivia.closeCopy(bodyTrivia);
      });
    };
    return withSourceOwner(e, r.callFrame.sourceOwner, executeBody);
  };

  /*
   * `@content(args)` (Sass) / `$block(args)` — a `using (…)` content block spliced
   * with its args bound to those params. Args resolve in the CALLER frame; param
   * defaults resolve in the block's DEFINITION frame — the same `bindArgs` contract
   * a mixin call and a value lambda use. A bare `@content` (no args) splices with
   * no extra bindings.
   */
  if (step.args.length === 0) {
    return splice(null);
  }
  return mapMaybe(bindContentArgs(dr, step.args, frame, definitionFrame, e), (bindings) => {
    if (bindings === null) {
      throw ERR.arity({
        node: dr,
        meta: { callee: 'content', expectedCount: dr.params?.length ?? 0, gotCount: step.args.length }
      });
    }
    return splice(bindings);
  });
}

/** Bind a `@content(args)` call's args to a content block's `using (…)` params
 *  (see {@link expandReferenceCall}). Same `bindArgs` contract as a value lambda:
 *  args resolve in the caller frame, defaults in the block's definition frame. */
function bindContentArgs(
  block: ValueBlock,
  args: CallArg[],
  callerFrame: Frame,
  defFrame: Frame | null,
  e: EvalCtx
): MaybePromise<Map<string, CallValue> | null> {
  const syntheticDef: MixinDefinition = {
    type: 'MixinDefinition', name: '', params: block.params ?? [], rules: valueBlockBody(block), extendInstructions: undefined,
    _s: NO_SPAN, _e: NO_SPAN, _bs: NO_SPAN, _be: NO_SPAN
  };
  const call: MixinCall = { type: 'MixinCall', name: '', args, path: [], important: false, content: null, _s: NO_SPAN, _e: NO_SPAN };
  const resolveCaller = makeResolver(callerFrame, e);
  const resolveDefault: DefaultResolver = (v, boundSoFar) => {
    const overlay: Frame = { parent: defFrame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    return eagerSnapshot(v, overlay, e);
  };
  const prepared = substituteClosureVarArgs(call, callerFrame, e, false);
  return bindArgs(syntheticDef, prepared, resolveCaller, resolveDefault, eagerSources(callerFrame, e));
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

interface EvaluatedForItems {
  readonly evaluatedItems: readonly ValueGroup[];
}

type ForItems = ForItem[] | EvaluatedForItems | CollectionOverlay<ValueCollectionEntry> | ValueCollection;

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
    const bound = lookupVar(frame, literalName(node), e);
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
    if ((bound.type === 'Lookup' && bound.kind === 'var')
      || bound.type === 'Reference' || bound.type === 'Block') {
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
): { node: ValueSlot; frame: Frame | null; evaluated: ValueGroup | null } {
  let cur = node;
  let f = frame;
  for (;;) {
    if (isValueSlotArray(cur)) {
      return { node: cur, frame: f, evaluated: null };
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
        return { node: cur, frame: f, evaluated: null };
      }
      if (hit.evaluated !== null) {
        return { node: hit.value, frame: hit.frame, evaluated: hit.evaluated };
      }
      cur = hit.value;
      f = hit.frame;
      continue;
    }
    return { node: cur, frame: f, evaluated: null };
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
  const outerPendingBlockCommentOwner = e.pendingLeafBlockCommentOwner;
  const outerPendingBlockComments = e.pendingLeafBlockComments;
  e.pendingLeafBlockCommentOwner = null;
  e.pendingLeafBlockComments = null;
  const finish = (): ForItem[] => {
    e.pendingLeafBlockCommentOwner = outerPendingBlockCommentOwner;
    e.pendingLeafBlockComments = outerPendingBlockComments;
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
  };
  try {
    const expanded = expandCall(call, null, null, frame, collected, noop, discard, e, false, true);
    if (isThenable(expanded)) {
      return expanded.then(finish, (error) => {
        e.pendingLeafBlockCommentOwner = outerPendingBlockCommentOwner;
        e.pendingLeafBlockComments = outerPendingBlockComments;
        throw error;
      });
    }
    return finish();
  } catch (error) {
    e.pendingLeafBlockCommentOwner = outerPendingBlockCommentOwner;
    e.pendingLeafBlockComments = outerPendingBlockComments;
    throw error;
  }
}

function forItemsFromCollection(
  node: Collection,
  frame: Frame | null,
  e: Emit
): MaybePromise<CollectionOverlay<ValueCollectionEntry>> {
  return evalCollectionEntries(node, frame, e, true);
}

/** The ordered items an `each()` iterable expands to. */
function forItems(node: ValueSlot | MixinCall, frame: Frame | null, e: Emit): MaybePromise<ForItems> {
  // [each mixin-call iterable] `.mixin()` output → iterate its declarations.
  if (isMixinCallValue(node)) {
    return frame === null ? [] : forItemsFromMixinCall(node, frame, e);
  }
  if (!isValueSlotArray(node) && node.type === 'Range') {
    return forRangeItems(node, frame, e);
  }
  const resolvedIterable = resolveForNode(node, frame, e);
  if (resolvedIterable.evaluated !== null) {
    return isCollection(resolvedIterable.evaluated)
      ? resolvedIterable.evaluated
      : { evaluatedItems: groupItems(resolvedIterable.evaluated) };
  }
  if (!isValueSlotArray(resolvedIterable.node) && resolvedIterable.node.type === 'Collection') {
    return forItemsFromCollection(resolvedIterable.node, resolvedIterable.frame, e);
  }
  const map = resolveForRuleset(node, frame, e);
  if (map) {
    /*
     * A composed module's namespace is its members, not its authored body: each
     * name once, at its first declaration, read through the activation as
     * `@ns.name` reads it ({@link activatedVarMember}), so configuration,
     * reassignment and the module's last same-name declaration are what the
     * loop sees.
     */
    const activation = composedModuleFrame(map.rules, map.frame);
    if (activation !== null) {
      const items: ForItem[] = [];
      const seen = new Set<string>();
      for (const s of map.rules) {
        if (s.type !== 'VariableDeclaration' || seen.has(s.name)) {
          continue;
        }
        seen.add(s.name);
        const member = activatedVarMember(activation, s.name, e);
        if (member !== undefined && !isMixinCallValue(member.value)) {
          items.push({ value: member.value, key: any(s.name), valueFrame: member.frame ?? activation });
        }
      }
      return items;
    }
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
   * A list iterable. An authored list (`1 2 3`, `a, b`), or a var bound to one,
   * iterates the List or Sequence the parser built. A COMPUTED value evaluates: a
   * genuine `List` (`range(…)`) iterates its typed items; any other single value
   * (a keyword, an escaped `e("…")`, a scalar) is ONE item of the type the parser
   * gave it — it is not a list, so it is never split.
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
    /*
     * A snapshot that kept the value it was evaluated to (a mixin argument,
     * ledger O3) iterates that value's items in every output mode, as the same
     * value reaching `each()` directly does — a url-bearing list included, which
     * keeps its value beside the snapshot as `mixinUrlBindings` (V15).
     */
    const carried = base.type !== 'Any'
      ? undefined
      : baseFrame?.mixinValueBindings?.get(base) ?? e.mixinValueBindings?.get(base) ?? baseFrame?.mixinUrlBindings?.get(base)
        ?? e.mixinUrlBindings?.get(base) ?? e.compressedBindings?.get(base);
    if (carried !== undefined) {
      return { evaluatedItems: groupItems(carried) };
    }

    /*
     * Anything else is one value: a list reaches here as the List or Sequence the
     * parser built, so an opaque value's bytes are never split to find items.
     */
    return [{ value: base, key: null }];
  }

  /*
   * [each] The iterable may name a value the engine can only produce by awaiting
   * (a `@plugin` result, a module-provided list). It resolves in place when it is
   * already settled, so the ordinary `each()` never becomes awaitable.
   */
  return mapMaybe(evalTypedSlot(base, baseFrame, e, true), (v) => {
    if (isCollection(v)) {
      return v;
    }
    return { evaluatedItems: groupItems(v) };
  });
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

function bindForEntry(
  node: For,
  value: ValueSlot,
  key: ValueNode | null,
  index: ValueNode,
  destructured: readonly ValueGroup[] | null = null
): Map<string, ValueSlot> {
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
  } else if (destructured !== null) {
    for (let i = 0; i < binding.names.length && i < destructured.length; i++) {
      bindings.set(binding.names[i]!, EVALUATED_BINDING);
    }
  } else {
    const values = isValueSlotArray(value)
      ? value
      : value.type === 'Sequence' ? value.parts : value.type === 'List' ? value.value : [value];
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

function bindingValuesForItem<T>(
  bindings: Map<string, ValueSlot>,
  item: ForItem,
  itemValue: T | undefined
): Map<Binding, T> | undefined {
  if (itemValue === undefined) {
    return undefined;
  }
  let values: Map<Binding, T> | undefined;
  for (const value of bindings.values()) {
    let carried: T | undefined;
    if (value === item.value && itemValue !== undefined) {
      carried = itemValue;
    }
    if (carried !== undefined) {
      (values ??= new Map()).set(value, carried);
    }
  }
  return values;
}

/**
 * Expand a Less `each()` loop: emit the callback `rules` once per iterable item,
 * binding the loop variables (`@value`/`@key`/`@index`, or the anonymous-mixin
 * param names) in each iteration's scope. The statement-emitting counterpart to
 * {@link expandCall}: both projections share iterable resolution, activation,
 * plugin preparation, and continuation order. The selected writer receives its
 * existing shared leaf buffer, so a `+`/`+_` merge accumulates across iterations
 * (`index+: @index` → `1, 2, 3`) without a second loop evaluator.
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
  applyExpansion = false,
  source: NestedHeaderSource | null = null,
  sharedLeaves?: NestedLeafBuffer
): MaybePromise<void> {
  /* [P36] Not lowered where built-ins are not ambient: evaluate the ordinary call statement, once. */
  const unlowered = unloweredCall(node);
  if (unlowered !== null) {
    return sharedLeaves === undefined
      ? walkBody([unlowered], composed, ancestor, frame, group, flush, partition, e, imp, forceLeading, propertyScope, applyExpansion)
      : nestedBody([unlowered], frame, e, undefined, imp, source, sharedLeaves, applyExpansion);
  }

  /*
   * Each iteration writes its own copy of the body, comments included. The
   * body span is found once: a loop with no recorded body span (SCSS
   * `@each`/`@for`) locates its braces in the source a single time.
   */
  const bodySpan = bodySpanForTriviaReplay(node, e);
  if (bodySpan !== undefined) {
    holdTriviaBetween(bodySpan.start, bodySpan.end, e);
  }
  return mapMaybe(forItems(node.iterable, frame, e), (items) => {
    const run = (start: number): MaybePromise<void> => {
      const collectionEntries = Array.isArray(items)
        ? null
        : items instanceof CollectionOverlay
          ? items.items
          : 'evaluatedItems' in items
            ? null
            : items.entries;
      const plainItems = Array.isArray(items) ? items : null;
      const evaluatedItems = !Array.isArray(items) && 'evaluatedItems' in items
        ? items.evaluatedItems
        : null;
      const length = collectionEntries?.length ?? plainItems?.length ?? evaluatedItems!.length;
      for (let i = start; i < length; i++) {
        const collectionEntry = collectionEntries?.[i];
        const item = collectionEntry === undefined ? plainItems?.[i] ?? null : null;
        const evaluatedItem = collectionEntry === undefined ? evaluatedItems?.[i] ?? null : null;
        const index = dimension(i + 1);
        const destructured = node.binding.kind !== 'tuple'
          ? null
          : collectionEntry !== undefined
            ? groupItems(collectionEntry.value)
            : evaluatedItem !== null
              ? groupItems(evaluatedItem)
              : null;
        const bindings = collectionEntry === undefined && evaluatedItem === null
          ? bindForEntry(node, item!.value, item!.key, index, destructured)
          : collectionEntry === undefined
            ? bindForEntry(node, EVALUATED_BINDING, null, index, destructured)
            : bindForEntry(node, EVALUATED_BINDING, EVALUATED_BINDING, index, destructured);
        const bindingValueFrames = item === null
          ? undefined
          : bindingValuesForItem(bindings, item, item.valueFrame);
        const cells = cellsForParams(
          bindings,
          bindingValueFrames,
          undefined,
          collectionEntry === undefined && evaluatedItem === null ? undefined : node.binding,
          collectionEntry,
          destructured,
          evaluatedItem
        );
        const loopFrame: Frame = {
          parent: frame,
          mixins: collectMixins(node.rules),
          declIndex: collectDeclIndex(node.rules, bindings, cells), cells, reassign: null,
          statements: node.rules,
          sourceOwner: frame.sourceOwner ?? null,
          extendPlacement: e.dynamicExtend === null ? undefined : {},
          bindingValueFrames
        };
        if (item !== null) {
          bindForDetached(loopFrame, bindings, item);
        }
        if (e.dynamicExtend !== null && node.extendInstructions !== undefined) {
          recordBodyExtends(e.dynamicExtend, node.extendInstructions, e);
        }
        const bodyTrivia = bodySpan === undefined ? undefined : bodyTriviaReplay(node, e, bodySpan);
        const walked = mapMaybe(
          activateBodyDependencies(node.rules, loopFrame, e),
          () => sharedLeaves === undefined
            ? walkBody(
                node.rules,
                composed,
                ancestor,
                loopFrame,
                group,
                flush,
                partition,
                e,
                imp,
                forceLeading,
                propertyScope,
                applyExpansion,
                false,
                bodyTrivia
              )
            : nestedBody(
                node.rules,
                loopFrame,
                e,
                undefined,
                imp,
                source,
                sharedLeaves,
                applyExpansion,
                undefined,
                bodyTrivia
              )
        );
        const emitted = mapMaybe(walked, () => {
          queueBodyTriviaTail(bodyTrivia, sharedLeaves?.leaves ?? group, sharedLeaves === undefined ? partition : null, e);
          e.emittedBlockTrivia.closeCopy(bodyTrivia);
        });
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
  const trackPlugin = e.pluginHost?.invokeRawFunction !== undefined
    && (e.scopedFunctionNames?.size ?? 0) > 0;

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
    const overlay: Frame = home && home !== frame
      ? { parent: home, mixins: null, declIndex: collectDeclIndex([], bindings), cells: cellsForParams(bindings), reassign: null, fallback: frame, callerFallback: true }
      : { parent: frame, mixins: null, declIndex: collectDeclIndex([], bindings), cells: cellsForParams(bindings), reassign: null };

    /*
     * [default-fn] thread the dispatch decision into the operand-resolution ctx so a
     * `default()` inside a comparison (`when (@x = default())`) folds to it. Guard
     * operands resolve SYNC (`makeTypedResolver` throws on async), so the spread ctx
     * never drives the async Emit machinery.
     */
    return makeTypedResolver(overlay, { ...e, defaultFn: isDefault });
  };

  /*
   * A DEFAULT param value resolves with the params bound so far in scope (Less:
   * `@hover-background: darken(@background, …)` reads the `@background` param)
   * overlaid on the mixin's DEFINITION scope, with the call site as a fallback —
   * the same frame layering `makeCalleeTyped` builds for guards. So a default like
   * `@parameter: @parameterDefault` reads the def-scope `@parameterDefault`, not a
   * same-name variable redeclared in the caller (`scope` fixture #allAreUsedHere).
   */
  let defaultValueKeys: Map<Map<string, CallValue>, Binding[]> | null = null;
  const resolveDefault: DefaultResolver = (v, boundSoFar, def) => {
    const home = homes?.get(def);
    const overlay: Frame = home && home !== frame
      ? { parent: home, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null, fallback: frame, callerFallback: true }
      : { parent: frame, mixins: null, declIndex: collectDeclIndex([], boundSoFar), cells: cellsForParams(boundSoFar), reassign: null };
    let lookup: Lookup | undefined;
    let lookupName: string | undefined;
    if (!isValueSlotArray(v) && v.type === 'Lookup'
      && v.kind === 'var' && typeof v.name === 'string') {
      lookup = v;
      lookupName = v.name;
    }
    const hit = lookup === undefined
      ? undefined
      : resolveVarRef(overlay, lookupName!, lookup.scope, e);
    const hitValue = hit?.value;
    if (hitValue !== undefined && !isValueSlotArray(hitValue)
      && !isMixinCallValue(hitValue) && isValueBlock(hitValue)) {
      return hitValue;
    }
    const mode = lookup !== undefined
      ? classifyResolvedMixinValueSource(hit, e)
      : classifyMixinValueSource(v, overlay, e);
    const pluginEligible = trackPlugin && lookup !== undefined;
    if (mode === MIXIN_VALUE_NONE && !pluginEligible) {
      return eagerSnapshot(v, overlay, e);
    }
    const candidateRoot = lookupName !== undefined && boundSoFar.has(lookupName);
    const needsRetention = mode !== MIXIN_VALUE_NONE
      || (hitValue !== undefined && !isMixinCallValue(hitValue)
        && (candidateRoot || isTypedCallValue(hitValue)));
    const retain = needsRetention
      ? (bound: Binding): void => {
          const byBinding = defaultValueKeys ??= new Map();
          const keys = byBinding.get(boundSoFar);
          if (keys === undefined) {
            byBinding.set(boundSoFar, [bound]);
          } else {
            keys.push(bound);
          }
        }
      : undefined;
    if (mode === MIXIN_VALUE_AUTHORED) {
      if (hitValue !== undefined && !isMixinCallValue(hitValue)) {
        const evaluated = withExcluded(e, hitValue, () =>
          evalTypedSlot(hitValue, hit!.frame, e, true, ARG_BINDING));
        return mapMaybe(evaluated, (group) => {
          const groupMode = mixinGroupMode(group);
          const bytes = groupMode === MIXIN_GROUP_VALUE ? writtenBytes(group, hitValue, e) : emitValue(group);
          return snapshotPreparedMixinValue(group, groupMode, bytes, e, retain!);
        });
      }
      return resolveAuthoredMixinValue(v, overlay, e, retain!);
    }
    if (mode !== MIXIN_VALUE_NONE) {
      const evaluated = hitValue !== undefined && !isMixinCallValue(hitValue)
        ? withExcluded(e, hitValue, () => evalTypedSlot(hitValue, hit!.frame, e, true))
        : evalTypedSlot(v, overlay, e, true);
      return snapshotEvaluatedMixinValue(evaluated, e, retain!);
    }
    return resolvePluginBoundHit(lookup!, hit, overlay, e, retain, candidateRoot);
  };

  /*
   * [spread] `.mixin(@args...)` splats a list variable into positional args at the
   * call site (Less variadic forwarding) BEFORE binding, so overloads select on the
   * splatted arity.
  */
  return mapMaybe(expandSpreadArgs(dropEmptyVariadicArgs(call, frame), frame, e), (expanded) => {
    const valueSpread = isValueBearingSpreadCall(expanded);
    const spreadValueBindings = valueSpread ? expanded.valueBindings : undefined;
    const call1 = valueSpread ? expanded.call : expanded;

    /*
     * an arg that is a variable bound to a detached ruleset must bind BY
     * REFERENCE (its body/closure survives); substitute the resolved node so the
     * eager byte-resolver never tries to serialize a ruleset as a value.
     */
    const prepared = substituteClosureVarArgs(call1, frame, e, true, spreadValueBindings);
    const valueBearing = isValueBearingMixinCall(prepared);
    const call2 = valueBearing ? prepared.call : prepared;
    const trackValue = valueSpread || valueBearing || e.compressedBindings !== undefined;
    const trackMode = (trackPlugin ? TRACK_PLUGIN_SOURCE : 0)
      | (trackValue ? TRACK_VALUE_SOURCE : 0);
    const boundSources: BoundSourceTracker | undefined = trackMode !== 0
      ? boundSourceTracker(
          frame,
          e,
          trackMode,
          valueSpread ? expanded : undefined,
          valueBearing ? prepared : undefined
        )
      : undefined;
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
        errorOnNoViable ? () => unresolvedMixinCall(call2, e) : undefined,
        boundSources,
        boundSources === undefined ? eagerSources(frame, e) : undefined
      );

      /*
       * `default()` ambiguity can now surface on either lane, so the mapping to a
       * positioned diagnostic is attached to both.
       */
      return isThenable(selected)
        ? selected.then(
            value => finishDefaultMixinValues(value, defaultValueKeys, e),
            (error) => {
              cleanupDefaultMixinValues(defaultValueKeys, e);
              return ambiguity(error);
            }
          )
        : finishDefaultMixinValues(selected, defaultValueKeys, e);
    } catch (error) {
      cleanupDefaultMixinValues(defaultValueKeys, e);
      return ambiguity(error);
    }
  });
}

/** [spread] Replace each `@args...` spread arg with the POSITIONAL args it splats.
 * Structural values are evaluated once and keep their typed facts beside the
 * generated eager snapshots; value-ineligible spreads retain the byte split. */
interface ValueBearingSpreadCall {
  readonly call: MixinCall;
  readonly valueBindings: Map<Any, ValueGroup>;
  urlBindings: Set<Binding> | null;
}

type ExpandedSpreadArgs = MixinCall | ValueBearingSpreadCall;

function isValueBearingSpreadCall(value: ExpandedSpreadArgs): value is ValueBearingSpreadCall {
  return !('type' in value);
}

/**
 * [#4352] Forwarding an EMPTY variadic (`.forward(@a, @rest...) { .target(@a, @rest); }`
 * called as `.forward(1)`) must not fill the next param slot: the empty `@rest`
 * passes NO argument, so a defaulted param keeps its default (`b: fallback`),
 * rather than binding empty bytes. An empty variadic is bound as an empty slot
 * array; a filled one keeps its members, so only the zero-length case is dropped.
 * Scoped to unnamed, non-spread var reads — a named or explicit-value arg is a
 * deliberate pass, and a spread is already handled by `expandSpreadArgs`.
 *
 * ponytail: a bare-`@var` positional arg is resolved here and again in
 * `substituteClosureVarArgs`; fold this into that pass if mixin dispatch shows up
 * in a perf profile. The lookup is gated to bare-var positional args, so a
 * literal-argument call pays nothing.
 */
function dropEmptyVariadicArgs(call: MixinCall, frame: Frame): MixinCall {
  let kept: CallArg[] | undefined;
  for (let index = 0; index < call.args.length; index++) {
    const a = call.args[index]!;
    const v = a.value;

    // An empty variadic binds as a zero-length slot array (see `finishRest`).
    const bound = a.name === undefined && a.spread !== true
      && !isValueSlotArray(v) && !isMixinCallValue(v)
      && v.type === 'Lookup' && v.kind === 'var' && typeof v.name === 'string'
      ? lookupVarIn(frame, v.name)?.value
      : undefined;
    if (Array.isArray(bound) && bound.length === 0) {
      kept ??= call.args.slice(0, index);
    } else {
      kept?.push(a);
    }
  }
  return kept === undefined
    ? call
    : { type: 'MixinCall', name: call.name, args: kept, path: call.path, important: call.important, content: call.content, _s: call._s, _e: call._e };
}

function expandSpreadArgs(
  call: MixinCall,
  frame: Frame,
  e: EvalCtx
): MaybePromise<ExpandedSpreadArgs> {
  // The overwhelmingly common call has no spread at all and leaves here untouched.
  if (!call.args.some(a => a.spread)) {
    return call;
  }
  const args: CallArg[] = [];
  const expanded: MixinCall = {
    type: 'MixinCall', name: call.name, args, path: call.path,
    important: call.important, content: call.content, _s: call._s, _e: call._e
  };
  let valueState: ValueBearingSpreadCall | undefined;
  const step = (index: number): MaybePromise<ExpandedSpreadArgs> => {
    for (; index < call.args.length; index++) {
      const a = call.args[index]!;
      if (!a.spread) {
        args.push(a);
        continue;
      }
      const source = a.value;
      if (!isValueSlot(source)) {
        throw new Error('A deferred mixin call cannot be used as a spread argument.');
      }
      if (classifyMixinValueSource(source, frame, e) === MIXIN_VALUE_NONE) {
        /* Evaluated once, typed, so each piece carries the item it is (and, under compress, folds from). */
        const resolved = mapMaybe(evalTypedSlot(source, frame, spliceCtx(e), true), (value) => {
          pushTypedSpread(args, expanded, value, e, undefined, false);
        });
        if (isThenable(resolved)) {
          const at = index;
          return resolved.then(() => step(at + 1));
        }
        continue;
      }
      const spreadValue = evalTypedSpread(source, frame, e);
      if (isThenable(spreadValue)) {
        const at = index;
        return spreadValue.then((settled) => {
          valueState = pushTypedSpread(args, expanded, settled, e, valueState);
          return step(at + 1);
        });
      }
      valueState = pushTypedSpread(args, expanded, spreadValue, e, valueState);
    }
    return valueState ?? expanded;
  };
  return step(0);
}

/** Evaluate a structural spread, keeping its positional items typed. */
function evalTypedSpread(
  value: ValueSlot,
  frame: Frame,
  e: EvalCtx
): MaybePromise<ValueGroup> {
  if (isValueSlotArray(value)) {
    return combineAll(value.map(item => evalTypedSpread(item, frame, e)), items => items);
  }
  if (value.type === 'Lookup' && value.kind === 'var') {
    const hit = resolveVarRef(frame, literalName(value), value.scope, e);
    if (hit?.evaluated !== null && hit?.evaluated !== undefined) {
      return hit.evaluated;
    }
    const hitValue = hit?.value;
    if (hit && hitValue !== undefined && isValueSlot(hitValue)) {
      return withExcluded(e, hitValue, () => evalTypedSpread(hitValue, hit.frame, e));
    }
  }
  return evalTypedSlot(value, frame, e, true);
}

/**
 * Append one evaluated spread group, retaining typed positional items. With
 * `bearing` off (a plain spread under compress) the items only carry the value
 * a declaration folds; the call stays an ordinary one.
 */
function pushTypedSpread(
  args: CallArg[],
  call: MixinCall,
  value: ValueGroup,
  e: EvalCtx,
  state?: ValueBearingSpreadCall,
  bearing = true
): ValueBearingSpreadCall | undefined {
  const items = isValueGroupArray(value)
    ? value
    : value.type === 'List'
      ? value.value
      : null;
  if (items !== null) {
    for (let index = 0; index < items.length; index++) {
      if (!isValueGroupArray(value) && value.type === 'List' && value.sep === '/' && index !== 0) {
        args.push(callArg(any('/')));
      }
      state = pushTypedSpreadItem(args, call, items[index]!, e, state, bearing);
    }
    return state;
  }

  /* One value that is not a list is one argument: an escaped string is never split (ledger V3). */
  return pushTypedSpreadItem(args, call, value, e, state, bearing);
}

/** Append one structural spread item as one eager snapshot. */
function pushTypedSpreadItem(
  args: CallArg[],
  call: MixinCall,
  value: ValueGroup,
  e: EvalCtx,
  state?: ValueBearingSpreadCall,
  bearing = true
): ValueBearingSpreadCall | undefined {
  const bytes = emitValue(value).trim();
  if (bytes === '') {
    return state;
  }
  const snapshot = any(bytes);
  args.push(callArg(snapshot));
  carrySnapshot(snapshot, value, e);
  if (bearing && valueGroupNeedsMixinCarrier(value)) {
    const bindings = state ?? {
      call,
      valueBindings: new Map<Any, ValueGroup>(),
      urlBindings: null
    };
    bindings.valueBindings.set(snapshot, value);
    if (valueGroupHasUrl(value)) {
      (bindings.urlBindings ??= new Set()).add(snapshot);
    }
    return bindings;
  }
  return state;
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
interface ValueBearingMixinCall extends MixinValueSources {
  readonly call: MixinCall;
}

type PreparedClosureArgs = MixinCall | ValueBearingMixinCall;

function isValueBearingMixinCall(value: PreparedClosureArgs): value is ValueBearingMixinCall {
  return !('type' in value);
}

function substituteClosureVarArgs(
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
  trackValue: false,
  spreadValueBindings?: ReadonlyMap<Binding, ValueGroup>
): MixinCall;
function substituteClosureVarArgs(
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
  trackValue?: true,
  spreadValueBindings?: ReadonlyMap<Binding, ValueGroup>
): PreparedClosureArgs;
function substituteClosureVarArgs(
  call: MixinCall,
  frame: Frame,
  e: EvalCtx,
  trackValue = true,
  spreadValueBindings?: ReadonlyMap<Binding, ValueGroup>
): PreparedClosureArgs {
  let changed = false;
  let valueSource: CallValue | undefined;
  let valueSourceMode: Exclude<MixinValueSourceMode, typeof MIXIN_VALUE_NONE> | undefined;
  let additionalValueSources: Map<CallValue, Exclude<MixinValueSourceMode, typeof MIXIN_VALUE_NONE>> | undefined;
  const args = call.args.map((a) => {
    const value = a.value;
    const directVariable = !isValueSlotArray(value) && !isMixinCallValue(value)
      && value.type === 'Lookup' && value.kind === 'var' && typeof value.name === 'string';
    const directHit = directVariable
      ? trackValue
        ? resolveVarRef(frame, value.name, value.scope, e)
        : lookupVarIn(frame, value.name)
      : undefined;
    const spreadCarriesValue = spreadValueBindings?.has(value) === true;
    if (trackValue && !isMixinCallValue(value) && !spreadCarriesValue) {
      const mode = directVariable
        ? classifyResolvedMixinValueSource(directHit, e)
        : classifyMixinValueSource(value, frame, e);
      if (mode !== MIXIN_VALUE_NONE) {
        if (valueSource === undefined) {
          valueSource = value;
          valueSourceMode = mode;
        } else if (valueSource !== value) {
          (additionalValueSources ??= new Map()).set(value, mode);
        }
      }
    }

    /*
     * A mixin call passed directly as an arg value (`.wrapper(.something(foo))`):
     * wrap it as a detached ruleset whose body is that call, so `@another-mixin()`
     * dispatches it (its args resolve in the caller frame's runtime binding).
     */
    if (directVariable) {
      const bound = directHit?.value;
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
  const substituted: MixinCall = changed
    ? { type: 'MixinCall', name: call.name, args, path: call.path, important: call.important, content: call.content, _s: call._s, _e: call._e }
    : call;
  return valueSource === undefined || valueSourceMode === undefined
    ? substituted
    : {
        call: substituted,
        valueSource,
        valueSourceMode,
        additionalValueSources: additionalValueSources ?? null
      };
}

function flushBlock(
  selector: string[],
  group: Leaf[],
  e: Emit,
  selNode?: SelectorList,
  parentKey?: object | null,
  trailingBlockComments: readonly string[] = EMPTY_LEAF_BLOCK_COMMENTS
): MaybePromise<void> {
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
  const emit = (kept: Leaf[], mergeMode: MergeGroupMode = MERGE_NONE): void => {
    /* A block of comments the output drops (compress) writes nothing (ledger O6). */
    if (kept.length === 0 && !trailingBlockComments.some(comment => keepComment(e, comment))) {
      return;
    }

    // [atrule] indent by the current block depth (0 at top level == prior behavior).
    const idt = blockIndent(e);
    const authoredHeader = e.compress !== true && parentKey === null && selector.length === selNode?.selectors.length
      ? authoredSelectorHeaderWithTrivia(selNode, selector, e)
      : null;
    const header = composeSelectorHeader(e, selector, idt, authoredHeader);

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
      if (e.compress === true && lb.droppedSemi) {
        put(e, ';'); // [compress] restore the separator dropped at the prior close
      }
      if (e.dynamicExtend) {
        e.dynamicExtend.pendingHeaderChunk = -1;
      }
    } else {
      if (idt) {
        put(e, idt);
      }
      const selStart = e.chunks.length;

      /*
       * [extend/dynamic] The header is its OWN chunk; record its index so the
       * deferred fold can overwrite it in place once dynamic extenders are known.
       * Only meaningful for a real selector header (`selNode` present, non-empty).
       */
      if (e.dynamicExtend) {
        e.dynamicExtend.pendingHeaderChunk = selNode !== undefined && selector.length > 0 ? e.chunks.length : -1;
        e.dynamicExtend.pendingHeaderIndent = idt;
      }
      put(e, header);
      if (e.positions && selNode) {
        e.positions.push({ node: selNode, type: selNode.type, start: selStart, end: e.chunks.length, source: srcFile(e) });
      }
      put(e, blockOpen(e));
    }
    if (mergeMode !== MERGE_NONE) {
      mergeFold(kept, e, bodyIndent(e), emitLeaf, mergeMode);
    } else {
      for (let index = 0; index < kept.length;) {
        const leaf = kept[index]!;
        const sourceOwner = leaf.frame.sourceOwner;
        if (
          sourceOwner !== null
          && sourceOwner !== undefined
          && e.context !== undefined
          && sourceOwner !== e.context.documentContext
        ) {
          let end = index + 1;
          while (end < kept.length && kept[end]!.frame.sourceOwner === sourceOwner) {
            end++;
          }
          const start = index;
          settledEmission(withSourceOwner(e, sourceOwner, () => {
            for (let at = start; at < end; at++) {
              emitLeafOwned(kept[at]!, e);
            }
          }), leaf.node, e);
          index = end;
          continue;
        }
        emitLeafOwned(leaf, e);
        index++;
      }
    }

    /* The body's comments after its last leaf (queueBodyTriviaTail). */
    for (const comment of trailingBlockComments) {
      putBlockComment(e, bodyIndent(e), comment);
    }
    emitBlockClose(e, idt, lb);

    // [adjacent-merge] update the single record in place (no per-block allocation).
    lb.parentKey = pk;
    lb.header = header;
    lb.depth = e.depth;
    lb.endChunks = e.chunks.length;
  };
  const mergeMode = mergeGroupMode(group);
  if (mergeMode !== MERGE_NONE) {
    return emit(group, mergeMode);
  }
  return mapMaybe(dedupGroup(group, e), emit);
}

/** [adjacent-merge] Rewind the trailing block-close chunks emitted by `flushBlock`
 * (`}\n`, preceded by the block's indent chunk when nested) so a following body can
 * append inside the just-closed block. Only called when `lastBlock.endChunks`
 * proves those chunks are the current tail. */
function popClose(e: Emit, idt: string): void {
  e.chunks.pop(); // '}\n' (pretty) or '}' (compress)

  // [compress] the close is a bare `}` with no preceding indent chunk.
  if (idt && e.compress !== true) {
    e.chunks.pop(); // the block-indent chunk
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

    /*
     * A dropped duplicate's leading comments are trivia, not part of the
     * declaration: they stay, ahead of the next declaration kept (the later
     * occurrence always is).
     */
    const out: Leaf[] = [];
    let carried: string[] | null = null;
    for (let i = 0; i < group.length; i++) {
      const leaf = group[i]!;
      if (suppressed.has(i)) {
        if (leaf.leadingBlockComments !== null && leaf.leadingBlockComments.length !== 0) {
          (carried ??= []).push(...leaf.leadingBlockComments);
        }
        continue;
      }
      if (carried !== null) {
        out.push({ ...leaf, leadingBlockComments: [...carried, ...leaf.leadingBlockComments ?? []] });
        carried = null;
        continue;
      }
      out.push(leaf);
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

const MERGE_NONE = 0;
const MERGE_UNIFORM = 1;
const MERGE_MIXED = 2;
type MergeGroupMode = typeof MERGE_NONE | typeof MERGE_UNIFORM | typeof MERGE_MIXED;

function mergeGroupMode(group: Leaf[]): MergeGroupMode {
  const firstOwner = group[0]?.frame.sourceOwner;
  for (let index = 0; index < group.length; index++) {
    const leaf = group[index]!;
    if (leaf.node.type !== 'Declaration' || leaf.node.merge === null) {
      continue;
    }

    /* Match the old no-merge/early-hit node checks exactly. Once a merge is
     * known, classify the admitted merge group's owners in one pass. */
    for (let ownerIndex = 1; ownerIndex < group.length; ownerIndex++) {
      if (group[ownerIndex]!.frame.sourceOwner !== firstOwner) {
        return MERGE_MIXED;
      }
    }
    return MERGE_UNIFORM;
  }
  return MERGE_NONE;
}

/**
 * Emit a leaf group, folding `+`/`+_` merge declarations. v5 LAST-occurrence
 * anchor: a merged property's combined line sits at its LAST member's position;
 * members keep source order; any member's `!important` promotes the whole line.
 * Non-merge decls and comments emit in place (unchanged). `idt` is the leaf
 * indentation of the enclosing block. Deliberate v5 divergence from less.js
 * `_mergeRules` (which anchors FIRST); see CUTOVER-STATUS.md.
 */
function mergeFold(
  group: Leaf[],
  e: Emit,
  idt: string,
  emitOne: (l: Leaf, e: Emit) => void = emitLeaf,
  mode: MergeGroupMode = MERGE_UNIFORM
): void {
  if (mode === MERGE_MIXED) {
    mergeFoldMixedOwners(group, e, idt, emitOne);
    return;
  }
  const first = group[0];
  const sourceOwner = first?.frame.sourceOwner;
  if (
    first !== undefined
    && sourceOwner !== null
    && sourceOwner !== undefined
    && e.context !== undefined
    && sourceOwner !== e.context.documentContext
  ) {
    settledEmission(withSourceOwner(e, sourceOwner, () => mergeFoldOwned(group, e, idt, emitOne)), first.node, e);
    return;
  }
  mergeFoldOwned(group, e, idt, emitOne);
}

/** Fold a merge group after any uniform source owner has been activated. */
function mergeFoldOwned(group: Leaf[], e: Emit, idt: string, emitOne: (l: Leaf, e: Emit) => void): void {
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
      for (const comment of leaf.leadingBlockComments ?? []) {
        putBlockComment(e, idt, comment);
      }
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
         * already takes this path only after `mergeGroupMode` admitted the group.
         */
        const previousImportant = e.mergeImportant;
        e.mergeImportant = false;
        const bytes = evalBytesSync(dn.value, group[idx]!.frame, e);
        const inlineComment = takeIndexedInlineBlockCommentTriviaAfter(dn, e) ?? '';
        important ||= dn.important || group[idx]!.important === true || e.mergeImportant;
        e.mergeImportant = previousImportant;
        if (k === 0) {
          combined = bytes + inlineComment;
        } else {
          combined += (dn.merge === ',' ? ', ' : ' ') + bytes + inlineComment;
        }
      }
      emitMergedLine(e, names[i]!, combined, important, idt);
    } else {
      emitOne(leaf, e);
    }
  }
}

/** Resolve mixed-source merge names while each contiguous run owns Context. */
function captureMixedMergeNames(
  group: Leaf[],
  names: (string | null)[],
  start: number,
  end: number,
  e: Emit
): void {
  for (let index = start; index < end; index++) {
    const leaf = group[index]!;
    const node = leaf.node;
    if (node.type !== 'Declaration' || node.merge === null) {
      continue;
    }
    names[index] = declName(node, leaf.frame, e);
  }
}

/** Append one contiguous merge-member owner run without allocating a callback. */
function appendMixedMergeMemberRun(
  group: Leaf[],
  indices: number[],
  start: number,
  end: number,
  combined: string,
  e: Emit
): string {
  for (let at = start; at < end; at++) {
    const memberIndex = indices[at]!;
    const memberLeaf = group[memberIndex]!;
    const memberNode = memberLeaf.node;
    if (memberNode.type !== 'Declaration') {
      throw new TypeError('Expected declaration merge member');
    }
    const memberImportant = e.mergeImportant;
    e.mergeImportant = false;
    const bytes = evalBytesSync(memberNode.value, memberLeaf.frame, e);
    const inlineComment = takeIndexedInlineBlockCommentTriviaAfter(memberNode, e) ?? '';
    combined += at === 0
      ? bytes + inlineComment
      : (memberNode.merge === ',' ? ', ' : ' ') + bytes + inlineComment;
    e.mergeImportant = memberImportant === true
      || memberNode.important
      || memberLeaf.important === true
      || e.mergeImportant;
  }
  return combined;
}

/** Emit one already-resolved mixed-source merge run under its active owner. */
function emitMixedMergeMembers(
  group: Leaf[],
  names: (string | null)[],
  mergeGroups: Map<string, number[]>,
  start: number,
  end: number,
  e: Emit,
  idt: string,
  emitOne: (leaf: Leaf, emit: Emit) => void
): void {
  for (let index = start; index < end; index++) {
    const leaf = group[index]!;
    const node = leaf.node;
    if (node.type !== 'Declaration' || node.merge === null) {
      emitOne(leaf, e);
      continue;
    }
    for (const comment of leaf.leadingBlockComments ?? []) {
      putBlockComment(e, idt, comment);
    }
    const indices = mergeGroups.get(names[index]!)!;
    if (index !== indices[indices.length - 1]) {
      continue;
    }
    let combined = '';
    const previousImportant = e.mergeImportant;
    e.mergeImportant = false;
    for (let member = 0; member < indices.length;) {
      const sourceOwner = group[indices[member]!]!.frame.sourceOwner;
      let memberEnd = member + 1;
      while (
        memberEnd < indices.length
        && group[indices[memberEnd]!]!.frame.sourceOwner === sourceOwner
      ) {
        memberEnd++;
      }
      if (
        sourceOwner !== null
        && sourceOwner !== undefined
        && e.context !== undefined
        && sourceOwner !== e.context.documentContext
      ) {
        const start = member;
        withSourceOwner(e, sourceOwner, () => {
          combined = appendMixedMergeMemberRun(
            group, indices, start, memberEnd, combined, e
          );
        });
      } else {
        combined = appendMixedMergeMemberRun(
          group, indices, member, memberEnd, combined, e
        );
      }
      member = memberEnd;
    }
    const mergedImportant = Boolean(e.mergeImportant);
    e.mergeImportant = previousImportant;
    emitMergedLine(e, names[index]!, combined, mergedImportant, idt);
  }
}

/** Fold a merge group whose leaves come from more than one source document. */
function mergeFoldMixedOwners(
  group: Leaf[],
  e: Emit,
  idt: string,
  emitOne: (leaf: Leaf, emit: Emit) => void
): void {
  const names = new Array<string | null>(group.length);

  for (let index = 0; index < group.length;) {
    const sourceOwner = group[index]!.frame.sourceOwner;
    let end = index + 1;
    while (end < group.length && group[end]!.frame.sourceOwner === sourceOwner) {
      end++;
    }
    if (
      sourceOwner !== null
      && sourceOwner !== undefined
      && e.context !== undefined
      && sourceOwner !== e.context.documentContext
    ) {
      const start = index;
      withSourceOwner(e, sourceOwner, () => {
        captureMixedMergeNames(group, names, start, end, e);
      });
    } else {
      captureMixedMergeNames(group, names, index, end, e);
    }
    index = end;
  }

  const mergeGroups = new Map<string, number[]>();
  for (let index = 0; index < group.length; index++) {
    const node = group[index]!.node;
    if (node.type !== 'Declaration' || node.merge === null) {
      continue;
    }
    const name = names[index]!;
    const members = mergeGroups.get(name);
    if (members === undefined) {
      mergeGroups.set(name, [index]);
    } else {
      members.push(index);
    }
  }

  for (let index = 0; index < group.length;) {
    const sourceOwner = group[index]!.frame.sourceOwner;
    let end = index + 1;
    while (end < group.length && group[end]!.frame.sourceOwner === sourceOwner) {
      end++;
    }
    if (
      sourceOwner !== null
      && sourceOwner !== undefined
      && e.context !== undefined
      && sourceOwner !== e.context.documentContext
    ) {
      const start = index;
      withSourceOwner(e, sourceOwner, () => {
        emitMixedMergeMembers(
          group, names, mergeGroups, start, end, e, idt, emitOne
        );
      });
    } else {
      emitMixedMergeMembers(
        group, names, mergeGroups, index, end, e, idt, emitOne
      );
    }
    index = end;
  }
}

/** A declaration value that is an SCSS nested-property block. */
function isNestedPropertyValue(value: ValueSlot): value is NestedPropertyBlock {
  return !isValueSlotArray(value) && value.type === 'NestedPropertyBlock';
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

/** [nested-property] Append one carrier level's declarations to `out`, recursing
 * through an entry that is itself a `{ … }` block (`font: { family: { weight: bold } }`). */
function collectNestedProperty(
  name: string | Interpolation,
  block: NestedPropertyBlock,
  merge: Declaration['merge'],
  important: boolean,
  out: Declaration[]
): void {
  if (block.base !== null) {
    out.push(decl(name, block.base, merge, important));
  }
  for (const entry of block.entries) {
    const key = entry.key;
    const leaf = isValueSlotArray(key)
      ? null
      : key.type === 'Keyword' || key.type === 'Color' || key.type === 'Dimension' || key.type === 'Any'
        ? key.src
        : key.type === 'Quoted' ? key.interp ?? key.value : key.type === 'Interpolation' ? key : null;
    if (leaf === null) {
      continue;
    }
    const joined = joinNestedPropertyName(name, leaf);
    if (isNestedPropertyValue(entry.value)) {
      collectNestedProperty(joined, entry.value, entry.merge, entry.important, out);
    } else {
      out.push(decl(joined, entry.value, entry.merge, entry.important));
    }
  }
}

/**
 * [nested-property] A parser-owned `NestedPropertyBlock` expands to hyphenated
 * declarations, while a `Collection` is always data and serializes as
 * `{ a: 1; b: 2 }`. The
 * carrier's own `base` value first, then each entry with its outer name joined
 * by `-`, in source order.
 *
 * The trigger is the parser-owned structural node in property position, not a
 * data `Collection` and not a value that merely evaluates to one. A custom
 * property that carries map data uses `Collection` directly.
 *
 * Returns `null` when `node` is not a nested-property carrier. The one body
 * evaluator (`walkBody`) drives BOTH write projections through this single
 * function: a second implementation would drift, and an emitter divergence is
 * exactly the defect this guards.
 */
function nestedPropertyDeclarations(node: Declaration): Declaration[] | null {
  if (!isNestedPropertyValue(node.value) || isCustomPropertyName(node.name)) {
    return null;
  }
  const out: Declaration[] = [];
  collectNestedProperty(node.name, node.value, node.merge, node.important, out);
  return out;
}

/** Emit one folded `name: combined[ !important];` line. */
function emitMergedLine(e: Emit, name: string, combined: string, important: boolean, idt: string): void {
  const start = e.chunks.length;
  e.lastDeclCustom = false; // [compress] merged (`+`) declarations are never custom properties
  put(e, idt);
  put(e, name);
  put(e, e.compress === true ? ':' : ': ');
  put(e, combined);
  if (important) {
    put(e, e.compress === true ? '!important' : ' !important');
  }
  put(e, declEnd(e));
  if (e.positions) {
    e.positions.push({ node: any(combined), type: 'Any', start, end: e.chunks.length, source: srcFile(e) });
  }
}

/**
 * [null] The emit cursor as it stood before a declaration's first byte, so a
 * declaration that turns out to elide can be rolled back out of the output.
 */
interface DropMark {
  readonly chunks: number;
  readonly positions: number;
  readonly sink: { elided: boolean };
}

const dropMark = (e: Emit): DropMark => ({
  chunks: e.chunks.length,
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
  if (e.positions !== null) {
    e.positions.length = mark.positions;
  }
}

function emitLeaf(leaf: Leaf, e: Emit, atRoot = false): void {
  const sourceOwner = leaf.frame.sourceOwner;
  const context = e.context;
  if (
    sourceOwner !== null
    && sourceOwner !== undefined
    && context !== undefined
    && sourceOwner !== context.documentContext
  ) {
    /* Mixin expansion can outlive its source-scope callback because leaves are
     * grouped for dedup/merge. Re-enter only on that exceptional mismatch. */
    settledEmission(withSourceOwner(e, sourceOwner, () => emitLeafOwned(leaf, e, atRoot)), leaf.node, e);
    return;
  }
  emitLeafOwned(leaf, e, atRoot);
}

/**
 * Write a declaration's value, for both writers. A custom property's value is
 * its authored text, comments included; any other value is evaluated. Returns
 * whether the value settles after the walk.
 */
function putDeclarationValue(
  e: Emit,
  node: Declaration,
  frame: Frame,
  continuationIndent: string,
  important: boolean,
  onNewLine: boolean,
  isCustom: boolean,
  mark: DropMark
): boolean {
  const customValue = isCustom ? customPropertyValueWithTrivia(node.value, frame, e) : null;
  if (customValue === null) {
    const prevElide = e.elideSink;
    e.elideSink = mark.sink; // [null] this declaration's elision, not an enclosing one
    const deferred = putValue(e, node.value, frame, isValueSlotArray(node.value) ? undefined : node.value, continuationIndent, important, onNewLine) === null; // [whitespace] continuation indent
    e.elideSink = prevElide;
    return deferred;
  }
  const valStart = e.chunks.length;
  const written = (value: string): string => (important ? normalizeImportant(value, e.compress === true) : value);
  if (isThenable(customValue)) {
    putPending(e, mapMaybe(customValue, written));
  } else {
    put(e, written(customValue));
  }
  if (e.positions && !isValueSlotArray(node.value)) {
    e.positions.push({ node: node.value, type: node.value.type, start: valStart, end: e.chunks.length, source: srcFile(e) });
  }
  return false;
}

/** Emit one leaf after its source owner/trivia are already active. */
function emitLeafOwned(leaf: Leaf, e: Emit, atRoot = false): void {
  const { node, frame } = leaf;

  /*
   * [atrule] a declaration/comment sits one level in from its container's depth.
   * A leaf emitted directly at the document root (not inside any block) sits flush
   * left at depth 0 rather than one level in.
   */
  const idt = atRoot ? blockIndent(e) : bodyIndent(e);

  /* The comments queued ahead of the leaf precede it, outside its mapped span. */
  for (const comment of leaf.leadingBlockComments ?? []) {
    putBlockComment(e, idt, comment);
  }
  const start = e.chunks.length;
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
    const isCustom = name.startsWith('--');
    e.lastDeclCustom = isCustom; // [compress] gate the last-`;` drop in emitBlockClose
    put(e, idt);
    put(e, name); // resolve interpolated property name
    put(e, declarationHeadTriviaText(node, e));
    const onNewLine = node.valueOnNewLine === true;

    /*
     * [compress] a custom property keeps its value region EXACTLY as pretty — the
     * `: ` separator is not collapsed (the space can be significant/opaque).
     */
    put(e, (e.compress === true && !isCustom) || onNewLine ? ':' : ': ');
    const important = node.important === true || leaf.important === true;
    const deferred = putDeclarationValue(e, node, frame, idt + INDENT, important, onNewLine, isCustom, mark);
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
    emitInlineBlockCommentTriviaAfter(node, e);
    put(e, declEnd(e));
    finishDrop(e, mark, deferred);
  } else if (node.type === 'Comment') {
    if (!keepComment(e, node.text)) {
      return;
    }
    put(e, idt);
    put(e, node.text);
    put(e, nl(e));
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
  } else if (node.type === 'FunctionCall') {
    if (leaf.callBytes !== null) {
      put(e, idt + leaf.callBytes + nl(e));
    }
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
  } else if (node.type === 'AtRuleBlock') {
    /*
     * [atrule-nested] a stay-nested at-rule buffered into a decl group: emit one
     * block level deeper than the containing declarations.
     */
    e.depth++;
    settledEmission(expandAtRuleBlock(node, frame, e), node, e);
    e.depth--;
  } else if (node.type === 'AtRuleStatement') {
    e.depth++;
    emitAtRuleStatement(node, frame, e);
    e.depth--;
  } else if (node.type === 'StyleImport') {
    const opts = importRequestOptions(node.options);
    if (importHasOption(opts, 'inline') && !importHasOption(opts, 'reference')) {
      /*
       * [inline-import] Raw `@import (inline)` bytes emit AS this block's body. The
       * read is async, so keep the walk sync by reserving an async-patch chunk (the
       * context's own `chunks`/`pending`) that the resolved bytes fill after the walk.
       */
      const request: ImportDocumentRequest = {
        node, specifier: importSpecifier(node, frame, e), options: opts
      };
      const loaded = e.importDocument?.(request);
      const asBytes = (l: ImportDocument | undefined): string =>
        l !== undefined && 'inline' in l ? idt + l.inline + '\n' : '';
      if (isThenable(loaded)) {
        putPending(e, mapMaybe(loaded, asBytes));
      } else {
        put(e, asBytes(loaded));
      }
      if (e.positions) {
        e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
      }
    } else {
      e.depth++;
      settledEmission(expandStyleImport(node, frame, e, e.importDocument), node, e);
      e.depth--;
    }
  } else if (node.type === 'UnknownAtRuleBlock') {
    e.depth++;
    emitUnknownAtRuleBlock(node, e);
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
      emitAtRuleStatementRaw(c as AtRuleStatement, frame, e, null);
      return;
    }
  }
}

/**
 * Fallback for a document whose import planner was not admitted: emit its direct
 * CSS terminals before ordinary rules and retain only the first identical
 * occurrence. When compile-time imports exist, the planner carries the same rule
 * across their loaded documents without changing lexical Less execution.
 */
function cssImportKey(node: AtRuleStatement, target: Quoted | Url): string | null {
  /*
   * Only a dialect that TYPES its CSS-terminal import prelude participates. A
   * grammar that flattens the whole prelude to opaque bytes (plain CSS, jess)
   * keeps its authored statement order, and nothing here re-derives a target
   * from those bytes.
   */
  const prelude = node.prelude!;
  let tail = '';
  if (prelude.type === 'Sequence') {
    for (let index = 1; index < prelude.parts.length; index++) {
      if (prelude.parts[index]!.type !== 'Any') {
        return null;
      }
    }
    for (let index = 1; index < prelude.parts.length; index++) {
      /* The complete preceding pass proves every tail member is `Any`. */
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const part = prelude.parts[index]! as Any;
      if (index > 1) {
        tail += ' ';
      }
      tail += part.src;
    }
  }

  /*
   * A media/layer tail is NOT what makes an import CSS terminal — only the
   * parser-owned `AtRuleStatement` classification is. A compile-time import
   * never reaches this statement node, so re-reading the target suffix here
   * would duplicate and weaken that grammar decision.
   */
  let emittedTarget: string;
  if (target.type === 'Quoted') {
    emittedTarget = target.src;
  } else if (isStaticQuoted(target.value) || target.value.type === 'Any') {
    emittedTarget = `url(${target.value.src})`;
  } else {
    return null;
  }
  return `${node.name}\u0000${emittedTarget}\u0000${tail}`;
}

/**
 * Write the planner-carried CSS prelude in document order. Each item retains the
 * lexical frame and driver-owned source scope in which its typed target was
 * authored; the later import splice sees the same canonical node in the
 * `hoistedCssImports` set and therefore emits no second copy.
 */
function emitPlannedCssImports(plan: CssImportPlan | null, e: Emit): MaybePromise<void> {
  if (plan === null) {
    return;
  }
  const nodes = plan.nodes!;
  const targets = plan.targets!;
  const frames = plan.frames!;
  const withinDocuments = plan.withinDocuments!;
  const links = plan.next!;
  const run = (from: number): MaybePromise<void> => {
    let index = from;
    while (index !== -1) {
      const node = nodes[index]!;
      if (node === null) {
        index = links[index]!;
        continue;
      }
      const withinDocument = withinDocuments[index]!;
      if (withinDocument === null) {
        emitAtRuleStatementRaw(node, frames[index]!, e, targets[index]!);
        index = links[index]!;
        continue;
      }
      let next = index;
      const emitted = withinDocument(() => {
        while (next !== -1 && withinDocuments[next] === withinDocument) {
          const scopedNode = nodes[next]!;
          if (scopedNode !== null) {
            emitAtRuleStatementRaw(scopedNode, frames[next]!, e, targets[next]!);
          }
          next = links[next]!;
        }
      });
      if (isThenable(emitted)) {
        return emitted.then(() => run(next));
      }
      index = next;
    }
  };
  return run(plan.head);
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
    const target = cssImportTarget(child);
    if (target === null) {
      continue;
    }
    const key = cssImportKey(child, target);
    (hoisted ??= new Set()).add(child);
    if (key !== null) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    emitAtRuleStatementRaw(child, frame, e, target);
  }
  e.hoistedCssImports = hoisted;
}

/**
 * SCSS compile-time diagnostics. Owner ruling 2026-09-05: these are "supported
 * as-is without adding to the AST", so they reduce to an ordinary
 * `AtRuleStatement` (no dedicated AST kind) and eval "add[s] those
 * errors/warnings/debugs as expected". They never emit CSS: eval routes them
 * here instead. `@debug`/`@warn` report through the warning channel and
 * continue; `@error` halts by throwing.
 *
 * Routing is gated on {@link isDiagnosticStatement} — a marker ONLY the SCSS
 * grammar sets — NOT on the at-rule name, because this serializer is
 * dialect-blind: an identically-named `@error` in CSS/Less/jess is an unknown
 * at-rule that must keep verbatim passthrough (no drop, no warn, no halt). The
 * owner ruling is SCSS/Sass-scoped; .jess is pending a separate owner ruling
 * and for now stays passthrough.
 */

/**
 * The directive's message is the prelude value, evaluated like any Sass value
 * (so `1 + 2` computes and `"need #{$x}"` interpolates). A top-level authored
 * string literal reports its UNQUOTED text; every other prelude — a list, map,
 * number, bare keyword, or bare `#{…}` — reports its serialized bytes verbatim,
 * INCLUDING any inner quotes. The discriminator is the prelude's AST SHAPE, not
 * its serialized bytes: stripping the quotes off the whole message
 * would wrongly unwrap the list `"a", "b"` to `a", "b`, whereas testing the
 * node keeps the list intact.
 *
 * A string literal is a `Quoted` node, whether or not it carries `#{…}`; its
 * message is its content. A bare `#{x}` is not a string literal.
 */
function diagnosticMessage(prelude: ValueNode, frame: Frame, e: Emit): string {
  return prelude.type === 'Quoted' ? quotedContentSync(prelude, frame, e) : evalBytesSync(prelude, frame, e);
}
function emitDiagnosticDirective(node: AtRuleStatement, frame: Frame, e: Emit): void {
  const message = node.prelude === null ? '' : diagnosticMessage(node.prelude, frame, e);
  const name = node.name.toLowerCase();
  if (name === '@error') {
    throw ERR.scssError({
      node,
      ...callSiteLocation(node, e),
      meta: { message }
    });
  }
  e.context?.warnAtNode(
    name === '@warn' ? 'eval/scss-warn' : 'eval/scss-debug',
    'eval',
    node,
    { message }
  );
}

function emitAtRuleStatement(node: AtRuleStatement, frame: Frame, e: Emit): void {
  /*
   * [diagnostic] An SCSS `@debug`/`@warn`/`@error` is not CSS output: report (or
   * halt) and emit nothing. Guards every emission route that funnels through
   * here. The marker (not the name) scopes this to SCSS.
   */
  if (isDiagnosticStatement(node)) {
    emitDiagnosticDirective(node, frame, e);
    return;
  }

  /*
   * [charset] Inline `@charset` occurrences are dropped; `serialize` hoists the
   * first to the document top (dedupe).
   */
  if (isCharset(node)) {
    return;
  }
  const target = e.context === undefined ? null : cssImportTarget(node);
  emitAtRuleStatementRaw(node, frame, e, target);
}

/**
 * A CSS import target is parser-classified syntax, not an opaque prelude.
 * Return the typed direct quote or `url(...)` without inspecting target bytes;
 * their distinct transformation policies remain owned by typed evaluation.
 */
function cssImportTarget(node: AtRuleStatement): Quoted | Url | null {
  if ((node.name !== '@import'
    && (node.name.length !== 7
      || node.name.charCodeAt(0) !== 64
      || (node.name.charCodeAt(1) | 32) !== 105
      || (node.name.charCodeAt(2) | 32) !== 109
      || (node.name.charCodeAt(3) | 32) !== 112
      || (node.name.charCodeAt(4) | 32) !== 111
      || (node.name.charCodeAt(5) | 32) !== 114
      || (node.name.charCodeAt(6) | 32) !== 116))
    || node.prelude === null) {
    return null;
  }
  const target = node.prelude.type === 'Sequence' ? node.prelude.parts[0] : node.prelude;
  return target !== undefined && (isStaticQuoted(target) || target.type === 'Url') ? target : null;
}

/**
 * Emit the one typed Less import-query feature with its parser-owned inner
 * comment boundary. Every other tail remains on the canonical query evaluator.
 */
function putImportTail(node: ValueNode, frame: Frame, e: Emit): void {
  if (node.type !== 'Block' || isValueSlotArray(node.value)
    || node.value.type !== 'Operation' || node.value.operator !== ':') {
    put(e, evalQueryPreludeSync(node, frame, e));
    return;
  }
  const boundary = valueBoundaryTriviaOf(node.value)?.between ?? null;
  if (boundary === null) {
    put(e, evalQueryPreludeSync(node, frame, e));
    return;
  }
  put(e, delimiterOpen(node.delimiter));
  put(e, evalQueryPreludeSync(node.value.left, frame, e));
  put(e, ':');

  /* The boundary is the whole authored run after the `:`, its padding included. */
  putValueBoundaryTrivia(e, boundary, ' ');
  put(e, evalQueryPreludeSync(node.value.right, frame, e));
  put(e, delimiterClose(node.delimiter));
}

/** Write one direct import target plus its typed, parser-laid-out tail. */
function emitImportPrelude(
  prelude: ValueNode,
  target: Quoted | Url,
  transformedQuoted: string | null,
  frame: Frame,
  e: Emit,
  between: AstSourceSpan | null = null
): void {
  if (target.type === 'Url') {
    put(e, evalQueryPreludeSync(target, frame, e));
  } else if (target.escaped) {
    put(e, transformedQuoted ?? target.value);
  } else {
    put(e, target.quote);
    put(e, transformedQuoted ?? target.value);
    put(e, target.quote);
  }
  if (prelude.type !== 'Sequence') {
    return;
  }
  const separators = valueLayoutOf(prelude);
  for (let index = 1; index < prelude.parts.length; index++) {
    if (index === 1 && between !== null) {
      putValueBoundaryTrivia(e, between, ' ');
    } else {
      put(e, authoredSpace(separators?.[index - 1]));
    }
    putImportTail(prelude.parts[index]!, frame, e);
  }
}

function emitAtRuleStatementRaw(
  node: AtRuleStatement,
  frame: Frame,
  e: Emit,
  importTarget: Quoted | Url | null
): void {
  const start = e.chunks.length;
  e.lastDeclCustom = false; // [compress] an at-rule statement is not a custom property
  const idt = blockIndent(e);
  if (idt) {
    put(e, idt);
  }
  const transformedImport = importTarget?.type !== 'Quoted'
    ? null
    : e.context?.transformUrl(importTarget.value, true, 'import') ?? importTarget.value;
  const importBoundary =
    e.compress === true || importTarget === null || node.prelude === null
      ? undefined
      : valueBoundaryTriviaOf(node.prelude);
  if (importTarget !== null && node.prelude !== null && importBoundary !== undefined) {
    put(e, node.name);
    putValueBoundaryTrivia(e, importBoundary.before, ' ');
    emitImportPrelude(
      node.prelude,
      importTarget,
      transformedImport,
      frame,
      e,
      importBoundary.between
    );
    putValueBoundaryTrivia(e, importBoundary.after, '');
    put(e, ';\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
    return;
  }

  /*
   * An escaped target is Less syntax, not CSS: it is written as its content
   * (`@import (css) ~"a.css"` → `@import a.css`), never as authored.
   */
  const authored = e.compress === true || (importTarget?.type === 'Quoted' && (importTarget.escaped || transformedImport !== importTarget.value))
    ? null
    : authoredStatementWithTrivia(node, e);
  if (authored !== null) {
    put(e, authored);
    put(e, '\n');
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
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
    if (importTarget?.type === 'Quoted' && transformedImport !== null && transformedImport !== importTarget.value) {
      put(e, ' ');
      emitImportPrelude(node.prelude, importTarget, transformedImport, frame, e);
    } else {
      const p = evalQueryPreludeSync(node.prelude, frame, e).replace(/^\s+/u, '');
      if (p.length > 0) {
        put(e, ' ');
        put(e, p);
      }
    }
  }
  put(e, declEnd(e));
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
  }
}

/**
 * Ask the module's PROVIDING plugin (matched by the module specifier's extension)
 * whether the configured names are valid knobs (spec R6 Part E §E.4). A provider
 * that does not implement the hook — `plugin-less`, which is permissive — accepts
 * every name. Rejections become an eval diagnostic. Core owns the scope write.
 */
function validateModuleConfig(
  node: StyleImport,
  specifier: string,
  config: StyleImportConfig,
  moduleRules: readonly Statement[],
  e: Emit
): void {
  const plugins = e.context?.plugins;
  if (!plugins || plugins.length === 0) {
    return;
  }

  /* The module specifier's extension (with leading dot), matched only within the
     final path segment so it never runs back across a `/` or `.`. */
  const extMatch = /\.[^./\\]+$/.exec(specifier);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  if (ext === '') {
    return;
  }
  const provider = plugins.find(plugin =>
    plugin.supportedExtensions?.some(supported => supported.toLowerCase() === ext));
  const rejections: readonly ModuleConfigRejection[] | void = provider?.applyModuleConfig?.({
    kind: config.kind,
    moduleRules,
    bindings: config.bindings.map(binding => ({ name: binding.name }))
  });
  if (rejections && rejections.length > 0) {
    const first = rejections[0]!;
    throw moduleConfigRejected(node, first.message, first.name, e);
  }
}

function moduleConfigRejected(node: StyleImport, message: string, name: string, e: EvalCtx): JessError {
  return new JessError({
    code: 'eval/module-config-rejected',
    phase: 'eval',
    node,
    ...callSiteLocation(node, e),
    summary: message,
    reason: message,
    meta: { reason: message, name }
  });
}

/**
 * Structural equality that ignores span slots (`_s`/`_e` and other `_`-prefixed
 * provenance), so two textually-identical config blocks authored at different
 * source positions compare equal. Used to tell an idempotent re-`set` from a
 * CONFLICTING reconfiguration (spec R6 Part E §E.4/E-d).
 */
function structurallyEqualIgnoringSpans(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray || bArray) {
    if (!aArray || !bArray || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!structurallyEqualIgnoringSpans(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const aEntries = Object.entries(a).filter(([key]) => !key.startsWith('_'));
  const bEntries = Object.entries(b).filter(([key]) => !key.startsWith('_'));
  if (aEntries.length !== bEntries.length) {
    return false;
  }
  const bByKey = new Map(bEntries);
  return aEntries.every(([key, value]) => bByKey.has(key) && structurallyEqualIgnoringSpans(value, bByKey.get(key)));
}

/**
 * Two configurations conflict unless they set the same names to the same values;
 * the `with`/`set` spelling is not part of that identity (a `with` that merely
 * restates a recorded `set` is not a reconfiguration).
 */
function sameModuleConfig(a: StyleImportConfig, b: StyleImportConfig): boolean {
  return structurallyEqualIgnoringSpans(a.bindings, b.bindings);
}

/**
 * Build the isolated scope a configured `@compose`d module evaluates under, and
 * overlay its configuration (spec R6 Part E). This is the MIXIN-CALL/loop-body
 * model: the module's built AST is the reusable definition, and this frame is the
 * overlay the ordinary body emitter walks ONCE — the module is NOT re-spliced into
 * the importer's scope. The frame is its OWN root (`parent: null`) so the importer's
 * locals stay invisible (isolation); configuration OVERWRITES the module's
 * outer-scope binding so every reference — and every derived variable — sees the
 * configured value.
 *
 * Config is SEEDED into the overlay frame BEFORE the module body evaluates, into
 * BOTH binding stores so it wins in every dialect:
 * - scoped `@name`/`$^name` (Less `@x`, SCSS `!default`): the `reassign` store,
 *   consulted before a frame's own last-wins declarations in
 *   {@link lookupScopedBinding} — "overwrite the outer-scope binding".
 * - live `$name` (`.jess` `?:`): the cell store. A knob is an if-absent write
 *   (`$x ?: blue` / `$x: blue !default`); once config has seeded the cell, the
 *   module's own if-absent declaration finds it and NO-OPS, so config wins. A
 *   HARD `$x:` would clobber the seed, which is exactly why a non-knob name is
 *   rejected by the providing plugin (`applyModuleConfig`) rather than configured.
 *
 * The config VALUES were authored in the importer's file, so they evaluate in the
 * importer frame (cell `valueFrame` / `bindingValueFrames`): once, when execution
 * reaches the edge that configured the module ({@link snapshotModuleConfig}).
 */
function configuredModuleFrame(
  statements: Statement[],
  config: NonNullable<StyleImport['config']>,
  importerFrame: Frame
): Frame {
  const frame = unconfiguredModuleFrame(statements);
  seedModuleConfig(frame, config.bindings, importerFrame);
  return frame;
}

/** Seed configuration bindings into both of a module frame's binding stores ({@link configuredModuleFrame}). */
function seedModuleConfig(frame: Frame, bindings: readonly VariableDeclaration[], importerFrame: Frame): void {
  const reassign = frame.reassign ??= new Map();
  const cells = frame.cells ??= new Map();
  const bindingValueFrames = frame.bindingValueFrames ??= new Map();
  for (const binding of bindings) {
    reassign.set(binding.name, binding);
    cells.set(binding.name, {
      declaration: binding,
      value: binding.value,
      valueFrame: importerFrame,
      evaluated: null,
      prev: null
    });
    bindingValueFrames.set(binding.value, importerFrame);
  }
}

/**
 * Module configuration is a snapshot (Sass semantics): when execution reaches
 * the edge that configured the module, each configured value is evaluated once,
 * in the importer, and the module binds that result, as a mixin binds an
 * argument ({@link eagerSnapshot}). A later write in the importer does not reach
 * the module. A ruleset or a mixin call stays bound by reference. Before this
 * point (a namespace read the planner published early, ruling J6c) the value is
 * read where it stands.
 */
function snapshotModuleConfig(activation: ComposeActivation, e: EvalCtx): MaybePromise<void> {
  const config = activation.config!;
  const importerFrame = activation.importerFrame!;
  const values = config.bindings.map((binding): MaybePromise<CallValue> => {
    const value = binding.value;
    return isMixinCallValue(value) || isTypedCallValue(value) || (!isValueSlotArray(value) && isValueBlock(value))
      ? value
      : eagerSnapshot(value, importerFrame, e);
  });
  return combineAll(values, (resolved) => {
    seedModuleConfig(activation.frame, config.bindings.map((binding, index) => resolved[index] === binding.value
      ? binding
      : variableDeclaration(binding.name, resolved[index]!, binding.write)), importerFrame);
  });
}

/**
 * An UNCONFIGURED `@compose` module also evaluates in its own isolated overlay
 * frame (`parent: null`), so its body's nested `@compose`/`@import` publish into
 * THIS frame and never leak up to the importer — `@compose` is non-transitive,
 * unlike the transitively-leaky `@import`. The importer reaches the module's own
 * members only through the namespace binding built by {@link publishComposedModule}.
 */
function unconfiguredModuleFrame(statements: Statement[]): Frame {
  return {
    parent: null,
    mixins: collectMixins(statements),
    declIndex: collectDeclIndex(statements),
    cells: null,
    reassign: null,
    statements,
    sourceOwner: null
  };
}

/**
 * The activation a value block's members live in when the block is a composed
 * module's namespace, else `null`. {@link publishComposedModule} binds the
 * namespace block over its module frame's own `statements`, so a block whose
 * lexical frame was built over that very body IS the module, already activated.
 */
function composedModuleFrame(rules: readonly Statement[], lexicalFrame: Frame | null): Frame | null {
  return lexicalFrame !== null && lexicalFrame.statements === rules ? lexicalFrame : null;
}

/**
 * A `@compose` stylesheet module exports no functions: `.name(args)` on its
 * namespace is a mixin call, which is a statement (ledger A8, R6 §D.3). So a
 * call on one of its members outside a statement is an error, never a silently
 * dropped call — unless the member is a value lambda (a block yielding
 * `result:`, which is what a dialect function lowers to).
 */
function rejectComposedMemberCall(node: Reference, member: DeclEntry | undefined, symbol: string): void {
  const value = member?.value;
  if (value !== undefined && !isValueSlotArray(value) && value.type === 'AnonymousMixin'
    && lambdaResultValue(value.rules) !== undefined) {
    return;
  }
  const reason = `"${symbol}" cannot be called as a value: a @compose stylesheet module has no member functions `
    + '(its `.name()` is a mixin call, a statement); functions come from @use script modules.';
  throw new JessError({
    code: 'eval/invalid-function',
    phase: 'eval',
    node,
    summary: 'Invalid function call',
    reason,
    meta: { name: symbol, reason }
  });
}

/* A usable module namespace identifier (the same ident shape the grammars use). */
const MODULE_NAMESPACE_IDENT = /^-?[_a-zA-Z\u0080-\uFFFF][-_a-zA-Z0-9\u0080-\uFFFF]*$/;

/**
 * The auto-derived `@compose`/`@use` namespace: Sass's default-namespace rule
 * applied to the SPECIFIER STRING the author wrote (never the plugin-resolved
 * path). Take the last `/`-segment, strip a trailing file extension, strip a
 * leading `_` partial marker or `#` package-import marker. `./foo.less` → `foo`,
 * `#sass/map` → `map`, `#less` → `less`, `@co/design-tokens` → `design-tokens`,
 * `./_theme.scss` → `theme`. Returns
 * `null` when the result is not a usable identifier — the author must then
 * spell an explicit `as <name>`.
 */
function deriveModuleNamespace(specifier: string): string | null {
  /* Last `/`-segment, then strip a trailing `.ext` (only when a name precedes the
     dot) and a leading `_` or `#` marker. Regex-based to keep `serialize.ts` free
     of `lastIndexOf` (the diagnostic cold-path guard bans it). */
  const segment = /[^/]*$/.exec(specifier)?.[0] ?? specifier;
  const withoutExt = segment.replace(/^(.+)\.[^.]+$/, '$1');
  const base = withoutExt.startsWith('_') || withoutExt.startsWith('#') ? withoutExt.slice(1) : withoutExt;
  return MODULE_NAMESPACE_IDENT.test(base) ? base : null;
}

/**
 * Expose a composed module's OWN top-level members to the importer per its `as`
 * clause, WITHOUT splicing its body into the importer frame (that emission is a
 * separate isolated walk under `bodyFrame`). `namespace` follows the grammar
 * convention: `'*'` merges members unqualified, a name binds them under
 * `@<name>`, and `null` auto-derives from the specifier.
 *
 * A named module binds `@<ns>` to a value block over the activation's OWN body
 * (`bodyFrame.statements`, never a re-loaded copy of the document), so member
 * lookups resolve in the isolated `bodyFrame` ({@link composedModuleFrame}) —
 * `@ns.member` (and the chained `@ns.map.key` from the forward member-access
 * chain) reaches the module's own facts and nothing its sub-modules composed.
 */
function publishComposedModule(
  node: StyleImport,
  importerFrame: Frame,
  bodyFrame: Frame,
  specifier: string,
  rank: SourceRank | null,
  e: EvalCtx
): void {
  const children = bodyFrame.statements!;
  const namespace = node.namespace ?? deriveModuleNamespace(specifier);
  if (namespace === '*') {
    /*
     * `as *`: the module's OWN top-level members merge unqualified into the
     * importer. Each variable member is a scoped fact, filed at the compose's
     * position, that reads the member in the activation through the store a
     * namespace member is read through ({@link memberLookup}), so it sees what
     * `@ns.name` sees: the configured binding, and after the module has run,
     * its final one (spec R6 §E.1). The live binding is a write, made when
     * execution reaches the compose ({@link bindComposedLiveMembers}).
     */
    eachComposedVariableMember(children, (child, index) => {
      const read = variableReference(child.name, memberLookup(bodyFrame, child.name));
      const member = variableDeclaration(child.name, read, { mode: 'declare' });
      publishImportedVariableDeclaration(importerFrame, member, importedFactRank(rank, index));
      (importerFrame.bindingValueFrames ??= new Map()).set(read, bodyFrame);
    });
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (child.type === 'MixinDefinition') {
        publishImportedMixinDefinition(importerFrame, child, true, importedFactRank(rank, index));
      } else if (child.type === 'Ruleset') {
        /*
         * ponytail: publishes the ruleset for namespace descent + reference, but NOT
         * the synthesized zero-arg `.name()` callable fact that a flat `@import` adds
         * (publishImportedDocumentFacts). `as *` is the discouraged path; wire the
         * ordered-mixin publish here if a bare `.name()` call across `as *` is needed.
         */
        publishImportedRuleset(importerFrame, child, importedFactRank(rank, index));
      }
    }
    return;
  }
  if (namespace === null) {
    throw moduleConfigRejected(
      node,
      `@compose "${specifier}" cannot derive a namespace from its path; add an explicit "as <name>".`,
      specifier,
      e
    );
  }
  const block = anonymousMixin(children);
  publishImportedVariableDeclaration(importerFrame, variableDeclaration(namespace, block, { mode: 'declare' }), rank);
  bindDetached(importerFrame, block, bodyFrame, bodyFrame.sourceOwner ?? null);
}

/** Each variable member a composed module exposes: every name once, at its first top-level declaration. */
function eachComposedVariableMember(
  children: readonly Statement[],
  visit: (declaration: VariableDeclaration, index: number) => void
): void {
  const seen = new Set<string>();
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (child.type === 'VariableDeclaration' && !seen.has(child.name)) {
      seen.add(child.name);
      visit(child, index);
    }
  }
}

/**
 * The live half of an `as *` compose: write each variable member into the
 * importer's live store when execution reaches the compose, as a declaration
 * written there would be (ledger R5: a live `$name` read is execution-ordered).
 * The scoped half is {@link publishComposedModule}'s, which may run earlier.
 */
function bindComposedLiveMembers(node: StyleImport, importerFrame: Frame, bodyFrame: Frame): void {
  if (node.namespace !== '*') {
    return;
  }
  eachComposedVariableMember(bodyFrame.statements!, (child) => {
    const read = variableReference(child.name, memberLookup(bodyFrame, child.name));
    const member = variableDeclaration(child.name, read, { mode: 'declare' });
    const cells = importerFrame.cells ??= new Map();
    cells.set(child.name, {
      declaration: member, value: read, valueFrame: bodyFrame, evaluated: null,
      prev: liveCellPredecessor(cells, member)
    });
  });
}

/**
 * One `@compose` edge's activation: the frame its module evaluates in, and the
 * identity it renders once under. `config` is set when this edge configured the
 * frame, whose values it snapshots in `importerFrame` when execution reaches it
 * ({@link snapshotModuleConfig}).
 */
interface ComposeActivation {
  readonly frame: Frame;
  readonly emitOnceKey: string | undefined;
  readonly config: StyleImportConfig | null;
  readonly importerFrame: Frame | null;
}

/**
 * Activate one `@compose` edge and bind its namespace (or `as *` members) in
 * `importerFrame` at `rank` (spec R6 Part E).
 *
 * The EFFECTIVE configuration (§E.2/E-d): a SHARED config (`set`, and scss
 * `@use … with` lowered to `set`) persists per module IDENTITY (`key`), so a
 * later plain `@compose` of the same module inherits it, and a second SHARED
 * config whose values differ conflicts and rejects (an identical restatement
 * does not). A PER-EDGE `with { … }` (less/jess) is an independent mixin-like
 * instantiation: it uses only its own values, never inherits a recorded shared
 * config, and never conflicts with one. A shared module has ONE activation per
 * identity, which every later edge binds its namespace to.
 *
 * A document-root compose runs this from the import planner (`planned`), before
 * any output statement, so its namespace is published early like an `@import`'s
 * facts (ledger N10, ruling J6c): Less lookups are order-independent, and a read
 * placed before the `@compose` resolves. Any other compose runs it when
 * execution reaches it.
 */
function activateComposeEdge(
  node: StyleImport,
  key: string | undefined,
  children: Statement[],
  specifier: string,
  importerFrame: Frame,
  e: Emit,
  rank: SourceRank | null,
  planned: boolean
): ComposeActivation {
  const authoredConfig = node.config ?? null;
  let config = authoredConfig;
  let configuresPlanned = false;
  if (key !== undefined) {
    const recorded = e.moduleConfigs?.get(key) ?? null;
    if (authoredConfig !== null && authoredConfig.kind === 'set') {
      if (recorded !== null && !sameModuleConfig(recorded, authoredConfig)) {
        throw moduleConfigRejected(
          node,
          `Module "${specifier}" is already configured with a different set of values; a module can only be configured once.`,
          specifier,
          e
        );
      }
      if (recorded === null) {
        /*
         * A shared module renders once, under the configuration of the first
         * edge that loads it. One already loaded without a `set` is already
         * activated, so a later `set` would be silently ignored (ruling J6a).
         * An activation the planner made early for a document-root compose
         * that execution has not reached loaded nothing yet: this `set`, which
         * execution reached first, comes first in source order and configures
         * it (ruling J6c).
         */
        const activated = e.moduleActivations?.get(key);
        configuresPlanned = !planned && activated !== undefined && !e.loadedImports?.has(key) && plannedAhead(activated, e);
        if (e.loadedImports?.has(key) || (activated !== undefined && !configuresPlanned)) {
          throw alreadyLoadedUnconfigured(node, specifier, e);
        }
        (e.moduleConfigs ??= new Map()).set(key, authoredConfig);
      }
    } else if (authoredConfig === null && recorded !== null) {
      /*
       * The `set` this edge would inherit was recorded ahead of output by a
       * document-root edge that execution has not reached yet. This edge comes
       * first in source order, so it loads the module without configuration
       * and the `set` after it is the one J6(a) rejects.
       */
      if (!planned) {
        for (const edge of e.composeActivations?.keys() ?? []) {
          if (edge.config === recorded) {
            throw alreadyLoadedUnconfigured(edge, specifier, e);
          }
        }
      }
      config = recorded;
    }
  }
  const emitOnceKey = (config === null || config.kind === 'set') && e.multipleImportDepth === 0 ? key : undefined;
  let frame = emitOnceKey === undefined ? undefined : e.moduleActivations?.get(emitOnceKey);
  let configures = configuresPlanned;
  if (frame === undefined) {
    if (config !== null) {
      validateModuleConfig(node, specifier, config, children, e);
    }
    frame = config !== null ? configuredModuleFrame(children, config, importerFrame) : unconfiguredModuleFrame(children);
    configures = config !== null;
    if (emitOnceKey !== undefined) {
      (e.moduleActivations ??= new Map()).set(emitOnceKey, frame);
    }
  } else if (configuresPlanned) {
    validateModuleConfig(node, specifier, authoredConfig!, children, e);
    seedModuleConfig(frame, authoredConfig!.bindings, importerFrame);
  }
  publishComposedModule(node, importerFrame, frame, specifier, rank, e);
  return configures
    ? { frame, emitOnceKey, config, importerFrame }
    : { frame, emitOnceKey, config: null, importerFrame: null };
}

/**
 * Whether a module activation is one the planner made for a compose that
 * execution has not reached. Only a configuring `set` edge asks, so the pending
 * planned composes are scanned rather than indexed by frame.
 */
function plannedAhead(frame: Frame, e: Emit): boolean {
  const pending = e.composeActivations?.values();
  if (pending === undefined) {
    return false;
  }
  for (const activation of pending) {
    if (activation.frame === frame) {
      return true;
    }
  }
  return false;
}

function alreadyLoadedUnconfigured(node: StyleImport, specifier: string, e: EvalCtx): JessError {
  return moduleConfigRejected(
    node,
    `Module "${specifier}" was already loaded without configuration; only the first import of a module can configure it with "set".`,
    specifier,
    e
  );
}

/**
 * Emit a typed import. With a driver-supplied document capability, a loaded
 * canonical document executes at this exact source-order point in `frame`.
 * Core deliberately knows neither paths nor parser plugins; a declined request
 * remains a CSS import statement.
 */
function expandStyleImport(
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
          if (e.referenceImportDepth === 0 && !importHasOption(request.options, 'reference')) {
            emitRawInline(loaded, node, e);
          }
          return;
        }

        /*
         * A `@compose` (spec R6 Part E) evaluates the module in its own isolated
         * overlay frame (like a mixin-call body), NOT spliced into the importing
         * frame: its own nested `@compose`/`@import` stay local, so `@compose` is
         * non-transitive (unlike the transitively-leaky `@import`). A
         * document-root compose was activated, and its namespace bound, by the
         * import planner ({@link activateComposeEdge}); any other is activated
         * here. Either way an `as *` compose writes its live bindings here, at
         * its position ({@link bindComposedLiveMembers}).
         *
         * Emit-once dedup keyed on module IDENTITY for SHARED modules — a plain
         * import/compose, an inherited `set`, or an authored `set`. A shared module
         * is a singleton: it renders ONCE, and a later plain/inherited import of the
         * same identity does NOT re-emit. A PER-EDGE `with { … }` (less/jess only)
         * is a distinct instantiation — like a mixin call with its own params — so
         * it bypasses the dedup and each edge renders its own output.
         */
        const children = loaded.document?.rules ?? [];
        const isCompose = node.mode === 'compose';
        let activation: ComposeActivation | undefined;
        let configured: MaybePromise<void> = undefined;
        if (isCompose) {
          activation = e.composeActivations?.get(node);
          if (activation === undefined) {
            activation = activateComposeEdge(
              node, loaded.key, children, request.specifier, frame, e, importSiteRank(frame, node), false
            );
          } else {
            e.composeActivations!.delete(node);
          }
          configured = activation.config === null ? undefined : snapshotModuleConfig(activation, e);
          bindComposedLiveMembers(node, frame, activation.frame);
        }
        const bodyFrame = activation?.frame ?? frame;
        const emitOnceKey = request.options !== null || e.multipleImportDepth !== 0
          ? undefined
          : activation === undefined ? loaded.key : activation.emitOnceKey;
        const seen = e.loadedImports ??= new Map();
        if (emitOnceKey !== undefined) {
          if (seen.has(emitOnceKey)) {
            if (isCompose) {
              if (seen.get(emitOnceKey) === null) {
                throw moduleConfigRejected(
                  node,
                  `Module "${request.specifier}" was already loaded by @import, which folds it into the importing scope; it cannot also be composed as an isolated module.`,
                  request.specifier,
                  e
                );
              }

              /*
               * Rendered once already; the module is loaded from this sheet too, so
               * this sheet's extends reach it (ledger X14).
               */
              if (e.dynamicExtend !== null) {
                composedModuleBoundary(e.dynamicExtend.moduleBoundaries, emitOnceKey, e.dynamicExtend.boundary);
              }
            }
            return;
          }
          seen.set(emitOnceKey, isCompose ? bodyFrame : null);
        } else if (isReferenceReimport(
          node, request.options, e.multipleImportDepth !== 0,
          loaded.key !== undefined && e.placedDocuments?.has(loaded.key) === true
        )) {
          return;
        } else if (loaded.key !== undefined && isVisibleMultiple(node, request.options, e.referenceImportDepth !== 0)) {
          seen.set(loaded.key, null);
        }
        if (!isCompose && loaded.key !== undefined) {
          (e.placedDocuments ??= new Set()).add(loaded.key);
        }
        const publishChildren = mapMaybe(configured, () => isCompose || hasPrepublishedImportFact(e, node)
          || e.prepublishedModuleImports?.get(frame)?.has(node) === true
          ? undefined
          : publishImportedDocumentFacts(children, frame, e, false, importSiteRank(frame, node)));

        /*
         * Published UNCONDITIONALLY here, before the document is remembered and
         * outside `withinDocument` — the position the synchronous engine used.
         * The driver's `withinDocument` callback is not a place to put facts the
         * import must publish exactly once.
         */
        return mapMaybe(publishChildren, () => {
          if (loaded.document === null) {
            return;
          }
          rememberImportedCallableBodies(loaded.document, loaded.document.rules, e.context);
          const emitDocument = () => emitLoaded
            ? emitLoaded(loaded.document!, bodyFrame)
            : emitDocumentStatements(loaded.document!.rules, bodyFrame, e, importDocument, true);

          /*
           * The StyleImport itself has NO postlude to honour: the loaded document
           * simply executes at this lexical position. A legacy `@import` + media
           * query is wrapped by the less grammar in a `@media` `AtRuleBlock` whose
           * body is this StyleImport, so the media wrap is an ENCLOSING node here,
           * not something this emitter reconstructs from a tail.
           *
           * [extend] A `(reference)` or `(multiple)` import is its own render
           * placement, the one the planner gave its static facts (a fresh one for an
           * import the planner never reached); any other import emits in its
           * importer's. [extend/dynamic] A composed module or `(reference)` sheet
           * records its walk facts inside its own extend boundary (ledger X14).
           */
          const ownReference = importHasOption(request.options, 'reference');
          const planned = e.importPlacements?.get(e.importPlacement)?.get(node);
          const placement = planned?.token
            ?? (ownReference || importHasOption(request.options, 'multiple') ? {} : e.importPlacement);
          const dyn = e.dynamicExtend;
          let boundary = dyn?.boundary ?? null;
          if (dyn !== null && isCompose) {
            boundary = composedModuleBoundary(dyn.moduleBoundaries, loaded.key, boundary);
          }
          if (dyn !== null && ownReference) {
            boundary = planned?.boundary ?? { parents: [boundary] };
          }
          const emit = (): MaybePromise<void> => {
            const outerPlacement = e.importPlacement;
            const outerBoundary = dyn?.boundary ?? null;
            if (placement === outerPlacement && boundary === outerBoundary) {
              return emitDocument();
            }
            e.importPlacement = placement;
            if (dyn !== null) {
              dyn.boundary = boundary;
            }
            return settled(emitDocument, () => {
              e.importPlacement = outerPlacement;
              if (dyn !== null) {
                dyn.boundary = outerBoundary;
              }
            });
          };

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
              mapMaybe(activateBodyDependencies(loaded.document!.rules, bodyFrame, e), () => {
                /*
                 * Splice the imported document's own leading block comment (e.g. a
                 * `/*!` license banner) at the import site. This must run for a
                 * TOP-LEVEL import too (`e.depth === 0`): the importing document's
                 * leading-comment pass reads the importer's trivia, never the loaded
                 * file's, so without this a banner on the first imported file (the
                 * bootstrap4 shape: a one-line entry that only `@import`s the framework)
                 * was left unemitted here and swept to the output tail.
                 */
                if (e.referenceImportDepth === 0) {
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
      if (e.referenceImportDepth === 0) {
        emitCssImportAtRule(node, frame, e);
      }
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
    const target = node.target.type === 'Url' ? node.target.value : node.target;
    if (target.type === 'Quoted') {
      return quotedContentSync(target, frame, e);
    }
    const bytes = evalBytesSync(node.target, frame, e);
    return bytes.startsWith('url(') && bytes.endsWith(')') ? bytes.slice(4, -1) : bytes;
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
function emitCssImportAtRule(node: StyleImport, frame: Frame, e: Emit, mediaQuery = ''): void {
  const start = e.chunks.length;
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
  if (mediaQuery.length > 0) {
    put(e, ' ');
    put(e, mediaQuery);
  }
  put(e, ';\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
  }
}

/**
 * A context-backed render receives this directive's loaded module through the
 * compiler dependency plan and activates its bindings before walking the body,
 * so it emits no CSS. Context-free serialization preserves the syntax for AST
 * round-trip tools that deliberately do no IO.
 */
function emitModuleImport(node: ModuleImport, frame: Frame, e: Emit): void {
  if (e.context) {
    return;
  }
  const start = e.chunks.length;
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
    e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
  }
}

/** Write a grammar-owned opaque at-rule body without evaluating or walking it. */
function emitUnknownAtRuleBlock(node: UnknownAtRuleBlock, e: Emit): void {
  const start = e.chunks.length;
  const idt = blockIndent(e);
  if (idt) {
    put(e, idt);
  }
  put(e, node.name);
  if (node.prelude !== null && node.prelude.length > 0) {
    put(e, e.compress === true && node.prelude.charCodeAt(0) === 0x28 /* ( */ ? '' : ' ');
    put(e, node.prelude);
  }
  put(e, e.compress === true ? '{' : ' {');
  put(e, node.rawBody);
  put(e, e.compress === true ? '}' : '}\n');
  if (e.positions) {
    e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
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
function emitRawInline(loaded: ImportDocumentInline, node: StyleImport, e: Emit): void {
  /*
   * Indent the spliced raw bytes to the current nesting depth, so `(inline)`
   * content inside a bubbleable at-rule lines up with authored at-rule-body
   * content (owner 2026-09-02). Root splices (depth 0) stay at column 0.
   */
  if (blockIndent(e)) {
    put(e, blockIndent(e));
  }
  const text = loaded.inline;
  if (e.positions === null || loaded.file === undefined) {
    put(e, text);
  } else {
    /* Source maps: one chunk per line, each mapped to that line of the inlined file. */
    for (let at = 0; at < text.length;) {
      const end = text.indexOf('\n', at);
      const next = end === -1 ? text.length : end + 1;
      const start = e.chunks.length;
      put(e, text.slice(at, next));
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: loaded.file, sourceStart: at });
      at = next;
    }
  }
  put(e, nl(e));
}

/**
 * [P37] Whether a value a call leaves in statement position may stand there,
 * per value type, at the two statement positions: the stylesheet root and a
 * declaration list (a ruleset body). The two-position shape is AST v1's
 * `allowRoot` / `allowRuleRoot` (2.0.0-alpha.1), where only statement node
 * types were legal and every value node was not.
 *
 * A call can only produce a value, never a statement node. The one value that
 * is statement text is `Any` — raw text or an escaped string, what `e()`
 * returns (`e('…');`), and the empty result of a function that returns nothing.
 * That row is the owner's ruling (P37: "raw text or an escaped string"), not a
 * v1 port: v1's `Anonymous` carried neither flag. Every other value — a
 * dimension, colour, keyword, and the call written back out as-is because it
 * produced no result — is a value dumped into a statement position.
 *
 * Only value rows are checked, because a call cannot return a statement node.
 * For the statement node types alpha.1 answered: a declaration is legal only
 * in a declaration list, an at-rule only at the stylesheet root, and a
 * ruleset, comment, variable declaration, extend or control statement in
 * both. The at-rule "no" for a declaration list conflicts with nested `@media`
 * being legal inside a ruleset; it is recorded here, not acted on, since no
 * statement node reaches this check.
 */
const STATEMENT_RESULT_POSITIONS: Readonly<Record<Value['type'], readonly [root: boolean, declarationList: boolean]>> = {
  Any: [true, true],
  Block: [false, false],
  Bool: [false, false],
  Collection: [false, false],
  Color: [false, false],
  Dimension: [false, false],
  Keyword: [false, false],
  List: [false, false],
  Null: [false, false],
  Quoted: [false, false],
  Url: [false, false]
};

/**
 * [P37] Evaluate a call standing alone in statement position, once, and hold
 * its result to {@link STATEMENT_RESULT_POSITIONS} for the position it lands in.
 * The call is DEMANDED: a CSS colour or gradient call is dispatched rather than
 * kept as authored bytes, so one left as a plain CSS call is caught too.
 * Constructs a dialect lowers (Less `each()`/`if()`, mixin calls) never arrive
 * here as a `FunctionCall`.
 */
function evalStatementCall(node: FunctionCall, frame: Frame, e: Emit): MaybePromise<ValueGroup> {
  const position = e.depth === 0 ? 0 : 1; // read now: an async result settles after the walk has moved on
  return mapMaybe(evalTyped(node, frame, e), (value) => {
    const legal = !isValueGroupArray(value) && STATEMENT_RESULT_POSITIONS[value.type][position];
    if (!legal) {
      throw ERR.invalidStatement({
        node,
        ...callSiteLocation(node, e),
        meta: { what: `The result of "${node.name}()", ${isValueGroupArray(value) ? 'a value list' : `a ${value.type}`} \`${emitValue(value)}\`,` }
      });
    }
    return value;
  });
}

/** The emitted bytes of a statement call's result (see {@link evalStatementCall}). */
function statementCallBytes(node: FunctionCall, frame: Frame, e: Emit): MaybePromise<string> {
  return mapMaybe(evalStatementCall(node, frame, e), value => emitValueC(value, e));
}

/**
 * A bare value-position call in statement position (e.g. `e('…');`): Less
 * evaluates it and prints the result bytes as a standalone line (an `Any`
 * at document scope — no trailing `;`), so an `e(...)` escape emits its inner
 * text. Emitted at the current indent; an empty result contributes nothing.
 */
function emitCallStatement(node: FunctionCall, frame: Frame, e: Emit): MaybePromise<void> {
  const start = e.chunks.length;
  return mapMaybe(statementCallBytes(node, frame, e), (bytes) => {
    if (bytes.length === 0) {
      return;
    }
    if (blockIndent(e)) {
      put(e, blockIndent(e));
    }
    put(e, bytes);
    put(e, nl(e));
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
  });
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

/** A prelude fragment whose grammar owns its bytes (not merely their values). */
type SupportsPreludePart = { bytes: string; protected: boolean };

/*
 * A value the prelude walker evaluated is written as evaluated: a string, a
 * resolved variable, a splice, an authored run between list items are protected
 * parts, never scanned for the quotes or comments they hold. The normalizers
 * below space the walker's own glue (parens, a feature colon, an operator, a
 * list separator, a sequence space) and two inputs the grammar leaves
 * unstructured, which they scan for quotes and comments:
 * - a raw fragment ({@link preludeLeaf}): css builds a `style()` query's
 *   argument as one (`--responsive: true`, where Less builds a feature), and
 *   every dialect a custom-property value in a `style()` feature;
 * - a call other than a condition call ({@link conditionFeature}), written as
 *   its evaluated bytes: a value call in a feature value (`calc()`, `env()`) and
 *   a `style()` whose argument is not one feature (`style((--a: 1) and (--b:
 *   2))`), which the grammar does not mark as query syntax.
 */
const leaf = (bytes: string): SupportsPreludePart[] => [{ bytes, protected: true }];

/**
 * The separator before a list's item `index` in a prelude: the walker's own
 * glue, spaced as glue is (a ratio's `/` tightens under compress), or the
 * authored run written there, as written.
 */
function listBoundaryPart(authored: readonly (string | undefined)[] | undefined, index: number, glue: string, compress: boolean): SupportsPreludePart[] {
  const run = itemBoundary(authored?.[index - 1], glue, compress);
  return [{ bytes: run, protected: run !== glue }];
}

/** A value evaluated before the walk reached it: a list's items as written, joined as an authored list is ({@link listBoundaryPart}). */
function typedPreludeParts(value: ValueGroup, compress: boolean): SupportsPreludePart[] {
  if (isValueGroupArray(value) || value.type !== 'List') {
    return leaf(emitValue(value));
  }
  const glue = sepGlue(value.sep, compress);
  const authored = valueLayoutOf(value);
  const parts: SupportsPreludePart[] = [];
  for (let index = 0; index < value.value.length; index += 1) {
    if (index > 0) {
      parts.push(...listBoundaryPart(authored, index, glue, compress));
    }
    parts.push(...leaf(emitValue(value.value[index]!)));
  }
  return parts;
}

/**
 * One leaf of a prelude. An `Any` the parser left as a raw prelude fragment is
 * source text nothing structured, so it is spaced like glue; an `Any` that is a
 * mixin argument's snapshot holds the value the argument was evaluated to
 * ({@link carrySnapshot}), and a list it bound as written is joined as the
 * list written directly is.
 */
function preludeLeaf(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<SupportsPreludePart[]> {
  if (!isValueSlotArray(node) && node.type === 'Any') {
    const carried = e.snapshotValues?.get(node);
    if (carried === undefined) {
      return mapMaybe(evalBytes(node, frame, e), bytes => [{ bytes, protected: false }]);
    }
    if (!isValueGroupArray(carried) && carried.type === 'List' && emitAsWritten(carried) === node.src) {
      return typedPreludeParts(carried, e.compress === true);
    }
  }
  return mapMaybe(evalBytes(node, frame, e), leaf);
}

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
 *
 * A string or comment it meets is copied as written. Only a call the walker
 * writes as bytes or a raw fragment can still hold one ({@link leaf}).
 */
function normalizeSupportsBytes(p: string, compress = false): string {
  let out = '';
  let plainStart = 0;
  const appendPlain = (end: number): void => {
    const run = p.slice(plainStart, end).replace(/\s+/gu, ' ').replace(/\(\s+/gu, '(').replace(/\s+\)/gu, ')');

    // [compress] tighten the declaration colon inside a `@supports (prop: val)` test.
    out += compress ? run.replace(/\s*:\s*/gu, ':') : run;
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

/**
 * Normalize a prelude's plain fragments with the at-rule's byte normalizer; a
 * protected fragment (a [general-enclosed] group) passes through as written.
 */
function normalizePreludeParts(
  parts: readonly SupportsPreludePart[],
  normalize: (bytes: string, compress: boolean) => string,
  compress = false
): string {
  let out = '';
  let plain = '';
  const flushPlain = (): void => {
    if (plain.length > 0) {
      out += normalize(plain, compress);
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

  /* A structured [general-enclosed] group is emitted as written, as below. */
  const verbatim = generalEnclosedSourceOf(node);
  if (verbatim !== undefined) {
    return [{ bytes: verbatim, protected: true }];
  }
  if (isValueSlotArray(node)) {
    const authored = valueLayoutOf(node);
    const parts: Array<MaybePromise<SupportsPreludePart[]>> = [];
    for (let index = 0; index < node.length; index += 1) {
      if (index > 0) {
        parts.push(plain(authoredSpace(authored?.[index - 1])));
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
      const open = delimiterOpen(node.delimiter);
      const close = delimiterClose(node.delimiter);
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
      return preludeLeaf(node, frame, e);
  }
}

/**
 * Concatenate prelude fragments in SOURCE order. Stays synchronous while every
 * fragment is settled; only the first awaitable fragment moves the join onto
 * `Promise.all`, which preserves positional order however the tail settles.
 */
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
 * Media and container queries also own `Block` as grammar syntax. Unlike an
 * ordinary value position, evaluating a variable inside `(min-width: @size)`
 * must not erase the feature delimiters.  Keep that structural spelling while
 * delegating all leaf evaluation to the normal value path.
 */
function evalQueryPrelude(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<string> {
  return mapMaybe(evalQueryPreludeParts(node, frame, e), parts => parts.map(part => part.bytes).join(''));
}

/**
 * The fragments of a media/container query prelude, in source order. A
 * [general-enclosed] group (media-queries-4 §3.1) is emitted as written — the
 * source bytes the parser recorded for it — and marked protected: it is syntax
 * a future spec may define, so jess neither normalizes nor evaluates it (no
 * `url()` transform, no function or math evaluation, ledger N8). Its
 * structured AST stays for tooling.
 */
function evalQueryPreludeParts(node: ValueSlot, frame: Frame | null, e: EvalCtx): MaybePromise<SupportsPreludePart[]> {
  const plain = (bytes: string): SupportsPreludePart[] => [{ bytes, protected: false }];
  const verbatim = generalEnclosedSourceOf(node);
  if (verbatim !== undefined) {
    return [{ bytes: verbatim, protected: true }];
  }
  if (isValueSlotArray(node)) {
    const authored = valueLayoutOf(node);
    const parts: Array<MaybePromise<SupportsPreludePart[]>> = [];
    for (let index = 0; index < node.length; index += 1) {
      if (index > 0) {
        parts.push(plain(itemBoundary(authored?.[index - 1], ' ', e.compress === true)));
      }
      parts.push(evalQueryPreludeParts(node[index]!, frame, e));
    }
    return concatPreludeParts(parts);
  }
  switch (node.type) {
    /*
     * [general-enclosed] A template the parser marked because it carries the
     * dialect's interpolation (P16) records no source bytes; it is substituted
     * and then protected, so the call is never evaluated or re-spaced. Only the
     * mark decides: an ordinary call with an interpolated argument
     * (`e("@{w}")` in a feature value) is evaluated as any value is.
     */
    case 'FunctionCall': {
      const payload = isGeneralEnclosedTemplate(node) ? generalEnclosedPayload(node.args) : null;
      if (payload !== null) {
        return mapMaybe(evalBytes(payload, frame, e), content =>
          [{ bytes: `${node.name}(${content})`, protected: true }]);
      }

      /* A condition call (`style(--x: @v)`) holds a feature: it is walked as the feature in parens is. */
      const feature = conditionFeature(node);
      return feature === null
        ? mapMaybe(evalBytes(node, frame, e), plain)
        : concatPreludeParts([plain(`${node.name}(`), evalQueryPreludeParts(feature, frame, e), plain(')')]);
    }
    case 'Block': {
      const open = delimiterOpen(node.delimiter);
      const close = delimiterClose(node.delimiter);
      return concatPreludeParts([plain(open), evalQueryPreludeParts(node.value, frame, e), plain(close)]);
    }
    case 'Operation':
      /*
       * A feature colon and a range comparison are query syntax, and a `/` is a
       * `<ratio>` (media-queries-4 §2.4). Arithmetic is a value: it is computed
       * as the node's math policy says, never written as the operands of its
       * lowering (SCSS `-$x` is `-1 * $x`).
       */
      if (node.operator === '+' || node.operator === '-' || node.operator === '*') {
        return preludeLeaf(node, frame, e);
      }
      return concatPreludeParts([
        evalQueryPreludeParts(node.left, frame, e),
        plain(node.operator === ':' ? ': ' : ` ${node.operator} `),
        evalQueryPreludeParts(node.right, frame, e)
      ]);
    case 'Sequence': {
      const parts: Array<MaybePromise<SupportsPreludePart[]>> = [];
      for (let index = 0; index < node.parts.length; index += 1) {
        if (index > 0) {
          parts.push(plain(' '));
        }
        parts.push(evalQueryPreludeParts(node.parts[index]!, frame, e));
      }
      return concatPreludeParts(parts);
    }
    case 'List': {
      const compress = e.compress === true;
      const glue = sepGlue(node.sep, compress);
      const authored = valueLayoutOf(node);
      const parts: Array<MaybePromise<SupportsPreludePart[]>> = [];
      for (let index = 0; index < node.value.length; index += 1) {
        if (index > 0) {
          parts.push(listBoundaryPart(authored, index, glue, compress));
        }
        parts.push(evalQueryPreludeParts(node.value[index]!, frame, e));
      }
      return concatPreludeParts(parts);
    }
    case 'Lookup':
      /* Var only — see the typed lane above. */
      if (node.kind !== 'var') {
        return mapMaybe(evalBytes(node, frame, e), leaf);
      }
      return mapMaybe(lookupName(node, frame, e), (nm): MaybePromise<SupportsPreludePart[]> => {
        const hit = resolveVarRef(frame, nm, node.scope, e);
        if (!hit) {
          if (hasExcludedVarRef(frame, nm, node.scope, e)) {
            recursiveReference(node, `@${nm}`, 'Variable', e);
          }
          return mapMaybe(evalBytes(node, frame, e), leaf);
        }
        const value = hit.value;
        if (isMixinCallValue(value)) {
          return mapMaybe(evalBytes(node, frame, e), leaf);
        }
        if (hit.evaluated !== null) {
          return typedPreludeParts(hit.evaluated, e.compress === true);
        }
        return withExcluded(e, value, () => evalQueryPreludeParts(value, hit.frame, e));
      });
    case 'Reference': {
      const resolved = resolveReferenceResult(node, frame, e);
      if (resolved === null || isMixinCallValue(resolved.value)) {
        return mapMaybe(evalBytes(node, frame, e), leaf);
      }
      return resolved.evaluated !== null
        ? typedPreludeParts(resolved.evaluated, e.compress === true)
        : evalQueryPreludeParts(resolved.value, resolved.frame, e);
    }
    default:
      /*
       * A string is one protected run, its quotes kept and an escaped one's
       * dropped, so a ratio `~"2/1"` stays tight (`2/1`) rather than ` / `-spaced
       * by the plain-run rules, and spliced content is never scanned for a
       * closing quote ({@link preludeLeaf}).
       */
      return preludeLeaf(node, frame, e);
  }
}

/**
 * The feature a condition call holds — `style(--x: @v)`, `scroll-state(stuck:
 * top)` — when the grammar built it as one query relation, or `null`.
 */
function conditionFeature(node: FunctionCall): Operation | null {
  const only = node.args.length === 1 && !node.args[0]!.spread ? node.args[0]!.value : undefined;
  return only !== undefined && !isValueSlotArray(only) && only.type === 'Operation' && !only.inMathFunction && isQueryRelation(only.operator)
    ? only
    : null;
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
 * A quoted run (`"…"`, `'…'`) or a `/* … *\/` comment passes through untouched.
 * Only a call the walker writes as bytes or a raw fragment can still hold one
 * ({@link leaf}): a string, a resolved variable, a splice and an authored run
 * between list items reach here as protected parts. Every transform is idempotent on an already-canonical
 * prelude (`(min-width: 1024px)`, `screen, print, handheld`, `(a) or (b)`), so
 * already-matching goldens are unaffected.
 */
function normalizeQueryPrelude(p: string, compress = false): string {
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

    // OPAQUE — a quoted string.
    if (c === '"' || c === '\'') {
      let j = i + 1;
      while (j < n && p[j] !== c) {
        j++;
      }
      const stop = j < n ? j + 1 : n;
      out += p.slice(i, stop);
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
      if (d === '/' && p[j + 1] === '*') {
        break;
      }
      j++;
    }
    out += normalizeQueryPlainRun(p.slice(i, j), compress);
    i = j;
  }
  return out;
}

/** [atrule-prelude] Spacing normalization of ONE plain (non-quote/comment) run of
 * a query prelude. See {@link normalizeQueryPrelude} for the rules; each `replace`
 * is idempotent on canonical input. */
function normalizeQueryPlainRun(s: string, compress = false): string {
  if (compress) {
    /*
     * [compress] tighten the feature colon, comparisons, and ratio; keep a single
     * space after `and`/`or`/`not` before `(` (`and(` would tokenize as a function).
     */
    return s
      .replace(/\(\s+/gu, '(')
      .replace(/\s+\)/gu, ')')
      .replace(/\s*:\s*/gu, ':')
      .replace(/\s*\/\s*/gu, '/')
      .replace(/\s*(<=|>=|<|>)\s*/gu, '$1')
      .replace(/\s*,\s*/gu, ',')
      .replace(/[ \t\r\n]{2,}/gu, ' ')
      .replace(/\b(and|or|not)\s*\(/gu, '$1 (');
  }
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
    return mapMaybe(evalSupportsPrelude(node.prelude, frame, e), parts => normalizePreludeParts(parts, normalizeSupportsBytes, e.compress === true));
  }
  if (lname === '@media' || lname === '@container') {
    return mapMaybe(evalQueryPreludeParts(node.prelude, frame, e), parts => normalizePreludeParts(parts, normalizeQueryPrelude, e.compress === true));
  }
  return evalBytes(node.prelude, frame, e);
}

function expandAtRuleBlock(
  node: AtRuleBlock,
  frame: Frame,
  e: Emit,
  ctx: string[] | null = null,
  nestedSource?: NestedHeaderSource | null,
  nestedHoist?: HoistEntry[]
): MaybePromise<void> {
  /*
   * The prelude resolves BEFORE any byte is written, so the rewind marks below
   * still bracket exactly this at-rule's output.
   */
  return mapMaybe(atRulePreludeBytes(node, frame, e), prelude => mapMaybe(mediaImportStayingCss(node, frame, e), (cssImport) => {
    if (cssImport !== null) {
      if (e.referenceImportDepth === 0) {
        emitCssImportAtRule(cssImport, frame, e, prelude);
      }
      return;
    }
    const bodyFrame: Frame = {
      parent: frame,
      mixins: collectMixins(node.rules),
      declIndex: collectDeclIndex(node.rules), cells: null, reassign: null,
      statements: node.rules
    };
    const write = (): MaybePromise<void> => nestedSource === undefined
      ? writeCollapsedAtRuleBlock(node, frame, bodyFrame, e, ctx, prelude)
      : writeNestedAtRuleBlock(node, frame, bodyFrame, e, nestedSource, prelude, nestedHoist);
    const dyn = e.dynamicExtend;
    if (dyn === null) {
      return write();
    }

    /* [extend/dynamic] Facts recorded in the body take this block's scope (§8). */
    const scope = dyn.scope;
    dyn.scope = atRuleScope(scope, node, dyn.atRuleScopes);
    if (node.extendInstructions !== undefined) {
      recordBodyExtends(dyn, node.extendInstructions, e);
    }
    return withDynamicPlacement(dyn, dyn.pathRules.length, scope, dyn.boundary, write);
  }));
}

/**
 * The import a `@media` block wraps, when that import stays a CSS terminal. The
 * Less grammar desugars `@import "x" q;` into `@media q { @import "x"; }` so a
 * LOADED document renders inside the query (ledger A10). An import nothing loads
 * — an unclaimed URL — is a real CSS `@import`, which carries its query
 * verbatim (A10): `@import "x" q;`, since CSS ignores an `@import` inside
 * `@media`. Null for any other block, or when the import loads. The answer is
 * the request `expandStyleImport` then consumes, so nothing is asked twice.
 */
function mediaImportStayingCss(node: AtRuleBlock, frame: Frame, e: Emit): MaybePromise<StyleImport | null> {
  const child = node.rules.length === 1 ? node.rules[0]! : null;
  const importDocument = e.importDocument;
  if (child?.type !== 'StyleImport' || child.mode !== 'import' || importDocument === undefined
    || node.name.toLowerCase() !== '@media' || e.context?.options.processImports === false) {
    return null;
  }
  const planned = e.plannedImportDocuments?.get(child);
  if (planned !== undefined) {
    return planned.loaded === undefined ? child : null;
  }
  const options = importRequestOptions(child.options);
  if (importHasOption(options, 'inline')) {
    return null;
  }
  const request: ImportDocumentRequest = { node: child, specifier: importSpecifier(child, frame, e), options };
  return mapMaybe(importDocument(request), (loaded) => {
    e.plannedImportDocuments?.set(child, { request, loaded });
    return loaded === undefined ? child : null;
  });
}

function writeCollapsedAtRuleBlock(
  node: AtRuleBlock,
  frame: Frame,
  bodyFrame: Frame,
  e: Emit,
  ctx: string[] | null,
  prelude: string
): MaybePromise<void> {
  const markChunks = e.chunks.length;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.chunks.length;
  const idt = blockIndent(e);
  if (idt) {
    put(e, idt);
  }
  const renderedPrelude = (e.compress !== true ? keyframesPreludeWithTrivia(node, e) : null) ?? prelude;
  put(e, node.name);
  if (renderedPrelude.length > 0) {
    /*
     * [compress] `@media (…)`/`@supports (…)` → `@media(…)`: drop the name↔prelude
     * space only when the prelude opens with `(` (still parses); keep it otherwise.
     */
    put(e, e.compress === true && renderedPrelude.charCodeAt(0) === 0x28 /* ( */ ? '' : ' ');
    put(e, renderedPrelude);
  }
  put(e, blockOpen(e));
  const afterHeader = e.chunks.length;
  const emitted = activateBodyDependencies(node.rules, bodyFrame, e);
  const finish = (): MaybePromise<void> => {
    if (e.chunks.length === afterHeader) {
      if (hasBodyBlockCommentTrivia(node, e)) {
        emitBodyBlockCommentTrivia(node, e, INDENT.repeat(e.depth + 1));
      } else {
        // Nothing emitted: drop the whole at-rule (rewind chunks/offset/positions).
        e.chunks.length = markChunks;
        if (e.positions) {
          e.positions.length = markPos;
        }
        return;
      }
    }
    emitBlockClose(e, idt);
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
  };
  return mapMaybe(emitted, () => {
    /*
     * [atrule-nest] this body is a stay-open at-rule context; a bubbleable
     * at-rule that lands inside it nests one level deeper (see walkBody).
     */
    e.atRuleBodyDepth++;
    const rendered = isBubbleable(node.name)

      /*
       * A non-empty selector context propagates inside; null/empty keeps the
       * top-level shape (bare direct decls) but still bubbles nested at-rules out
       * of the body's rulesets.
       */
      ? emitBubbleBody(node.rules, ctx && ctx.length > 0 ? ctx : null, bodyFrame, e, node)
      : emitAtRuleBody(node.rules, bodyFrame, e, node);
    return mapMaybe(rendered, () => {
      e.atRuleBodyDepth--;
      return finish();
    });
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
 * The body's comments are replayed by this walk when it owns the body (`owner`),
 * or by the replay of the body it is inlined into (`inlineTrivia`).
 */
function emitAtRuleBody(
  statements: Statement[],
  frame: Frame,
  e: Emit,
  owner?: object,
  inlineTrivia?: BodyTriviaReplay
): MaybePromise<void> {
  const group: Leaf[] = [];
  const bodyTrivia = owner === undefined ? inlineTrivia : bodyTriviaReplay(owner, e);
  const flushDirect = (): void => {
    const trailingBlockComments = takePendingLeafBlockComments(e, group);
    if (group.length > 0) {
      const mergeMode = mergeGroupMode(group);
      if (mergeMode !== MERGE_NONE) {
        mergeFold(group, e, bodyIndent(e), emitLeaf, mergeMode);
      } else {
        for (const leaf of group) {
          emitLeaf(leaf, e);
        }
      }
      group.length = 0;
    }
    const indent = INDENT.repeat(e.depth + 1);
    for (const comment of trailingBlockComments) {
      putBlockComment(e, indent, comment);
    }
  };

  /**
   * Emit one nested child one level in. The `depth--` must run when the child is
   * DONE, not when the call returns, or a suspended child would leave every
   * later sibling indented one level too deep.
   */
  const nested = (node: Statement, run: () => MaybePromise<void>): MaybePromise<void> => {
    flushDirect();
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
        if (e.referenceImportDepth === 0) {
          addLeaf(group, null, evaluatedLeaf(node, frame), false, e);
        }
        return undefined;
      case 'FunctionCall':
        return e.referenceImportDepth === 0
          ? placeStatementCall(node, frame, e, leaf => addLeaf(group, null, leaf, false, e))
          : undefined;
      case 'Ruleset':
        return nested(node, () => expandRule(node, null, null, frame, e));
      case 'AtRuleBlock':
        return e.referenceImportDepth === 0 || referenceAtRuleShown(node, e)
          ? nested(node, () => endRevealContainer(revealContainerStart(node, e), e, expandAtRuleBlock(node, frame, e)))
          : undefined;
      case 'AtRuleStatement':
        return e.referenceImportDepth === 0
          ? nested(node, () => emitAtRuleStatement(node, frame, e))
          : undefined;
      case 'Plugin':
        return undefined;
      case 'StyleImport':
        return nested(node, () => expandStyleImport(node, frame, e, e.importDocument));
      case 'ModuleImport':
        return e.referenceImportDepth === 0
          ? nested(node, () => {
              emitModuleImport(node, frame, e);
            })
          : undefined;
      case 'UnknownAtRuleBlock':
        return e.referenceImportDepth === 0
          ? nested(node, () => {
              emitUnknownAtRuleBlock(node, e);
            })
          : undefined;
      case 'MixinCall':
        // Best-effort: expand into the direct-declaration group.
        return e.referenceImportDepth === 0
          ? expandCall(node, null, null, frame, group, flushDirect, null, e)
          : undefined;
      case 'Apply':
        return e.referenceImportDepth === 0
          ? expandApply(node, null, null, frame, group, flushDirect, null, e)
          : undefined;
      case 'Reference':
        return e.referenceImportDepth === 0
          ? expandReferenceCall(node, null, null, frame, group, flushDirect, null, e)
          : undefined;
      case 'For':
        return e.referenceImportDepth === 0
          ? expandFor(node, null, null, frame, group, flushDirect, null, e)
          : expandNestedReferenceAncestorFor(node, null, null, frame, e, false);
      case 'If': {
        if (e.referenceImportDepth !== 0) {
          return undefined;
        }
        const body = selectIfBody(node, frame, e);
        return body ? emitAtRuleBody(body, frame, e, undefined, bodyTrivia) : undefined;
      }
      case 'While':
        return e.referenceImportDepth === 0
          ? runWhile(node, frame, e, rules => emitAtRuleBody(rules, frame, e, undefined, bodyTrivia))
          : undefined;

      case 'MixinDefinition':
        publishSelectedMixinDefinition(frame, node);
        markSilentStatementBlockCommentTrivia(node, e);
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
      const node = statements[index]!;
      replayBodyTriviaBefore(bodyTrivia, node, group, e);
      const stepped = one(node);
      if (isThenable(stepped)) {
        const at = index;
        return stepped.then(() => run(at + 1));
      }
    }
    if (owner !== undefined) {
      queueBodyTriviaTail(bodyTrivia, group, null, e);
    }
    flushDirect();
    if (owner !== undefined) {
      e.emittedBlockTrivia.closeCopy(bodyTrivia);
    }
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
  e: Emit,
  owner?: object,
  inlineTrivia?: BodyTriviaReplay
): MaybePromise<void> {
  /* The body's comments, replayed as {@link emitAtRuleBody} replays them. */
  const bodyTrivia = owner === undefined ? inlineTrivia : bodyTriviaReplay(owner, e);

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
    const trailingBlockComments = takePendingLeafBlockComments(e, group);
    if (group.length === 0 && trailingBlockComments.length === 0) {
      return;
    }
    if (ctx !== null) {
      // Wrap the direct declarations in the propagated selector context.
      e.depth++;
      const emitted = flushBlock(
        ctx, group, e, undefined, undefined, trailingBlockComments
      );
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
    } else {
      const mergeMode = mergeGroupMode(group);
      if (mergeMode !== MERGE_NONE) {
        mergeFold(group, e, bodyIndent(e), emitLeaf, mergeMode);
      } else {
        for (const leaf of group) {
          emitLeaf(leaf, e);
        }
      }
      const indent = INDENT.repeat(e.depth + 1);
      for (const comment of trailingBlockComments) {
        putBlockComment(e, indent, comment);
      }
    }
    group.length = 0;
  };

  /*
   * [atrule-bubbling] A body-expanding statement (mixin/detached-ruleset call,
   * `@each`) emits its nested rulesets INLINE via `expand*`, unlike the authored
   * `Ruleset`/at-rule cases below that each raise `e.depth` for their block. Those
   * expansions must indent to the SAME at-rule body level, so raise `e.depth`
   * around the call. But the direct declarations the expansion interleaves are
   * flushed through `flushDirect`, which raises `e.depth` ITSELF for the wrapping
   * `ctx { … }` block — so hand the expansion a flush that drops back to the body
   * base first, keeping those declarations one level in (not two).
   */
  const flushAtBase = (): MaybePromise<void> => {
    e.depth--;
    const flushed = flushDirect();
    if (isThenable(flushed)) {
      return flushed.then(() => {
        e.depth++;
      }, (error) => {
        e.depth++;
        throw error;
      });
    }
    e.depth++;
    return flushed;
  };
  const unbumpAfter = (expanded: MaybePromise<void>): MaybePromise<void> => {
    if (isThenable(expanded)) {
      return expanded.then(() => {
        e.depth--;
      });
    }
    e.depth--;
    return undefined;
  };

  /*
   * Keep one direct-leaf group and one cursor for the whole body.  In
   * particular, an async import resumes this exact group/body placement rather
   * than closing over a per-statement callback or re-walking a sliced tail.
   */
  const run = (start: number): MaybePromise<void> => {
    for (let index = start; index < statements.length; index++) {
      const node = statements[index]!;
      replayBodyTriviaBefore(bodyTrivia, node, group, e);
      switch (node.type) {
        case 'Declaration':
        case 'Comment':
          if (e.referenceImportDepth === 0) {
            addLeaf(group, null, evaluatedLeaf(node, frame), false, e);
          }
          break;
        case 'FunctionCall': {
          if (e.referenceImportDepth !== 0) {
            break;
          }
          const placed = placeStatementCall(node, frame, e, leaf => addLeaf(group, null, leaf, false, e));
          if (isThenable(placed)) {
            return placed.then(() => run(index + 1));
          }
          break;
        }
        case 'Ruleset':
          if (deferStaticChildren) {
            deferredChildren!.push(() => {
              e.depth++;
              const emitted = expandRule(node, ctx, ctxAncestor, frame, e, false, ctx !== null);
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
                const emitted = expandRule(node, ctx, ctxAncestor, frame, e, false, ctx !== null);
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
              const emitted = expandRule(node, ctx, ctxAncestor, frame, e, false, ctx !== null);
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
          if (e.referenceImportDepth !== 0 && !referenceAtRuleShown(node, e)) {
            break;
          }
          if (deferStaticChildren) {
            deferredChildren!.push(() => {
              e.depth++;
              const nested = endRevealContainer(revealContainerStart(node, e), e, expandAtRuleBlock(node, frame, e, ctx));
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
                const nested = endRevealContainer(revealContainerStart(node, e), e, expandAtRuleBlock(node, frame, e, ctx));
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
            const nested = endRevealContainer(revealContainerStart(node, e), e, expandAtRuleBlock(node, frame, e, ctx)); // directly-nested at-rule inherits ctx
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
          if (e.referenceImportDepth !== 0) {
            break;
          }
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
              const imported = expandStyleImport(
                node,
                frame,
                e,
                e.importDocument,
                (document, importFrame) => {
                  e.depth -= 1;
                  const emitted = emitBubbleBody(document.rules, ctx, importFrame, e);
                  if (isThenable(emitted)) {
                    return emitted.then(() => {
                      e.depth += 1;
                    }, (error) => {
                      e.depth += 1;
                      throw error;
                    });
                  }
                  e.depth += 1;
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
          const imported = expandStyleImport(
            node,
            frame,
            e,
            e.importDocument,
            (document, importFrame) => {
            /*
             * Undo ONLY the import statement's own `e.depth++` above, so the
             * loaded document is walked at the SAME depth as this bubble body's
             * authored content — its rules then indent one level inside the
             * at-rule exactly like an authored sibling (owner 2026-09-02; an
             * earlier `-= 2` dropped a second level and floated the loaded body
             * to column 0). Restored before the cursor resumes after an async
             * load.
             */
              e.depth -= 1;
              const emitted = emitBubbleBody(document.rules, ctx, importFrame, e);
              if (isThenable(emitted)) {
                return emitted.then(
                  () => {
                    e.depth += 1;
                  },
                  (error) => {
                    e.depth += 1;
                    throw error;
                  }
                );
              }
              e.depth += 1;
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
          if (e.referenceImportDepth !== 0) {
            break;
          }
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
        case 'UnknownAtRuleBlock': {
          if (e.referenceImportDepth !== 0) {
            break;
          }
          const flushed = flushDirect();
          if (isThenable(flushed)) {
            return flushed.then(() => {
              e.depth++;
              emitUnknownAtRuleBlock(node, e);
              e.depth--;
              return run(index + 1);
            });
          }
          e.depth++;
          emitUnknownAtRuleBlock(node, e);
          e.depth--;
          break;
        }
        case 'MixinCall':
          if (e.referenceImportDepth !== 0) {
            break;
          }
          {
            e.depth++;
            const expanded = unbumpAfter(expandCall(node, ctx, ctxAncestor, frame, group, flushAtBase, null, e));
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'Apply':
          if (e.referenceImportDepth !== 0) {
            break;
          }
          {
            const expanded = expandApply(node, ctx, ctxAncestor, frame, group, flushDirect, null, e);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'Reference':
          if (e.referenceImportDepth !== 0) {
            break;
          }
          {
            e.depth++;
            const expanded = unbumpAfter(expandReferenceCall(node, ctx, ctxAncestor, frame, group, flushAtBase, null, e));
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
          }
          break;
        case 'For': {
          /*
           * `@each`/`each()`/`$for` route through `expandFor`, which (like the
           * MixinCall/Reference expansions above) emits nested rulesets inline via
           * `walkBody` and manages no `e.depth` — so a loop inside a bubbled at-rule
           * needs the same body-level bump. The reference-ancestor branch handles
           * its own depth and must NOT be bumped (visible reference at-rule loop).
           */
          if (e.referenceImportDepth !== 0) {
            const expanded = expandNestedReferenceAncestorFor(node, ctx, ctxAncestor, frame, e, ctx !== null);
            if (isThenable(expanded)) {
              return expanded.then(() => run(index + 1));
            }
            break;
          }
          e.depth++;
          const expanded = unbumpAfter(expandFor(node, ctx, ctxAncestor, frame, group, flushAtBase, null, e));
          if (isThenable(expanded)) {
            return expanded.then(() => run(index + 1));
          }
          break;
        }
        case 'If': {
          if (e.referenceImportDepth !== 0) {
            break;
          }
          const body = selectIfBody(node, frame, e);
          if (body) {
            const emitted = emitBubbleBody(body, ctx, frame, e, undefined, bodyTrivia);
            if (isThenable(emitted)) {
              return emitted.then(() => run(index + 1));
            }
          }
          break;
        }
        case 'While': {
          if (e.referenceImportDepth !== 0) {
            break;
          }
          const emitted = runWhile(node, frame, e, rules => emitBubbleBody(rules, ctx, frame, e, undefined, bodyTrivia));
          if (isThenable(emitted)) {
            return emitted.then(() => run(index + 1));
          }
          break;
        }
        case 'MixinDefinition':
          publishSelectedMixinDefinition(frame, node);
          markSilentStatementBlockCommentTrivia(node, e);
          break;
        case 'VariableDeclaration':
          activateVariableDeclaration(node, frame, e);
          markSilentStatementBlockCommentTrivia(node, e);
          break;
      }
    }
    if (owner !== undefined) {
      queueBodyTriviaTail(bodyTrivia, group, null, e);
      e.emittedBlockTrivia.closeCopy(bodyTrivia);
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

  /** The block whose `$name` property lookups see the leaves spliced here. */
  readonly propertyScope: Frame;
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

  /**
   * The at-rules the entry has risen out of, outermost first, or null. An at-rule is
   * not a rule block (it does not count toward `bubble`), but the rule still belongs
   * inside it, so it is re-opened around the rule where the rule lands
   * (`.a { @media q { .b { e } } }` hoists `e` as `@media q { … }` beside `.a`).
   */
  wrappers: HoistWrapper[] | null;
}

interface HoistWrapper {
  node: AtRuleBlock;
  prelude: string;
}

/** Emit a hoisted rule where it lands, inside the at-rules it rose out of. */
function emitHoistEntry(h: HoistEntry, e: Emit, imp: boolean, wrapper = 0): MaybePromise<void> {
  const wrappers = h.wrappers;
  if (wrappers !== null && wrapper < wrappers.length) {
    const { node, prelude } = wrappers[wrapper]!;
    return nestedAtRuleShell(node, prelude, e, () => emitHoistEntry(h, e, imp, wrapper + 1));
  }
  return extendProjection(e)?.nestedPlan.get(h.rule)?.hoistNested
    ? expandRule(h.rule, null, null, h.frame, e, imp, false, null)
    : emitHoisted(h.rule, h.frame, e);
}

/** A `name: value;` / comment leaf at exactly the current `e.depth` level. */
function emitNestedLeaf(leaf: Leaf, e: Emit): void {
  const sourceOwner = leaf.frame.sourceOwner;
  const context = e.context;
  if (
    sourceOwner !== null
    && sourceOwner !== undefined
    && context !== undefined
    && sourceOwner !== context.documentContext
  ) {
    /* Shared nested-leaf buffers have the same deferred source-owner boundary
     * as collapsed leaf groups; the ordinary identity-equal lane stays direct. */
    settledEmission(withSourceOwner(e, sourceOwner, () => emitNestedLeafOwned(leaf, e)), leaf.node, e);
    return;
  }
  emitNestedLeafOwned(leaf, e);
}

/** Emit one nested leaf after its source owner/trivia are already active. */
function emitNestedLeafOwned(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const idt = blockIndent(e);

  /* The comments queued ahead of the leaf precede it, outside its mapped span. */
  for (const comment of leaf.leadingBlockComments ?? []) {
    putBlockComment(e, idt, comment);
  }
  const start = e.chunks.length;
  if (node.type === 'Declaration') {
    assertDeclarationValueIsNotRuleset(node, frame, e);
    const mark = dropMark(e);
    if (idt) {
      put(e, idt);
    }
    const name = declName(node, frame, e); // resolve interpolated property name
    const isCustom = name.startsWith('--');
    e.lastDeclCustom = isCustom; // [compress] gate the last-`;` drop in emitBlockClose
    put(e, name);
    put(e, declarationHeadTriviaText(node, e));
    const onNewLine = node.valueOnNewLine === true;

    // [compress] a custom property keeps its `: ` separator verbatim (see emitLeafOwned).
    put(e, (e.compress === true && !isCustom) || onNewLine ? ':' : ': ');
    const important = node.important === true || leaf.important === true;
    const deferred = putDeclarationValue(e, node, frame, idt + INDENT, important, onNewLine, isCustom, mark);
    markSilentStatementBlockCommentTrivia(node, e);
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
    emitInlineBlockCommentTriviaAfter(node, e);
    put(e, declEnd(e));
    finishDrop(e, mark, deferred);
  } else if (node.type === 'Comment') {
    if (!keepComment(e, node.text)) {
      return;
    }
    if (idt) {
      put(e, idt);
    }
    put(e, node.text);
    put(e, nl(e));
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
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
  readonly boundSourceKeys: readonly CallValue[] | null;
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
  const reject = (selected?: readonly Selection[]): null => {
    if (selected !== undefined) {
      for (const selection of selected) {
        discardSelectedBoundSources(selection.boundSourceKeys, e);
      }
    }
    for (const shell of shells) {
      discardSelectedBoundSources(shell.boundSourceKeys, e);
    }
    shells.length = 0;
    return null;
  };

  /*
   * Nested output is the v5 default, so this probe carries real documents and
   * cannot be a synchronous island: candidate lookup and dispatch may await.
   * Children are examined in order and the walk stays synchronous until one does.
   */
  const step = (index: number): MaybePromise<TransparentShell[] | null> => {
    for (let i = index; i < rule.rules.length; i++) {
      const child = rule.rules[i]!;
      if (child.type !== 'Ruleset' || !selectorListHasAmpersand(child.selector) || child.rules.length !== 1) {
        return reject();
      }
      const call = child.rules[0];
      if (call?.type !== 'MixinCall') {
        return reject();
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
          return reject(selected);
        }
        const selectedOne = selected[0]!;
        shells.push({
          rule: child,
          call,
          def: selectedOne.def,
          bindings: selectedOne.bindings,
          boundSourceKeys: selectedOne.boundSourceKeys,
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
        declIndex: collectDeclIndex(shell.def.rules, shell.bindings), cells: cellsForParams(shell.bindings, undefined, frame), reassign: null,
        statements: shell.def.rules,
        sourceOwner: sourceOwnerForBody(shell.def.rules, frame, e),
        mixinUrlBindings: undefined,
        mixinValueBindings: undefined
      };
      takeMixinValueBindings(shell.boundSourceKeys, e, callFrame);
      captureArgDefFrames(shell.bindings, frame, callFrame);
      const source: NestedHeaderSource = { parent: parentSource, selector: shell.rule.selector, frame };
      const header = nestedSourceStrings(source, e);
      const markChunks = e.chunks.length;
      const markPos = e.positions ? e.positions.length : 0;
      const idt = blockIndent(e);
      if (idt) {
        put(e, idt);
      }
      put(e, composeSelectorHeader(e, header, idt, null));
      put(e, blockOpen(e));
      const afterHeader = e.chunks.length;
      e.depth++;
      const finish = (): void => {
        e.depth--;
        if (e.chunks.length === afterHeader) {
          e.chunks.length = markChunks;
          if (e.positions) {
            e.positions.length = markPos;
          }
        } else {
          emitBlockClose(e, idt);
        }
      };
      const emitted = mapMaybe(
        activateBodyDependencies(shell.def.rules, callFrame, e),
        () => nestedBody(shell.def.rules, callFrame, e, undefined, imp, source)
      );
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

function writeNestedRule(
  rule: Ruleset,
  frame: Frame,
  e: Emit,
  imp: boolean,
  source: NestedHeaderSource | null,
  outerHoist?: HoistEntry[]
): MaybePromise<void> {
  /*
   * [extend/splice] The static plan is the rule's at its own placement. A ruleset
   * called as a mixin is spliced under its caller, where it is an ordinary nested
   * rule with its authored header (jess#345), as the flat writer has it.
   */
  const staticPlan = extendProjection(e)?.nestedPlan.get(rule);
  const plan = staticPlan === undefined || reachedViaMixinSplice(frame) ? undefined : staticPlan;
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
    return mapMaybe(
      activateBodyDependencies(rule.rules, childFrame, e),
      () => nestedBody(rule.rules, childFrame, e, undefined, imp, source, undefined, false, rule)
    );
  }
  if (plan?.flatten && !plan.hoistNested) {
    /*
     * Fallback (a top-level rule never flattens; a body-nested one is deferred by
     * the nested projection's hoist queue). Emit via the flat path with compaction.
     */
    return emitHoisted(rule, frame, e);
  }

  /*
   * A `hoistNested` rule falls through: it is emitted NESTED here (at the hoist
   * position), its `plan.header` already carrying the composed cross-`&` sibling
   * list; children stay literal-nested.
   */
  const markChunks = e.chunks.length;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.chunks.length;
  const idt = blockIndent(e);

  /*
   * [extend] nested header uses the projected own-local branch list; children
   * stay literal (nested mode composes nothing).
   * The nested header may name a value that must be awaited (an interpolated
   * selector built from an async function). Nested output is the v5 DEFAULT, so
   * this path carries the plugin corpus and cannot be a synchronous island.
   */
  /*
   * [extend/dynamic] With recording armed, an interpolated selector is resolved once,
   * structurally ({@link resolvedSelectorList}), for the header, the children's source
   * and the recorder alike.
   */
  let resolved: SelectorList | null = null;
  const ownMaybe = plan === undefined && e.dynamicExtend !== null
    && rule.selector.selectors.some(selectorBranchHasInterp)
    ? mapMaybe(resolvedSelectorList(rule.selector, frame, e), (copy) => {
        resolved = copy;
        const selector = copy ?? rule.selector;
        return source === null ? rootStringsNested(selector, frame, e) : ownStrings(selector, frame, e);
      })
    : plan
      ? plan.header
      : source === null

        /*
         * [nesting] ROOT context (no enclosing selector, incl. a bubbled at-rule
         * body top): a parentless `&` followed by other content drops to that
         * content; a LONE `&` is preserved (`rootStringsNested`). A real parent
         * keeps `&` verbatim (`ownStrings`).
         */
        ? rootStringsNested(rule.selector, frame, e)
        : ownStrings(rule.selector, frame, e);
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

    /*
     * [extend/dynamic] The rule is open on the recorder's path while its body emits,
     * and records its extend facts if it was reached through a dynamic expansion (a
     * placing body or a mixin call): its path is the open rules it nests under, as in
     * the flat writer. No evaluation is re-driven (ledger X12).
     */
    const dyn = e.dynamicExtend;
    const depth = dyn === null ? -1 : openDynamicPath(dyn, rule, source === null, own, true, resolved ?? undefined);
    const recorded = dyn !== null && (!dyn.staticRules.has(rule) || reachedViaMixinSplice(frame));

    /*
     * A recorded rule written under a parent block is no rewritable slot, so no
     * target: its plan has no parent subject to keep the header own-local, and moving
     * an extender out of the parent is restructuring, not a header rewrite
     * (EXTEND-SEMANTICS §1a). Its own extends still record.
     */
    const rewritable = !recorded || source === null
      || dyn.pathKinds[depth] === PATH_ROOT || dyn.pathKinds[depth] === PATH_ROOT_GUARD;
    if (recorded) {
      recordOpenRule(dyn, rule, frame, e, rewritable);
    }
    const authoredHeader = e.compress !== true && plan === undefined && source === null
      ? authoredSelectorHeaderWithTrivia(rule.selector, own, e)
      : null;
    const header = composeSelectorHeader(e, own, idt, authoredHeader);

    /*
     * Less only coalesces this nested-output root seam after an authored header
     * has been evaluated. Static same-selector root rules remain distinct.
     */
    const rootSibling = frame.parent === null && e.depth === 0
      && rule.selector.selectors.some(selectorBranchHasInterp);
    const lb = e.lastBlock;
    const reopen = rootSibling && lb.parentKey === frame && lb.depth === e.depth
      && lb.header === header && lb.endChunks === e.chunks.length;
    let headerChunkIndex = -1;
    if (reopen) {
      popClose(e, idt);
      if (e.compress === true && lb.droppedSemi) {
        put(e, ';'); // [compress] restore the separator dropped at the prior close
      }
    } else {
      if (idt) {
        put(e, idt);
      }
      const selStart = e.chunks.length;
      headerChunkIndex = e.chunks.length;
      put(e, header);
      if (e.positions) {
        e.positions.push({ node: rule.selector, type: rule.selector.type, start: selStart, end: e.chunks.length, source: srcFile(e) });
      }
      put(e, blockOpen(e));
    }
    const afterHeader = e.chunks.length;
    const childFrame = activateRuleFrame(rule, frame, e);
    const childSource: NestedHeaderSource = { parent: source, selector: resolved ?? rule.selector, frame };

    /*
     * [extend] children that flatten (extend crossed the `&`) bubble out to this
     * rule's depth; collect them and emit flat after the block closes. A `@plugin`
     * in this body registers before its siblings evaluate, as in `flatten`.
     */
    const hoist: HoistEntry[] = [];
    e.depth++;
    const finish = (): MaybePromise<void> => {
      e.depth--;
      if (e.chunks.length === afterHeader) {
        /*
         * Nothing emitted in the block, not even a comment (the walk writes the
         * body's own): drop the header/braces (rewind, ledger O6).
         */
        e.chunks.length = markChunks;
        if (e.positions) {
          e.positions.length = markPos;
        }
      } else {
        emitBlockClose(e, idt, lb);
        if (e.positions) {
          e.positions.push({ node: rule, type: rule.type, start, end: e.chunks.length, source: srcFile(e) });
        }
        if (rootSibling) {
          lb.parentKey = frame;
          lb.header = header;
          lb.depth = e.depth;
          lb.endChunks = e.chunks.length;
        }

        /*
         * [extend/dynamic] The surviving nested block's header is a rewritable target
         * slot: the deferred fold overwrites it in place if dynamic extenders fold in.
         */
        if (e.dynamicExtend && headerChunkIndex >= 0 && rewritable) {
          recordNestedDynExtendSlot(e, rule, frame, headerChunkIndex, idt, own, e.chunks.length);
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
            direct.push(evaluatedLeaf(st, childFrame));
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
            outerHoist.push({ rule: h.rule, frame: h.frame, bubble: h.bubble - 1, wrappers: h.wrappers });
            continue;
          }
          const emitted = emitHoistEntry(h, e, imp);
          if (isThenable(emitted)) {
            return emitted.then(() => runHoist(hoistIndex + 1));
          }
        }
      };
      return mapMaybe(emitSplits(0), () => runHoist(0));
    };
    const body = (): MaybePromise<void> => mapMaybe(
      activateBodyDependencies(rule.rules, childFrame, e),
      () => mapMaybe(nestedBody(rule.rules, childFrame, e, hoist, imp, childSource, undefined, false, rule), finish)
    );
    return dyn === null ? body() : withDynamicPlacement(dyn, depth, dyn.scope, dyn.boundary, body);
  });
}

/** Emit a flattened rule (and its descendants) via the flat path at `e.depth`,
 * using the nested-mode hoist header (flat composition + `:is()`-compaction). */
function emitHoisted(rule: Ruleset, frame: Frame, e: Emit): MaybePromise<void> {
  const prev = e.hoistMode;
  e.hoistMode = true;
  const emitted = expandRule(rule, null, null, frame, e);
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
 * Write one prelude-resolved at-rule through the authored-nesting projection. A rule
 * in its body that must rise out of the enclosing rule (an extend match crossed that
 * rule's `&`) leaves through `outerHoist`, taking the at-rule with it.
 */
function writeNestedAtRuleBlock(
  node: AtRuleBlock,
  frame: Frame,
  bodyFrame: Frame,
  e: Emit,
  source: NestedHeaderSource | null,
  prelude: string,
  outerHoist?: HoistEntry[]
): MaybePromise<void> {
  const hoist: HoistEntry[] | undefined = outerHoist === undefined ? undefined : [];
  const leave = (): void => {
    if (outerHoist === undefined || hoist === undefined || hoist.length === 0) {
      return;
    }
    const wrapper: HoistWrapper = { node, prelude };
    for (const h of hoist) {
      outerHoist.push({ rule: h.rule, frame: h.frame, bubble: h.bubble, wrappers: h.wrappers === null ? [wrapper] : [wrapper, ...h.wrappers] });
    }
  };
  return nestedAtRuleShell(node, prelude, e, () => mapMaybe(
    activateBodyDependencies(node.rules, bodyFrame, e),
    () => mapMaybe(nestedBody(node.rules, bodyFrame, e, hoist, false, source, undefined, false, node), leave)
  ));
}

/** `@name prelude { … }` around `body` at the current depth; dropped when the body writes nothing. */
function nestedAtRuleShell(
  node: AtRuleBlock,
  prelude: string,
  e: Emit,
  body: () => MaybePromise<void>
): MaybePromise<void> {
  const markChunks = e.chunks.length;
  const markPos = e.positions ? e.positions.length : 0;
  const start = e.chunks.length;
  const idt = blockIndent(e);
  if (idt) {
    put(e, idt);
  }
  put(e, node.name);
  if (prelude.length > 0) {
    put(e, e.compress === true && prelude.charCodeAt(0) === 0x28 /* ( */ ? '' : ' ');
    put(e, prelude);
  }
  put(e, blockOpen(e));
  const afterHeader = e.chunks.length;
  e.depth++;
  const finish = (): void => {
    e.depth--;
    if (e.chunks.length === afterHeader) {
      /* Nothing emitted, not even a comment (the walk writes the body's own). */
      e.chunks.length = markChunks;
      if (e.positions) {
        e.positions.length = markPos;
      }
      return;
    }
    emitBlockClose(e, idt);
    if (e.positions) {
      e.positions.push({ node, type: node.type, start, end: e.chunks.length, source: srcFile(e) });
    }
  };
  return mapMaybe(body(), finish);
}
