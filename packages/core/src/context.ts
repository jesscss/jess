import type {
  AtRule,
  Ruleset,
  Rules,
  Node,
  Any,
  AtRuleStatement,
  Selector,
  Nil
} from './tree/index.js';
import type { ImportOptions } from './import-options.js';
import { ExtendRootRegistry } from './tree/util/extend-roots.js';
import { type Operator } from './tree/util/calculate.js';
import type { ISafeParseResult, ParsedDocument, PluginInterface, UrlTransformRequest } from './plugin.js';
import type { Stylesheet } from './ast/nodes.js';
import type { StylesConfig } from './types.js';
import type { TriviaMap } from './types/index.js';
import type { ExtendSelectorKind } from './types/config.js';
import type { PluginHost, ValueEvaluator } from './ast/value-eval.js';
import { EqualityMode, FunctionMode, MathMode, UnitMode } from './types/modes.js';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { shouldOperateWithMathFrames } from './tree/util/should-operate.js';
import { type ErrorDiagnostic, type WarningDiagnostic, JessError, toDiagnostic, makeJessErrorFromDiagnostic } from './jess-error.js';
import type { Deprecation } from './deprecation.js';
import {
  type WarningsConfigInput,
  type ErrorsConfigInput,
  type ResolvedWarningsConfig,
  type ResolvedErrorsConfig,
  type CodeWarnStats,
  resolveWarningsConfig,
  resolveErrorsConfig,
  warnCodeMatchesAny,
  makeSuppressionSummary
} from './warnings.js';
import type { Call } from './tree/call.js';
import { CallMap } from './tree/util/recursion-helper.js';
import { BitSetLibrary } from './tree/util/bitset.js';
import { selectorAnalysisFor, type SelectorAnalysis } from './tree/util/selector-analysis.js';
import type { PrintOptions } from './tree/util/print.js';

/**
 * The single-pass EMIT visitor contract (design §6.1/§6.6). `enter` receives the
 * RESOLVED output node and either returns VOID (inspect / invisibly-annotate — the
 * node is emitted unchanged) or returns a NEW node (an output-affecting REPLACE —
 * a fresh transient serialized in place, never mutating the shared canonical node
 * in a byte-/reuse-affecting way, §6.4). No `ctx`, no frame — the node is already
 * resolved. `exit` (optional) fires after the node's children, kept solely for the
 * `inline-urls` enter/exit proof (§6.6).
 */
export type SpineVisitorEnter = (node: Node) => Node | void;
export type SpineVisitorExit = (node: Node) => void;
export interface SpineVisitor {
  enter: SpineVisitorEnter;
  exit?: SpineVisitorExit;
}

const SCRIPT_MODULE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const SCRIPT_MODULES_DISABLED_MESSAGE = 'Script modules are disabled by disableScriptModules.';
const EXTERNAL_IMPORT_SPECIFIER = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

async function importJsonModule(absoluteFilePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(absoluteFilePath, 'utf8')) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const result: Record<string, unknown> = { default: parsed };
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = value;
    }
    return result;
  }
  return { default: parsed };
}

export interface ContextOptions {
  /** Hash classes for module output */
  module?: boolean;
  /**
   * From docs:
   * "Changes compilation mode so dynamic content
   * is output as CSS variables, and changes
   * the runtime module to generate CSS patches."
   *
   * @todo - Change this behavior to "live expressions"
   * i.e. change compilation to always be static, but
   * generate a separate module for calculated CSS variables.
   */
  dynamic?: boolean;

  mathMode?: MathMode;
  unitMode?: UnitMode;
  functionMode?: FunctionMode;
  equalityMode?: EqualityMode;
  /** See LessOptions.allowOverloadedImport. Enforcement pending its definition. */
  allowOverloadedImport?: boolean;
  disableScriptModules?: boolean;
  /**
   * @deprecated Use `disableScriptModules` instead.
   */
  disablePluginRule?: boolean;

  /** Directories to search to resolve files */
  searchPaths?: string[];

  /**
   * Whether to leak variables and mixins into the caller scope,
   * such that they can be referenced / called by subsequent rules.
   *
   * @deprecated - a Less feature
   */
  leakyScope?: boolean;

  /**
   * Whether to bubble root-only at-rules (like @font-face, @keyframes)
   * to the root level when they're nested inside rulesets.
   *
   * @deprecated - a legacy Less feature; modern CSS allows nesting
   */
  bubbleRootAtRules?: boolean;

  /**
   * Suppress warnings (similar to Less's suppressWarnings option).
   * When true, warnings are collected but not emitted. Back-compat: this maps
   * to `warnings.silence: ['*']` in the unified processor.
   */
  suppressWarnings?: boolean;

  /**
   * Unified warnings processor config. Controls silencing, fatal promotion,
   * de-duplication, the per-code site cap and the display tier. Accepts either a
   * bare display tier (`'summary' | 'line' | 'frame'`) or the full config object.
   */
  warnings?: WarningsConfigInput;

  /**
   * Error-display config. Accepts either a bare display tier
   * (`'summary' | 'line' | 'frame'`) or `{ display }`. Default tier: `frame`.
   */
  errors?: ErrorsConfigInput;

  /**
   * Verbose output. Disables warning de-duplication/capping and skips the tail
   * summary — every warning surfaces.
   */
  verbose?: boolean;

  /** Quiet mode (suppress warning terminal output; collection is unaffected). */
  quiet?: boolean;

  /** Legacy deprecation ids to make fatal (mapped onto `deprecation/<id>` codes). */
  fatalDeprecations?: string[];

  /** Legacy deprecation ids to opt into early (mapped onto `deprecation/<id>` codes). */
  futureDeprecations?: string[];

  /**
   * Break on first error (stop processing after first error).
   * When false, errors are collected and processing continues.
   */
  breakOnError?: boolean;

  /** Output options — mirrors StylesConfig['output']; overrides any config-file setting. */
  output?: StylesConfig['output'];

  /**
   * Lazily supplies an importer plugin after path resolution proves a module
   * extension needs one. This keeps heavyweight optional runtimes out of
   * plugin-free parse/eval paths.
   */
  loadPluginForExtension?(extension: string): Promise<PluginInterface | undefined> | PluginInterface | undefined;

  /**
   * Per-tree transient serialization data threaded from the parser (source-anchored
   * comment/whitespace runs). Seeded onto the render {@link Context} (and per-tree
   * {@link TreeContext}) and read back at emit time.
   */
  trivia?: TriviaMap;

  /**
   * Source `[start, end)` ranges of comments lifted to standalone `Comment` nodes;
   * the render-time trivia view hides these so they aren't double-emitted.
   */
  liftedCommentRanges?: ReadonlyArray<readonly [number, number]>;
}

/**
 * The flat, fully-resolved option set read on the eval fast path. Every field is
 * present (no `undefined`), so a read-site is a single property access —
 * `context.options.equalityMode` — with no `?? treeContext ?? default` chain and
 * no per-read merge. Resolved once and cached on {@link Context}; recomputed only
 * when `context.treeContext` switches (see its setter), so crossing into an
 * imported file is one recompute, not a cost paid on every option read.
 */
export interface ResolvedOptions {
  mathMode: MathMode;
  unitMode: UnitMode;
  functionMode: FunctionMode;
  equalityMode: EqualityMode;
  leakyScope: boolean;
  bubbleRootAtRules: boolean;
}

/**
 * Ultimate fallbacks — used only when neither the compile config nor the tree
 * context (plugin/language/file) supplied a value.
 */
const OPTION_DEFAULTS: ResolvedOptions = {
  mathMode: 'parens-division',
  unitMode: 'preserve',
  functionMode: 'preserve',
  equalityMode: 'less',
  leakyScope: false,
  bubbleRootAtRules: false
};

/**
 * Resolve the option set with a SINGLE precedence: an explicit compile-level
 * option wins, else the source document's input configuration, else the
 * hard default. This is the one place the precedence is defined — it replaces the
 * three divergent `??` orders that used to live scattered across the read-sites
 * (`compile ?? tree` in conditions, `tree`-only in lists, `tree ?? compile` for
 * mathMode).
 */
export function resolveOptions(
  compile: Partial<ResolvedOptions> | undefined,
  tree: Partial<ResolvedOptions> | undefined
): ResolvedOptions {
  return {
    mathMode: compile?.mathMode ?? tree?.mathMode ?? OPTION_DEFAULTS.mathMode,
    unitMode: compile?.unitMode ?? tree?.unitMode ?? OPTION_DEFAULTS.unitMode,
    functionMode: compile?.functionMode ?? tree?.functionMode ?? OPTION_DEFAULTS.functionMode,
    equalityMode: compile?.equalityMode ?? tree?.equalityMode ?? OPTION_DEFAULTS.equalityMode,
    leakyScope: compile?.leakyScope ?? tree?.leakyScope ?? OPTION_DEFAULTS.leakyScope,
    bubbleRootAtRules: compile?.bubbleRootAtRules ?? tree?.bubbleRootAtRules ?? OPTION_DEFAULTS.bubbleRootAtRules
  };
}

export interface DocumentContextOptions extends ContextOptions {
  isModule?: boolean;

  file?: {
    /** Filename, e.g. "main.jess" */
    name: string;

    /** Absolute directory containing the file (no filename) */
    path: string;

    /** Absolute file path (directory + filename) */
    fullPath: string;

    /** Full file contents (recommended for code-frames) */
    source?: string;
  };

  /**
   * The plugin that parsed this document; it gets first dibs at resolving imports.
   */
  plugin?: PluginInterface;
}

/**
 * Source identity carried by canonical AST documents for one Context session.
 * It intentionally has no legacy node scope, selector cache, or placement state.
 */
export class DocumentContext {
  options: ResolvedOptions;
  isModule: boolean | undefined;
  file?: DocumentContextOptions['file'];
  plugin?: PluginInterface;

  constructor(opts: DocumentContextOptions = {}) {
    this.options = resolveOptions(undefined, opts);
    this.isModule = opts.isModule;
    this.file = opts.file;
    this.plugin = opts.plugin;
  }
}

/** The source facts shared by canonical documents and retained legacy trees. */
export type SourceContext = Pick<DocumentContext, 'options' | 'file' | 'plugin'>;

function isAsyncDocumentWork<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

export interface TreeContextOptions extends DocumentContextOptions {
  inlineJavaScript?: boolean;

  scope?: Rules;

  /**
   * Transient per-tree flag: emit a value-level source map for this tree (scalar
   * POC). Set by the plugin when output maps are requested.
   */
  sourceMap?: boolean;

  /** Per-tree selector key-set library shared by selectors of this tree. */
  selectorBits?: BitSetLibrary<string>;

  /** Plugin-supplied output policy carried on the tree (read via print/emit options). */
  collapseNesting?: boolean;

  /** Plugin-supplied allow-list of extend selector kinds. */
  allowExtendSelectors?: ExtendSelectorKind[];
}

const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

/**
 * @todo - Redo:
 *   1. Create a hash of the file path; that way hashes
 *      are unique per file, but also repeatable / predictable.
 *   2. Append file (module) hash after class name
 */
export const generateId = (length = 8) => {
  let str = '';
  let idCharsLength = idChars.length;
  for (let i = 0; i < length; i++) {
    str += idChars[Math.floor(Math.random() * idCharsLength)]!;
  }
  return str;
};

/**
 * Tree context is attached to each node
 * during the parsing phase / AST creation.
 *
 * Each file (and hence, tree) will get a new tree
 * context. For the most part, it is passed around
 * as an object reference.
 *
 * Additionally, it sets options that may be
 * unique to the tree, such as the math mode.
 */
export class TreeContext extends DocumentContext {
  /** Non-option, per-tree transient data (trivia, lifted-comment ranges, …). */
  opts: Omit<TreeContextOptions, 'isModule' | 'file' | 'plugin'>;

  constructor(opts: TreeContextOptions = {}) {
    // Resolve the file-level options once (no compile context yet — the eval
    // Context folds that in on attach). Structural identity stays on the
    // instance; every other unknown key is transient `opts` data.
    super(opts);
    const { isModule, file, plugin, ...rest } = opts;
    void isModule;
    void file;
    void plugin;
    delete rest.mathMode;
    delete rest.unitMode;
    delete rest.functionMode;
    delete rest.equalityMode;
    delete rest.leakyScope;
    delete rest.bubbleRootAtRules;
    this.opts = rest;
  }
}

/**
 * This is the context object used for evaluation.
 *
 * @note
 * Most of context represents "state" while evaluating.
 * There should only ever be one Context singleton per parse & evaluation.
 */
export class Context {
  readonly plugins: PluginInterface[];
  readonly opts: ContextOptions;

  private _treeContext: TreeContext | undefined;
  private _documentContext: DocumentContext | undefined;

  /**
   * Flat, fully-resolved options for the currently-active tree context — the one
   * place to read a resolved option (`context.options.unitMode`). Every field is
   * present, so there is no `??` and no per-read merge. Written only by the
   * `treeContext` setter (and shared with that tree context); do not assign it
   * directly. See {@link ResolvedOptions}.
   */
  options: ResolvedOptions;

  /**
   * Canonical AST-v2 value evaluator for this render session. Its concrete
   * registry is assembled by the application layer (`@jesscss/fns`), while
   * Context owns the per-render execution state and lifetime.
   */
  valueEvaluator?: ValueEvaluator;

  /** Dialect-owned function capability for canonical AST rendering. */
  pluginHost?: PluginHost;

  /**
   * The active file's tree context. Assigning it (at import entry/exit and
   * ruleset scope changes) recomputes `options` once and shares the resulting
   * object with the tree context, so the fast-path reads that follow are plain
   * field accesses.
   */
  get treeContext(): TreeContext | undefined {
    return this._treeContext;
  }

  set treeContext(tc: TreeContext | undefined) {
    this._treeContext = tc;
    // Fold the compile-level options over the tree's own, once, and SHARE the
    // result: `context.options` and `tc.options` become the same object, so eval
    // (`context.options.X`) and context-less reads (`node._treeContext.options.X`)
    // hit one resolved set with nothing left to merge. Idempotent on re-entry
    // (compile ?? already-folded === already-folded).
    this.options = resolveOptions(this.opts, this._documentContext?.options ?? tc?.options);
    if (tc) {
      tc.options = this.options;
    }
  }

  /** Active canonical AST source identity, independent of legacy tree state. */
  get documentContext(): DocumentContext | undefined {
    return this._documentContext;
  }

  private setDocumentContext(dc: DocumentContext | undefined): void {
    this._documentContext = dc;
    this.options = resolveOptions(this.opts, dc?.options ?? this._treeContext?.options);
    if (dc) {
      dc.options = this.options;
    }
  }

  /** Active source facts for resolver, diagnostics, and file-reading consumers. */
  get sourceContext(): SourceContext | undefined {
    return this._documentContext ?? this._treeContext;
  }

  /**
   * Change a compile-level option and refresh the resolved-options cache. Prefer
   * passing options at construction; this exists for dynamic reconfiguration (and
   * tests) that need to change an option on a live context — mutating `opts`
   * directly would leave {@link options} stale.
   */
  setOption<K extends keyof ResolvedOptions>(key: K, value: ResolvedOptions[K]): void {
    this.opts[key] = value;
    this.options = resolveOptions(this.opts, this._documentContext?.options ?? this._treeContext?.options);
  }

  /**
   * Collected errors during safeParse/safeRender.
   * Only populated when using safe methods.
   */
  errors: ErrorDiagnostic[] = [];

  /**
   * Collected warnings during safeParse/safeRender.
   * Only populated when using safe methods. Prefer routing warnings through
   * {@link warn} rather than pushing here directly, so silencing / fatal
   * promotion / de-duplication / the tail summary all apply uniformly.
   */
  warnings: WarningDiagnostic[] = [];

  /** Lazily-resolved warnings config (folded from compile options). */
  private _warnConfig?: ResolvedWarningsConfig;

  /** Lazily-resolved error-display config (folded from compile options). */
  private _errorsConfig?: ResolvedErrorsConfig;

  /** Per-code de-dup / cap / summary bookkeeping. */
  private readonly _warnStats = new Map<string, CodeWarnStats>();

  /** Guards {@link finalizeWarnings} idempotency. */
  private _warningsFinalized = false;

  /** The resolved warnings config, computed once from the compile options. */
  private get warnConfig(): ResolvedWarningsConfig {
    if (!this._warnConfig) {
      this._warnConfig = resolveWarningsConfig({
        warnings: this.opts.warnings,
        suppressWarnings: this.opts.suppressWarnings,
        verbose: this.opts.verbose,
        fatalDeprecations: this.opts.fatalDeprecations,
        futureDeprecations: this.opts.futureDeprecations
      });
    }
    return this._warnConfig;
  }

  /** The resolved error-display config, computed once from the compile options. */
  get errorsConfig(): ResolvedErrorsConfig {
    if (!this._errorsConfig) {
      this._errorsConfig = resolveErrorsConfig(this.opts.errors);
    }
    return this._errorsConfig;
  }

  /**
   * The unified warnings entry point. Accepts a {@link JessError} (from
   * `WARN.x(...)`) or an already-normalized {@link WarningDiagnostic} and
   * applies, in order: silencing, fatal promotion, then de-duplication +
   * per-code site capping before pushing onto {@link warnings}.
   *
   * Pass `options.code` to override the diagnostic code used for matching /
   * dedup / summary (e.g. deprecations routed as `deprecation/<id>`).
   */
  warn(warning: JessError | WarningDiagnostic, options?: { code?: string }): void {
    const diag: WarningDiagnostic = warning instanceof JessError
      ? toDiagnostic(warning) as WarningDiagnostic
      : warning;
    if (options?.code) {
      diag.code = options.code;
    }
    const code = diag.code;
    const cfg = this.warnConfig;

    if (warnCodeMatchesAny(code, cfg.silence)) {
      return;
    }

    if (warnCodeMatchesAny(code, cfg.fatal)) {
      const base = warning instanceof JessError ? warning.message : diag.message;
      const error = new Error(
        `${base}\n\nThis is only an error because you've set ${code} to be fatal.\n`
        + 'Remove this setting if you need to keep using this feature.'
      );
      error.name = 'FatalWarningError';
      throw error;
    }

    const capping = cfg.limitRepetition && !cfg.verbose;
    if (!capping) {
      this.warnings.push(diag);
      return;
    }

    const key = `${code}@${diag.filePath ?? ''}:${diag.line}:${diag.column}`;
    let stats = this._warnStats.get(code);
    if (!stats) {
      stats = {
        phase: diag.phase,
        emittedSites: new Set<string>(),
        suppressedSites: new Set<string>(),
        suppressedCount: 0
      };
      this._warnStats.set(code, stats);
    }

    // A previously-emitted site repeating, or a new site over the per-code cap:
    // count it for the summary and drop it.
    if (stats.emittedSites.has(key) || stats.emittedSites.size >= cfg.maxSitesPerCode) {
      stats.suppressedCount++;
      stats.suppressedSites.add(key);
      return;
    }

    stats.emittedSites.add(key);
    this.warnings.push(diag);
  }

  /**
   * Route a deprecation warning through {@link warn} with the canonical
   * `deprecation/<id>` code, so `warnings.silence`/`fatal` `deprecation/*`
   * wildcards (and legacy `fatalDeprecations`) apply uniformly.
   */
  warnDeprecation(deprecation: Deprecation, warning: JessError | WarningDiagnostic): void {
    this.warn(warning, { code: `deprecation/${deprecation.id}` });
  }

  /**
   * Append one tail-summary {@link WarningDiagnostic} per code that had
   * suppressed repeats/over-cap sites. Skipped entirely under `verbose`.
   * Idempotent — safe to call from every result-assembly path.
   */
  finalizeWarnings(): void {
    if (this._warningsFinalized) {
      return;
    }
    this._warningsFinalized = true;
    if (this.warnConfig.verbose) {
      return;
    }
    for (const [code, stats] of this._warnStats) {
      if (stats.suppressedCount > 0) {
        this.warnings.push(makeSuppressionSummary(code, stats));
      }
    }
  }

  /**
   * A feature ported from Less - we suppress any `@charset`
   * after the first one.
   */
  currentCharset?: Any | AtRuleStatement;
  /** Track whether charset has been emitted during toString to avoid duplicates */
  charsetEmitted?: boolean;

  /** @import rules must be at the top of CSS output */
  topImports?: Node[];

  /**
   * This is set when entering rulesets so that child nodes
   * can use this to look up values. Jess `$!variable` carries explicit
   * source-position read mode for the live-binding model.
   */
  rulesContext?: Rules;
  /** Entire context root (ultimate root) */
  root!: Rules;
  /** Canonical parsed document for the AST-v2 execution route. */
  document?: Stylesheet;
  /**
   * Per-session source identity for canonical AST documents. AST nodes stay
   * plain source facts; the render session carries the file/plugin context
   * required by the retained Context resolver when an import enters a child
   * document.
   */
  private readonly documentContexts = new WeakMap<Stylesheet, DocumentContext>();
  /**
   * Deferred executable bodies retain the source document that introduced
   * them into this session. This is session provenance, not AST metadata: the
   * same canonical body can be placed in more than one render frame without a
   * node mutation, parser walk, or secondary source tree.
   */
  private readonly documentBodyContexts = new WeakMap<object, DocumentContext>();
  /** Set so that we can do ruleset selector lookup for extend */
  treeRoot!: Rules;
  allRoots: Rules[] = [];

  /** The call that is currently being evaluated */
  caller?: Call;

  /**
   * Spine mixin-fold sink (cutover P3-precursor, UNIFIED-EVAL-EMIT-DESIGN §2/§3).
   * When set by the emit-walk spine before it drives a mixin CALL's resolution,
   * the callable terminal (`evaluateCallableCandidateOutput`) skips the
   * `rules.eval()` output-tree build and instead hands the emit-walk driver the
   * guard-passed BOUND SURFACE (shared body children + the wired live-cell param
   * frame) so it can descend it INLINE to the writer emit-walk already holds — no
   * output tree, no `mixinOutputSlot`, no `Rules.derive`. Returning `false` from
   * the sink signals "not a spine-simple shape" so the terminal falls back to the
   * eval path for THAT candidate (byte-identical transition; the eval terminal
   * dies in P4). Scoped save/restore around the drive — undefined on the eval path
   * so the terminal is unchanged there.
   */
  spineMixinSurfaceSink?: (boundSurface: Rules, sourceRules: Rules, candidateIsMixin: boolean) => boolean;

  /**
   * Set by the spine root descent (`_emitRulesBody`) around the render of a
   * document-ROOT-level mixin CALL. When the callable terminal builds that call's
   * output tree it consults this flag: an output that drops a bare property
   * `Declaration` at the document root is invalid ("Properties must be inside
   * selector blocks") — the same rejection the eval path's `checkValidNodes`
   * (`isRoot && fromCallOutput`) makes. The spine emits call output as text inline
   * (no post-eval output tree to walk), so the check moves to the single fold/eval
   * drive. Scoped save/restore around the root call render; unset for a call nested
   * inside a selector container (where a folded property is legal).
   */
  spineRootCallEmit?: boolean;

  /**
   * LEAKY forward-propagation (spine): the SOURCE root Rules whose body is
   * currently emitting a root-level mixin call. Its scope frame is the caller
   * frame a leaked `@x: …` mixin-body var must inject into so a later root sibling
   * ruleset resolves it. Captured at the root emit site (where `this === root`)
   * because `context.root` is reassigned during the call's nested eval. Set only
   * alongside {@link spineRootCallEmit}; undefined for a nested call.
   */
  spineRootCallEmitFrame?: Rules;

  /**
   * The spine descent (`renderRootViaSpine`) has already established the document
   * root on `context.root` — no `Rules.eval` frame for the real root sits on
   * `rulesEvalStack`. A DETACHED-RULESET body (or mixin surface) evaluated INSIDE
   * the fold reaches `_evalPreparedRules` as the FIRST `Rules.evalNode`, so its
   * `rulesEvalStack.length === 1` "am I the outermost root?" heuristic fires and
   * would REASSIGN `context.root` to that nested body — clobbering the real root's
   * built-in function registry (`findFunction`'s dead-end fallback then misses, so
   * `length(@list)` emits raw). The eval path never trips this: it pushes the real
   * root first, so a nested body sees stack length ≥2. This flag lets the nested
   * eval skip the reassignment when the spine owns the root. Undefined on the eval
   * path (zero-cost, unchanged there). Scoped save/restore around the spine descent.
   */
  spineOwnsRoot?: boolean;

  /** Extend roots registry for managing extend scoping */
  extendRoots!: ExtendRootRegistry;

  /**
   * Generic single-pass EMIT visitors (design §6). An ordered, initially-EMPTY
   * list of `(node) => Node | void` hooks (with an optional `exit`) the spine
   * fires at each resolved output node's emit moment. The list being empty is
   * the ZERO-COST common case (§6.5 / §4.0-style gate): the spine checks
   * `spineVisitors === undefined` and skips all hook machinery. `node` is the
   * RESOLVED output node — no ctx, no frame (§6, decision table). Native Jess
   * visitors and the less-compat bridge (registered only when ≥1 real Less
   * visitor exists — NOT built here) coexist as plain list entries; core owns no
   * chaining / REMOVE / ABORT / per-type dispatch.
   *
   * @see docs/future/core-architecture/UNIFIED-EVAL-EMIT-DESIGN.md §6.
   */
  spineVisitors?: SpineVisitor[];

  /**
   * The active single-pass spine `+:`/`+_:` merge plan for the body currently
   * being emitted (design §merge). Keyed by source declaration node → its
   * coalesced-value anchor / suppress verdict. Installed by `withSpineMergePlan`
   * for the duration of a body descent and restored on exit, so a `$prop`
   * Reference resolved MID-emit reads the coalesced merge value (the anchor's
   * combined value) rather than the last merge sibling's own truncated value.
   *
   * Undefined (the common case) on any body with no merge-flagged declaration —
   * the reference read fast-bails on the undefined check before touching it, so
   * the non-merge path pays nothing.
   */
  spineMergePlan?: import('./tree/util/spine-merge.js').SpineMergePlan;

  /**
   * Append a generic EMIT visitor (design §6.5). Deterministic registration
   * order; the pass threads each node through `enter` (`shape = enter(shape) ??
   * shape`) and fires `exit` (if registered) after the node's children. No
   * auto-registration — the list stays undefined (zero-cost) until a caller
   * registers.
   */
  registerSpineVisitor(enter: SpineVisitorEnter, options?: { exit?: SpineVisitorExit }): void {
    (this.spineVisitors ??= []).push({ enter, exit: options?.exit });
  }

  /**
   * Depth-first document order of each Ruleset (assigned once per root before eval).
   * Used so processExtends can apply extends in true source order.
   */
  documentOrderByRuleset?: WeakMap<Ruleset, number>;

  /**
   * Registered extends with their extend root context
   * Format: [target, selectorWithExtend, partial, extendRoot, extendNode, documentOrder?]
   */
  extends: Array<[target: Selector, selectorWithExtend: Selector, partial: boolean, extendRoot: Rules, extendNode: Node, documentOrder?: number, fromReferenceScope?: boolean]> = [];

  /**
   * When doing any kind of lookup, the current node and resolved
   * nodes in the search chain are added to prevent recursion errors.
   *
   * We use a set here because we look it up for filtering.
   * Also used to track mixins currently being evaluated to prevent infinite recursion.
   */
  private _searchScope: Set<Node> | undefined;
  get searchScope() {
    return (this._searchScope ??= new Set());
  }

  /**
   * The file (eval) context should have the same ID at compile-time
   * as run-time, so this ID will be set in `toModule()` output
   *
   * @todo - Make the id a hash of the (project-relative) path + contents
   */
  id = generateId();
  ruleCounter = 1;

  selectorBits = new BitSetLibrary<string>();

  /**
   * Selector key-set analysis (keySet / visibleKeySet / requiredKeySet), computed
   * off the selector nodes. Scoped to this Context's bit library, so its cache and
   * interned keys live and die with the compilation — no cross-run leak.
   */
  get selectorAnalysis(): SelectorAnalysis {
    return selectorAnalysisFor(this.selectorBits);
  }

  /** Rules depth, used to figure out source order */
  depth = -1;

  private _classMap: Map<string, string> | undefined;
  get classMap() {
    return (this._classMap ??= new Map());
  }

  private _printState: PrintOptions | undefined;
  get printState() {
    return (this._printState ??= { context: this });
  }

  /** Frames for nested rulesets, used for selector evaluation */
  rulesetFrames: Ruleset[] = [];
  /**
   * Spine-mode (P1 §2, ampersand-append fold) resolved-selector side-channel. Maps a
   * SOURCE ruleset frame node to the CONCRETE selector the spine resolved for it at
   * ruleset-enter. `Ampersand.evalNode` reads this before the raw `frame.selector` so a
   * nested append (`.a { &-b { &-c {…} } }` → `.a-b-c`) composes each level against the
   * RESOLVED parent (`.a-b`), not the raw authored `&-b`. This reproduces the eval
   * pass, which pushes the resolved OUTPUT node onto `rulesetFrames` — without mutating
   * the shared canonical source node (the output-affecting-resolution invariant). Set +
   * cleared per frame push/pop by `serializeSpineFrameContainer`.
   */
  spineResolvedFrameSelector: WeakMap<Ruleset, Selector | Nil> | undefined;
  /** Unified frames array for flat rendering when collapseNesting is true */
  frames: (Ruleset | AtRule)[] = [];

  /**
   * We push a boolean to this array when entering a calc() call
   * and pop it when leaving. This helps us determine if operations
   * should be performed or not.
   *
   * @todo - can't this just be a number?
   */
  calcFrames = 0;

  private _callMap: CallMap | undefined;
  get callMap() {
    return (this._callMap ??= new CallMap());
  }

  private _callStack: Call[] | undefined;
  get callStack() {
    return (this._callStack ??= []);
  }

  /**
   * Stack to track reference call chain for clearing matched keys at outermost level
   */
  private _referenceStack: number = 0;
  get referenceStack() {
    return this._referenceStack;
  }

  /**
   * Import-evaluation scope stack.
   *
   * This intentionally models lexical import scope instead of global counters:
   * - each import branch pushes its semantics on entry
   * - each branch pops in `finally`
   * - readers ask semantic questions (`inReferenceImportScope`) instead of
   *   inspecting mutable depth values.
   *
   * Why this exists:
   * some behaviors depend on "how we got here" (call-path scope), not only
   * on the current node's own options. Example: suppressing top-level @import
   * hoists while traversing a reference-only branch.
   */
  private _importScopeStack: Array<{ reference: boolean; multiple: boolean }> = [];
  get importScope() {
    return this._importScopeStack;
  }

  get inReferenceImportScope() {
    return this._importScopeStack.some(scope => scope.reference);
  }

  get inMultipleImportScope() {
    return this._importScopeStack.some(scope => scope.multiple);
  }

  pushImportScope(scope: { reference?: boolean; multiple?: boolean }) {
    this._importScopeStack.push({
      reference: scope.reference === true,
      multiple: scope.multiple === true
    });
  }

  popImportScope() {
    if (this._importScopeStack.length > 0) {
      this._importScopeStack.pop();
    }
  }

  pushReference() {
    this._referenceStack++;
  }

  /**
   * Stack to track when a value comes from an important declaration.
   * The exact source leaf is carried when available so downstream render/public
   * surfaces can preserve it instead of synthesizing a replacement flag node.
   */
  private _importantSourceStack: (Any<'flag'> | true)[] = [];
  get hasImportantSource() {
    return this._importantSourceStack.length > 0;
  }

  pushImportantSource(source?: Any<'flag'>) {
    this._importantSourceStack.push(source ?? true);
  }

  popImportantSource() {
    return this._importantSourceStack.pop();
  }

  popReference() {
    this._referenceStack--;
  }

  rulesEvalStack: Rules[] = [];

  /**
   * We push a boolean to this array when entering parens call
   * and pop it when leaving. This helps us determine if operations
   * should be performed or not.
   *
   * Sometimes we "reset" the "in parentheses" state by pushing false,
   * such as within a function call.
   */
  parenFrames: boolean[] = [];

  /**
   * In a custom declaration's value. All nodes should
   * be preserved as-is and not evaluated, except for
   * $() expressions.
  */
  inCustom: boolean | undefined;

  /** A flag set when evaluating conditions */
  isDefault: boolean | undefined;

  constructor(opts: ContextOptions = {}, plugins?: PluginInterface[]) {
    this.opts = opts;
    // Seed resolved options from compile config (no tree context yet); the
    // treeContext setter recomputes this once a file's context is active.
    this.options = resolveOptions(opts, undefined);
    this.plugins = plugins ?? [];
    this.extendRoots = new ExtendRootRegistry();
    if (opts.output?.compress !== undefined) {
      this.printState.compress = opts.output.compress;
    }
  }

  /** Full resolved path -> canonical parsed document (legacy Rules during migration or AST v2 Stylesheet). */
  sourceTrees = new Map<string, ParsedDocument>();
  evaldTrees = new Map<string, Rules>();

  /** Record the parser/source identity once, when an AST document enters this session. */
  private rememberDocumentContext(
    document: Stylesheet,
    filePath: string,
    source: string | undefined,
    plugin: PluginInterface
  ): void {
    this.documentContexts.set(document, new DocumentContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        ...(source === undefined ? {} : { source })
      },
      plugin
    }));
  }

  /**
   * Run work with the source identity of a canonical AST document active.
   * This is the AST-v2 equivalent of entering a legacy tree's TreeContext:
   * the Context resolver, option cache, diagnostics and plugin priority all
   * remain one session-owned path.
   */
  withDocument<T>(document: Stylesheet, run: () => T | Promise<T>): T | Promise<T> {
    const next = this.documentContexts.get(document);
    if (!next) {
      return run();
    }
    const previous = this._documentContext;
    this.setDocumentContext(next);
    try {
      const result = run();
      if (isAsyncDocumentWork(result)) {
        return result.finally(() => {
          this.setDocumentContext(previous);
        });
      }
      this.setDocumentContext(previous);
      return result;
    } catch (error) {
      this.setDocumentContext(previous);
      throw error;
    }
  }

  /**
   * Dispatch a rendered URL target to the plugin that parsed the active
   * document. The entry/source paths are provenance facts already retained by
   * this Context; this does not perform resolution, loading, or parsing.
   */
  transformUrl(value: string, quoted: boolean): string {
    const document = this.sourceContext;
    const transform = document?.plugin?.transformUrl;
    if (!transform) {
      return value;
    }
    const entry = this.document ? this.documentContexts.get(this.document) : undefined;
    const request: UrlTransformRequest = {
      value,
      quoted,
      ...(document?.file?.fullPath === undefined ? {} : { fromFilePath: document.file.fullPath }),
      ...(entry?.file?.fullPath === undefined ? {} : { entryFilePath: entry.file.fullPath })
    };
    return transform.call(document.plugin, request) ?? value;
  }

  /**
   * Associate one deferred callable body with an already-known document.
   * Import execution supplies the document identity explicitly because the
   * lexical splice publishes its callable facts before entering that document's
   * active Context scope.
   */
  rememberDocumentBody(document: Stylesheet, body: object): void {
    const owner = this.documentContexts.get(document);
    if (owner) {
      this.documentBodyContexts.set(body, owner);
    }
  }

  /**
   * Execute a deferred callable body in the source scope that introduced it.
   * The promise branch deliberately retains the scope until that body has
   * completed its own async imports or IO, then restores the caller scope.
   */
  withDocumentBody<T>(body: object, run: () => T | Promise<T>): T | Promise<T> {
    const next = this.documentBodyContexts.get(body);
    if (!next) {
      return run();
    }
    const previous = this._documentContext;
    this.setDocumentContext(next);
    try {
      const result = run();
      if (isAsyncDocumentWork(result)) {
        return result.finally(() => {
          this.setDocumentContext(previous);
        });
      }
      this.setDocumentContext(previous);
      return result;
    } catch (error) {
      this.setDocumentContext(previous);
      throw error;
    }
  }

  /** Opaque source identity carried by render-local frames/bindings. */
  currentSourceOwner(): object | null {
    return this._documentContext ?? null;
  }

  /** Run a deferred render activation in its recorded source identity. */
  withSourceOwner<T>(owner: object | null | undefined, run: () => T | Promise<T>): T | Promise<T> {
    if (!(owner instanceof DocumentContext)) {
      return run();
    }
    const previous = this._documentContext;
    this.setDocumentContext(owner);
    try {
      const result = run();
      if (isAsyncDocumentWork(result)) {
        return result.finally(() => {
          this.setDocumentContext(previous);
        });
      }
      this.setDocumentContext(previous);
      return result;
    } catch (error) {
      this.setDocumentContext(previous);
      throw error;
    }
  }

  /** The source owner that authored a callable body, if one is known. */
  sourceOwnerForBody(body: object): object | null {
    return this.documentBodyContexts.get(body) ?? this._documentContext ?? null;
  }

  /**
   * @param importPath - The bare import path e.g. `@import "foo";` in a .less file.
   */
  private async _getPath(importPath: string) {
    const currentDocument = this.sourceContext;
    const currentDirectory = currentDocument?.file?.path ?? process.cwd();
    const { searchPaths = [] } = this.opts;

    const plugins = this.plugins;
    let finalPath: string | undefined;
    let currentPlugin = currentDocument?.plugin;

    /** First, expand imports */
    let paths = currentPlugin?.expandImport?.(importPath, currentDirectory) ?? [importPath];
    if (paths.length === 0) {
      throw new Error(`No paths found for import "${importPath}"`);
    }

    /** Give current context plugin first dibs to resolve */
    if (currentPlugin?.resolve) {
      const result = await currentPlugin.resolve(paths, currentDirectory, searchPaths);
      if (result) {
        paths = result;
      }
    }

    /** Try to resolve using resolver plugins */
    for (const plugin of plugins) {
      if (plugin === currentPlugin) {
        continue;
      }
      if (!plugin.resolve) {
        continue;
      }
      const result = await plugin.resolve(paths, currentDirectory, searchPaths);
      if (result) {
        paths = result;
      }
    }

    /** Now, try to locate the first matching file using locator plugins */
    for (const plugin of plugins) {
      if (!plugin.locate) {
        continue;
      }
      const result = await plugin.locate(paths, currentDirectory);
      if (result) {
        finalPath = result;
        break;
      }
    }

    if (!finalPath) {
      /** @todo - Add messaging around tried paths */
      throw new Error(`File not found: ${importPath} (from: ${currentDirectory})`);
    }

    const normalizedFinalPath = finalPath.split(/[?#]/)[0]!;
    const ext = path.extname(normalizedFinalPath);
    const friendlyPath = path.relative(process.cwd(), normalizedFinalPath);

    if (!ext) {
      throw new Error(`File "${friendlyPath}" not supported`);
    }

    return {
      triedPaths: paths,
      resolvedPath: normalizedFinalPath,
      friendlyPath
    };
  }

  /**
   * Find the appropriate plugin for parsing based on type or extension
   */
  private findParserPlugin(type?: string, extension?: string): PluginInterface {
    const plugins = this.plugins;

    if (type) {
      const plugin = plugins.find(plugin => plugin.name === type);
      if (!plugin) {
        throw new Error(`Plugin "${type}" not found`);
      }
      if (!plugin.safeParse) {
        throw new Error(`Plugin "${type}" does not support parsing`);
      }
      return plugin;
    }

    if (extension) {
      const plugin = plugins.find(plugin => plugin.supportedExtensions?.includes(extension) && plugin.safeParse);
      if (!plugin) {
        throw new Error(`No plugin found for extension "${extension}"`);
      }
      return plugin;
    }

    throw new Error('No plugin type or extension specified');
  }

  /**
   * Normalize parser plugins through the retained Context dispatcher. A plugin
   * returns one canonical Stylesheet result; callers never select a second
   * parser/load route themselves.
   */
  private parseSource(
    plugin: PluginInterface,
    filePath: string,
    source: string,
    options?: Parameters<NonNullable<PluginInterface['safeParse']>>[2]
  ): ISafeParseResult {
    if (!plugin.safeParse) {
      throw new Error(`Plugin "${plugin.name}" does not support parsing`);
    }
    return plugin.safeParse(filePath, source, options);
  }

  async getTree(importPath: string, importOptions: ImportOptions = {}) {
    const { resolvedPath, triedPaths, friendlyPath } = await this._getPath(importPath);
    const { type } = importOptions;
    /**
     * We already have resolved this file and parsed it.
     */
    if (this.sourceTrees.has(resolvedPath)) {
      return {
        node: this.sourceTrees.get(resolvedPath)!,
        triedPaths,
        resolvedPath
      };
    }

    const plugins = this.plugins;

    const sourceGetter = plugins.find(plugin => plugin.getSource);
    if (!sourceGetter) {
      /** If we can't actually load files, bail. */
      throw new Error('No source getter found');
    }

    const ext = path.extname(resolvedPath);
    const plugin = this.findParserPlugin(type, ext);
    const source = await sourceGetter.getSource!(resolvedPath);
    const parseResult = this.parseSource(plugin, resolvedPath, source, {
      importOptions,
      compilerOptions: this.opts
    });

    // Collect normalized errors and warnings from plugin
    this.errors.push(...parseResult.errors);
    this.warnings.push(...parseResult.warnings);

    // Check if we have errors and should break
    if (parseResult.errors.length > 0 && this.opts.breakOnError !== false) {
      // Throw the first error as a JessError
      const firstError = parseResult.errors[0]!;
      throw makeJessErrorFromDiagnostic(firstError);
    }

    const document = parseResult.document;
    if (document) {
      if (!this.document) {
        this.document = document;
      }
      this.rememberDocumentContext(document, resolvedPath, source, plugin);

      this.sourceTrees.set(resolvedPath, document);
      return {
        node: document,
        triedPaths,
        resolvedPath
      };
    }

    // No tree and no errors means unsupported file
    const notSupportedError = new Error(`File "${friendlyPath}" not supported`);
    if (this.opts.breakOnError !== false) {
      throw notSupportedError;
    }
    // Add error for unsupported file
    this.errors.push({
      code: 'parse/unsupported-file',
      phase: 'parse',
      message: notSupportedError.message,
      reason: `The file "${friendlyPath}" is not supported by any available plugin.`,
      fix: 'Ensure the file has a supported extension or specify a plugin type.',
      filePath: resolvedPath,
      line: 1,
      column: 1
    });
    return {
      node: null,
      triedPaths,
      resolvedPath
    };
  }

  /**
   * Load a stylesheet import through the existing plugin dispatcher. External
   * identifiers are deliberately opt-in: without a plugin that claims one,
   * they stay CSS terminals and Context never attempts a network read. A
   * claiming plugin still uses the ordinary resolve/locate/source/parse path.
   */
  async loadImport(importPath: string, importOptions: ImportOptions = {}) {
    if (EXTERNAL_IMPORT_SPECIFIER.test(importPath)) {
      const currentDirectory = this.sourceContext?.file?.path ?? process.cwd();
      const { searchPaths = [] } = this.opts;
      let claimed = false;
      for (const plugin of this.plugins) {
        if (await plugin.canResolveImport?.(importPath, currentDirectory, searchPaths)) {
          claimed = true;
          break;
        }
      }
      if (!claimed) {
        return undefined;
      }
    }
    return this.getTree(importPath, importOptions);
  }

  /**
   * Public path resolution for import nodes that need source-path lookups
   * without triggering parse/eval.
   */
  async resolveImportPath(importPath: string) {
    return this._getPath(importPath);
  }

  /**
   * Read a file's raw bytes, resolving the path through the same plugin file
   * manager the import subsystem uses (`_getPath`: expand → resolve → locate,
   * honoring search paths). Used by file-reading functions like `data-uri()`
   * and `image-size()` so they never touch raw `fs` for path resolution.
   *
   * A `#fragment` or `?query` suffix is stripped before resolution.
   */
  async readBinary(importPath: string): Promise<Buffer> {
    const cleanPath = importPath.split(/[?#]/)[0]!;
    const { resolvedPath } = await this._getPath(cleanPath);
    return readFile(resolvedPath);
  }

  /**
   * Parse a string content directly using the appropriate plugin
   */
  async parseString(content: string, options: {
    filePath?: string;
    type?: string;
    extension?: string;
  } = {}) {
    const { filePath, type, extension } = options;
    const virtualPath = filePath || `virtual.${extension || 'jess'}`;
    const ext = extension || path.extname(virtualPath);

    const plugin = this.findParserPlugin(type, ext);
    const result = this.parseSource(plugin, virtualPath, content, {
      compilerOptions: this.opts
    });
    this.errors.push(...result.errors);
    this.warnings.push(...result.warnings);
    if (result.errors.length > 0 && this.opts.breakOnError !== false) {
      throw makeJessErrorFromDiagnostic(result.errors[0]!);
    }
    const document = result.document;
    if (!document) {
      throw new Error('Failed to parse content');
    }
    if (!this.document) {
      this.document = document;
    }
    this.rememberDocumentContext(document, virtualPath, content, plugin);

    return {
      node: document,
      resolvedPath: virtualPath
    };
  }

  /**
   *
   * @param importPath
   * @param importOptions
   */
  async getModule(importPath: string, importOptions: ImportOptions = {}) {
    const { resolvedPath, triedPaths, friendlyPath } = await this._getPath(importPath);
    const ext = path.extname(resolvedPath);
    const isJsonImport = ext === '.json';
    const isScriptModuleImport = SCRIPT_MODULE_EXTENSIONS.has(ext);
    const { type } = importOptions;

    const plugins = this.plugins;

    if (!type && isJsonImport) {
      return {
        module: await importJsonModule(resolvedPath),
        triedPaths,
        resolvedPath
      };
    }

    if (isScriptModuleImport && (this.opts.disableScriptModules || this.opts.disablePluginRule)) {
      throw new Error(SCRIPT_MODULES_DISABLED_MESSAGE);
    }

    let plugin: PluginInterface | undefined;

    if (type) {
      plugin = plugins.find(plugin => plugin.name === type);
      if (!plugin) {
        throw new Error(`Plugin "${type}" not found`);
      }
      if (!plugin.import) {
        throw new Error(`Plugin "${type}" can't import modules`);
      }
    }

    if (!plugin) {
      plugin = plugins.find(plugin => plugin.supportedExtensions?.includes(ext) && plugin.import);
      if (!plugin) {
        plugin = await this.opts.loadPluginForExtension?.(ext);
        if (plugin && !this.plugins.includes(plugin)) {
          this.plugins.push(plugin);
        }
        if (plugin && (!plugin.supportedExtensions?.includes(ext) || !plugin.import)) {
          plugin = undefined;
        }
      }
      if (!plugin) {
        if (isScriptModuleImport) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable script execution features.');
        }
        throw new Error(`File "${friendlyPath}" not supported`);
      }
    }

    const module = await plugin.import!(resolvedPath);
    if (!module) {
      throw new Error(`File "${friendlyPath}" not supported`);
    }

    return {
      module,
      triedPaths,
      resolvedPath
    };
  }

  /**
   * Load an executable Plugin module through the same Context-owned path and
   * extension dispatch used by ordinary modules. The active dialect adapter
   * interprets the returned module; Context does not know a dialect ABI.
   */
  async getPluginModule(importPath: string, options: string | null = null) {
    const { resolvedPath, triedPaths, friendlyPath } = await this._getPath(importPath);
    const ext = path.extname(resolvedPath);
    let plugin = this.plugins.find(candidate =>
      candidate.supportedExtensions?.includes(ext) && candidate.importPlugin);
    if (!plugin) {
      plugin = await this.opts.loadPluginForExtension?.(ext);
      if (plugin && !this.plugins.includes(plugin)) {
        this.plugins.push(plugin);
      }
      if (plugin && (!plugin.supportedExtensions?.includes(ext) || !plugin.importPlugin)) {
        plugin = undefined;
      }
    }
    if (!plugin?.importPlugin) {
      throw new Error(`File "${friendlyPath}" is not supported as an executable plugin module.`);
    }
    return {
      module: await plugin.importPlugin(resolvedPath, options),
      triedPaths,
      resolvedPath
    };
  }

  /**
   * Hash a CSS class name or not depending on the `module` setting
   *
   * @todo - do module files have different contexts, therefore different
   * hash maps?
   */
  hashClass(name: string) {
    /** Remove dot for mapping */
    name = name.slice(1);
    let lookup = this.classMap.get(name);
    if (lookup) {
      return `.${lookup}`;
    }
    let mapVal: string;
    if (this.opts.module) {
      mapVal = `${name}_${this.id}`;
    } else {
      mapVal = name;
    }
    this.classMap.set(name, mapVal);
    return `.${mapVal}`;
  }

  shouldOperate(op: Operator, left: Node, right: Node) {
    const mathMode = this.options.mathMode;
    return shouldOperateWithMathFrames(
      {
        mathMode,
        parenFrames: this.parenFrames,
        calcFrames: this.calcFrames
      },
      op,
      left,
      right
    );
  }
}
