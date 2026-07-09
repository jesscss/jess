import { spanStartOf } from './provenance.js';
import type { Context } from '../../context.js';
import type { TriviaMap, Trivia } from '../../types/index.js';
import type { AtRule, AtRulePrelude } from '../at-rule.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import type { Nil } from '../nil.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

/**
 * A resolved spine import placement (IMPORTS increment 2/4). `css` — a CSS-passthrough
 * import already queued to `context.topImports` (emits nothing inline). `fold` — a
 * Less import whose registered placement `body` the spine descends inline; its scope
 * frame is already linked as an importer fallback by `wireSpineImports`. `dedupe`
 * (increment 4) — true when this is a SECOND+ import of the same resolved file under
 * `once`: its SCOPE is already registered/linked, so the emit fold emits NO output
 * (Less `once` semantics: emit the first occurrence, scope-only the rest). `reference`
 * (increment 5) — true for a `(reference)` import: the body descends with output
 * SUPPRESSED (`referenceMode`) while its scope + extend-reachability still register;
 * only an extend-reached selector emits.
 */
export type SpineImportPlacementEntry =
  | { kind: 'css' }
  | { kind: 'fold'; body: Rules; dedupe: boolean; multiple: boolean; reference: boolean };

export type PrintOptions = {
  /** The actual tree frames we started from */
  treeFrames?: (Ruleset | AtRule)[] | undefined;
  /** Tracks what ruleset or at-rule body we're serializing to the root */
  inFrames?: (Ruleset | AtRule)[] | undefined;
  /** Stored frames if we hoist a ruleset */
  lastRenderedFrames?: (Ruleset | AtRule)[] | undefined;
  frameHeaders?: string[];
  /** Current indentation depth (set by parent, used by children) */
  depth?: number;
  writer?: OutputWriter;
  compress?: boolean;
  collapseNesting?: boolean;
  context?: Context;
  inCustom?: boolean;
  /** True while traversing a referenced import/use tree. */
  referenceMode?: boolean;
  /** Effective render state while in referenceMode. */
  referenceRenderEnabled?: boolean;
  /** Enable SelectorList-level filtering of extend target members during reference rendering. */
  referenceFilterTargets?: boolean;
  /** Stack of composed selectors for collapseNesting on-demand composition and & resolution. */
  composedSelectorStack?: Selector[];
  /**
   * Session-local composed selector cache keyed by rendered ruleset, then by the
   * composed parent selector under which it was rendered. A shared canonical
   * node (e.g. a mixin body's nested ruleset) is rendered under multiple parents
   * — its own defining header and each call-site header — so the composed value
   * must not be shared across parent contexts.
   */
  composedSelectorCache?: WeakMap<Ruleset, Map<string, Selector>>;
  /** Render-local override for one at-rule header prelude during direct render. */
  atRuleHeaderNode?: AtRule;
  atRuleHeaderPrelude?: AtRulePrelude;
  /** Render-local override for one at-rule body during direct render. */
  atRuleBodyNode?: AtRule;
  atRuleBodyOverride?: import('../rules.js').Rules;
  /**
   * Spine-mode selector override (P1 §2, OQ-A). When `spineSelectorNode === this`
   * ruleset, its header composes from `spineSelector` — the selector resolved
   * (`selector.eval`) against the live value-frame at ruleset-enter — instead of
   * the raw authored `this.selector`. This is how INTERPOLATED selectors
   * (`[data=@{attr}]`, `.@{name}`) reach their CONCRETE form in the single pass,
   * and is the OQ-A prerequisite: extend sees the resolved selector. It is a
   * transient render-local override (a resolved selector is OUTPUT-AFFECTING, so
   * per the loosened canonical-mutation invariant it must NOT live on the shared
   * canonical node) mirroring the `atRuleHeaderPrelude` pattern.
   */
  spineSelectorNode?: Ruleset;
  spineSelector?: Selector | Nil;
  /**
   * Spine-mode EXTEND header override (P3 §4.3 increment 1). Maps a root-level SUBJECT
   * ruleset to its FINAL composed multi-branch header (a `SelectorList` of the authored own
   * form + document-order-sorted extend contributions, from `composeFlatSubjectHeaders`).
   * When present for `this` ruleset, `effectiveHeaderSelector` returns it so the header
   * emits with the added extend branches (`.a,\n.b`) instead of the authored `.a`. Only
   * subjects that gained a branch appear; absence = stream the authored header. A transient
   * render-local override (output-affecting → not on the canonical node), like `spineSelector`.
   */
  spineExtendHeaders?: Map<Ruleset, Selector>;
  /**
   * Spine-mode EXTEND HOIST marker (P3 §4.3 increment 3 — `&`-crossing hoist-to-root). The
   * subset of `spineExtendHeaders` subjects whose override is a HOISTED projection — the
   * subject's own composed form is ALREADY the full root-composed selector (`.header .header-nav`)
   * and a crossing contribution (`.footer .footer-nav`) joins it as a root-level sibling branch.
   * For a hoisted subject the header override is emitted VERBATIM (skip the parent-frame
   * `composeSelector`) — the projection is already root-composed, so re-composing against the
   * `.header` frame would double it. PRECONDITION (JSDoc'd at the write site): this holds ONLY
   * under `collapseNesting:true`, where a nested block already emits at ROOT with its composed
   * header; expanded mode keeps the block nested and is excluded (stays on eval). Strictly gated:
   * the verbatim path fires ONLY for a ruleset in THIS set — a non-hoisted nested subject still
   * composes normally against its parent.
   */
  spineExtendHoisted?: Set<Ruleset>;
  /**
   * Spine-mode at-rule marker (P1 §4/§7). When `spineAtRuleNode === this` at-rule,
   * its value-frame has already been pushed by `serializeSpineFrameAtRule` and its
   * prelude resolved-at-enter (handed to the header via the existing
   * `atRuleHeaderNode`/`atRuleHeaderPrelude` override). Doubles as the re-entry
   * guard so the spine setup runs once per at-rule, then the descent proceeds.
   */
  spineAtRuleNode?: AtRule;
  /**
   * Spine-mode `+:`/`+_:` merge plan for the CURRENT body (P1). Keyed by source
   * declaration: a `suppress` entry emits nothing; an `anchor` entry emits the
   * coalesced value. Built at body-enter by `planBodyMerges`; consulted by the
   * leaf resolver. Undefined when the body has no merge-flagged declarations
   * (the common case pays nothing).
   */
  spineMergePlan?: import('./spine-merge.js').SpineMergePlan;
  /**
   * Spine-mode `?:` conditional-assign plan for the CURRENT body. Keyed by source
   * declaration: an `anchor` entry emits the resolved value (the eval-path self-
   * reference read — prior binding or fallback). Built at body-enter by
   * `planBodyConditionals`; consulted by the leaf resolver. Undefined when the
   * body has no `?:` declaration (the common case pays nothing).
   */
  spineCondPlan?: import('./spine-cond.js').SpineCondPlan;
  /** Whether the current ampersand is at the start of its containing selector. */
  ampersandFirst?: boolean;
  trivia?: TriviaMap;
  emittedTrivia?: Set<Trivia>;
  suppressBoundaryTrivia?: 'pre' | 'post' | 'both';
  sourceMap?: boolean;
  /**
   * Single-pass spine mode (P1, UNIFIED-EVAL-EMIT §2). When set, the container
   * serializer descends the SOURCE tree with the live value-frame threaded and
   * resolves each leaf against that frame at emit time — instead of reading a
   * pre-evaluated output tree. This REPLACES the eval→output-tree→serialize
   * two-walk on the wired path (no eval() call, no `state.output`); it is not a
   * dual path — the eval path only runs for shapes the spine does not yet cover.
   *
   * Async discipline (§2): leaf resolution is SYNC by default. It bails to an
   * async continuation ONLY when `eval` returns a genuine thenable (an async
   * import result / JS function / reference to an async value) — reactively, via
   * `isThenable`, never a pre-scan/flag to predetermine async-ness (that was
   * `F_MAY_ASYNC`, deleted) and never a speculative `awaitable-pipe` await. So a
   * `calc()`/`Operation` whose subtree is fully sync pays ZERO async cost.
   */
  spineMode?: boolean;
  /**
   * Spine import-fold cache (IMPORTS increment 2). Maps each spine-foldable
   * `StyleImport` to its resolved placement (`resolveForSpine` result), populated
   * ONCE by the root pre-registration pass (`wireSpineImports`) which registers the
   * imported body's scope into the placement frame and links it as an importer
   * fallback. The emit fold (`_emitSpineImportFold` / `runSpineImportExpansion`)
   * reads from here to descend the SAME registered placement — so an import is
   * resolved + registered exactly once, and a consumer (`#library.sizes[@width]`,
   * an imported `@var`) resolves against the linked scope. Keyed by node identity.
   */
  spineImportPlacements?: Map<Node, SpineImportPlacementEntry>;
  /**
   * Spine import DEDUP ledger (IMPORTS increment 4). The set of RESOLVED import
   * paths already emitted-as-output during this render. Populated as the wire pass
   * (`wireSpineImportsInBody`) resolves each import in document order: the FIRST
   * import of a path adds it and emits output; a later import of the SAME path (under
   * `once`, default) finds it present and is marked `dedupe` (scope-only, no output)
   * — Less import-once semantics. `multiple` bypasses the ledger (always emits, never
   * recorded as the once-owner). Same render lifetime as `spineImportPlacements`.
   */
  spineEmittedImportPaths?: Set<string>;
  /**
   * Spine MULTIPLE-import scope depth (IMPORTS increment 4). Incremented while
   * descending a `@import (multiple)` / `once:false` import's body: a nested import
   * inside a multiple-scoped body ALSO re-emits (does not dedup), mirroring the eval
   * path's `context.inMultipleImportScope`. `spineImportDedupeVerdict` returns
   * "emit" (never `dedupe`) whenever this depth is > 0. Zero (the default) = normal
   * `once` dedup applies.
   */
  spineMultipleImportDepth?: number;
  /** Output syntax target, e.g. 'jess' for Jess canonical output. */
  syntax?: string;
  /** Jess conversion options for rewriting import paths during serialization. */
  conversion?: {
    mapPath?: (sourcePath: string) => string;
    outputDir?: string;
    sourceRoot?: string;
    fromFilePath?: string;
  };
  /**
   * Root-render hook fired on the EVALUATED root tree after `render()` drives
   * eval and BEFORE serialization. Lets the compiler run post-eval / pre-render
   * plugin visitors on the evaluated tree without a separate pre-pass eval (D3 —
   * single render driver). Return a replacement root to swap what gets
   * serialized; returning void keeps the (possibly mutated in place) tree. Only
   * consulted for a root (`sourceWasRoot`) render.
   */
  preSerializeRoot?: (evaluatedRoot: import('../rules.js').Rules) => MaybePromise<import('../rules.js').Rules | void>;
};

export type FinalPrintOptions = PrintOptions & {
  writer: OutputWriter;
  depth: number;
  inFrames: (Ruleset | AtRule)[];
  treeFrames: (Ruleset | AtRule)[];
  frameHeaders: string[];
  lastRenderedFrames: (Ruleset | AtRule)[];
};

type RestorablePrintStateKey =
  | 'ampersandFirst'
  | 'collapseNesting'
  | 'context'
  | 'composedSelectorStack'
  | 'depth'
  | 'inCustom'
  | 'inFrames'
  | 'referenceFilterTargets'
  | 'referenceMode'
  | 'referenceRenderEnabled'
  | 'sourceMap'
  | 'suppressBoundaryTrivia'
  | 'writer';

const DEFAULT_SPACER_SHOULD_ADD = (nextText: string): boolean => !/^[ \t\r\n\f]/u.test(nextText);

function isTriviaMap(value: unknown): value is TriviaMap {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (
    !('lookup' in value)
    || !('entries' in value)
    || !('has' in value)
  ) {
    return false;
  }
  return typeof value.lookup === 'function'
    && typeof value.entries === 'function'
    && typeof value.has === 'function';
}

function ensureFinalPrintOptions(options: PrintOptions): asserts options is FinalPrintOptions {
  options.depth ??= 0;
  if (options.sourceMap === undefined && options.context?.opts?.output?.sourceMap !== undefined) {
    options.sourceMap = Boolean(options.context.opts.output.sourceMap);
  }
  options.writer ??= new OutputWriter(options.sourceMap === true);
  options.inFrames ??= [];
  options.frameHeaders ??= [];
  options.treeFrames ??= [];
  options.lastRenderedFrames ??= [];
  options.referenceMode ??= false;
  options.referenceRenderEnabled ??= true;
  options.referenceFilterTargets ??= false;
  options.composedSelectorCache ??= new WeakMap();
  options.emittedTrivia ??= new Set();
}

export interface OutputWriter {
  add(text: string, origin?: unknown): void;
  markSource(origin?: unknown): void;
  addSpacer(text: string): void;
  queueSpacer(text: string, shouldAdd?: (nextText: string) => boolean): void;
  mark(): number;
  position(): number;
  writesTo(chunks: string[]): boolean;
  getSince(mark: number): string;
  hasContentSince(mark: number): boolean;
  preview(fn: () => string | void, preserveSegments?: boolean): string;
  preview(fn: () => Promise<string | void>, preserveSegments?: boolean): Promise<string>;
  endsWith(suffix: string): boolean;
  lastChar(): string | undefined;
  replaceSince(mark: number, replacer: (text: string) => string, origin?: unknown): void;
  trimStartSince(mark: number): void;
  trimHorizontalStartSince(mark: number): void;
  trimHorizontalEndSince(mark: number): void;
  trimEndSince(mark: number): void;
  toString(): string;
  toSourceMapV3(): any;
  getSegments(): SourceSegment[];
}

export type SourceSegment = {
  genLine: number;     // 0-based
  genColumn: number;   // 0-based
  source?: string;     // file full path or name
  origLine: number;    // 0-based
  origColumn: number;  // 0-based
};

type SourceMapTreeContext = {
  file?: {
    fullPath?: string;
    path?: string;
    name?: string;
    source?: string;
  };
};

type SourceMapSourceRoot = {
  _treeContext?: SourceMapTreeContext;
};

type SourceMapOrigin = {
  sourceRoot?: SourceMapSourceRoot;
};

const isSourceMapOrigin = (value: unknown): value is SourceMapOrigin => {
  return typeof value === 'object' && value !== null;
};

/** 0-based line/column at a source offset (line/col are derived, not stored). */
export function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 0;
  let lineStart = 0;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart };
}

function sourceSegmentFor(originParam: unknown, genLine: number, genColumn: number): SourceSegment | undefined {
  const origin = isSourceMapOrigin(originParam) ? originParam : undefined;
  const offset = origin ? spanStartOf(origin) : undefined;
  if (typeof offset !== 'number') {
    return undefined;
  }
  const treeContext = origin?.sourceRoot?._treeContext;
  const file = treeContext?.file?.fullPath || treeContext?.file?.path || treeContext?.file?.name;
  // Original line/col derive from the source offset + source text (cold path).
  const source = treeContext?.file?.source;
  const { line, column } = source !== undefined
    ? offsetToLineCol(source, offset)
    : { line: 0, column: 0 };
  return {
    genLine,
    genColumn,
    source: file,
    origLine: line,
    origColumn: column
  };
}

export function getPrintOptions(options?: PrintOptions): FinalPrintOptions {
  if (options?.context) {
    if (options !== options.context.printState) {
      const hasExplicitPrintState = (
        options.writer !== undefined
        || options.inFrames !== undefined
        || options.treeFrames !== undefined
        || options.lastRenderedFrames !== undefined
        || options.frameHeaders !== undefined
      );
      if (hasExplicitPrintState) {
        const detached = options;
        if (detached.collapseNesting === undefined && detached.context?.opts?.output?.collapseNesting !== undefined) {
          detached.collapseNesting = Boolean(detached.context.opts.output.collapseNesting);
        }
        ensureFinalPrintOptions(detached);
        return detached;
      }
      return prepareContextPrintState(options.context, options);
    }
    const resolved = options.context.printState;
    if (resolved.collapseNesting === undefined && resolved.context?.opts?.output?.collapseNesting !== undefined) {
      resolved.collapseNesting = Boolean(resolved.context.opts.output.collapseNesting);
    }
    ensureFinalPrintOptions(resolved);
    return resolved;
  }
  const resolved = options ?? {};
  // Derive collapseNesting from context when missing so nested vs flat is correct for & serialization
  if (resolved.collapseNesting === undefined && resolved.context?.opts?.output?.collapseNesting !== undefined) {
    resolved.collapseNesting = Boolean(resolved.context.opts.output.collapseNesting);
  }
  // Always ensure frameState exists - nodes should not need to check for it
  ensureFinalPrintOptions(resolved);
  return resolved;
}

export function prepareRenderPrintState(context: Context, options?: PrintOptions): FinalPrintOptions {
  const canReuseActivePrintState = (
    options?.context === context
    && (
      options.writer !== undefined
      || options.inFrames !== undefined
      || options.treeFrames !== undefined
      || options.lastRenderedFrames !== undefined
      || options.frameHeaders !== undefined
    )
  );
  return canReuseActivePrintState
    ? getPrintOptions(options)
    : prepareContextPrintState(context, options);
}

export function prepareContextPrintState(context: Context, seed?: PrintOptions): FinalPrintOptions {
  const state = context.printState;

  state.context = context;
  state.treeFrames = [];
  state.inFrames = [];
  state.lastRenderedFrames = [];
  state.frameHeaders = [];
  state.depth = 0;
  state.sourceMap = seed?.sourceMap ?? Boolean(context.opts.output?.sourceMap);
  state.writer = seed?.writer ?? new OutputWriter(state.sourceMap === true);
  state.compress = seed?.compress;
  state.collapseNesting = seed?.collapseNesting;
  state.inCustom = seed?.inCustom;
  state.referenceMode = seed?.referenceMode ?? false;
  state.referenceRenderEnabled = seed?.referenceRenderEnabled ?? true;
  state.referenceFilterTargets = seed?.referenceFilterTargets ?? false;
  state.composedSelectorStack = seed?.composedSelectorStack;
  state.composedSelectorCache = new WeakMap();
  state.ampersandFirst = seed?.ampersandFirst;
  const contextTrivia = 'trivia' in context.opts ? context.opts.trivia : undefined;
  state.trivia = seed?.trivia ?? (isTriviaMap(contextTrivia) ? contextTrivia : undefined);
  state.emittedTrivia = new Set();

  if (state.collapseNesting === undefined && context.opts.output?.collapseNesting !== undefined) {
    state.collapseNesting = Boolean(context.opts.output.collapseNesting);
  }

  ensureFinalPrintOptions(state);
  return state;
}

export type SavedPrintState = Array<[RestorablePrintStateKey, unknown]>;

export function savePrintState(
  options: PrintOptions,
  keys: readonly RestorablePrintStateKey[]
): SavedPrintState {
  const saved: SavedPrintState = [];
  for (const key of keys) {
    saved.push([key, options[key]]);
  }
  return saved;
}

export function restorePrintState(
  options: PrintOptions,
  saved: SavedPrintState
): void {
  for (let i = 0; i < saved.length; i++) {
    const [key, value] = saved[i]!;
    (options as Record<string, unknown>)[key] = value;
  }
}

export function saveArrayState<T>(array: T[] | undefined): T[] | undefined {
  return array?.slice();
}

export function restoreArrayState<T>(
  array: T[] | undefined,
  saved: readonly T[] | undefined
): void {
  if (!array) {
    return;
  }
  array.splice(0, array.length, ...(saved ?? []));
}

export function saveSetState<T>(set: Set<T> | undefined): Set<T> | undefined {
  return set ? new Set(set) : undefined;
}

export function restoreSetState<T>(
  set: Set<T> | undefined,
  saved: ReadonlySet<T> | undefined
): void {
  if (!set || !saved) {
    return;
  }
  set.clear();
  for (const value of saved) {
    set.add(value);
  }
}

export function withScratchEmittedTrivia<T>(options: PrintOptions, fn: () => T): T {
  const saved = options.emittedTrivia;
  options.emittedTrivia = new Set();
  try {
    return fn();
  } finally {
    options.emittedTrivia = saved;
  }
}

export function getCachedComposedSelector(
  options: FinalPrintOptions,
  ruleset: Ruleset,
  parentKey = ''
): Selector | undefined {
  return options.composedSelectorCache?.get(ruleset)?.get(parentKey);
}

/** True if `this` ruleset has produced a composed selector equal to `text` under any parent context. */
export function cachedComposedMatches(
  options: FinalPrintOptions,
  ruleset: Ruleset,
  text: string
): boolean {
  const byParent = options.composedSelectorCache?.get(ruleset);
  if (!byParent) {
    return false;
  }
  for (const composed of byParent.values()) {
    if (composed.valueOf() === text) {
      return true;
    }
  }
  return false;
}

export function setCachedComposedSelector(
  options: FinalPrintOptions,
  ruleset: Ruleset,
  selector: Selector,
  parentKey = ''
): void {
  const cache = options.composedSelectorCache;
  if (!cache) {
    return;
  }
  let byParent = cache.get(ruleset);
  if (!byParent) {
    byParent = new Map();
    cache.set(ruleset, byParent);
  }
  byParent.set(parentKey, selector);
}

export class OutputWriter implements OutputWriter {
  private chunks: string[] = [];
  private _length = 0;
  private _line = 0;
  private _column = 0;
  private _segments: SourceSegment[] = [];
  private _posLine: number[] = [];
  private _posColumn: number[] = [];
  private _posSegments: number[] = [];
  private _posLength: number[] = [];
  /** Diagnostic: remember the origin that last wrote a trailing newline */
  private _lastNewlineOrigin: unknown = undefined;
  /** Store segments from the most recent capture for merging when content is added back */
  private _capturedSegments: SourceSegment[] | null = null;
  private _queuedSpacerText = '';
  private _queuedSpacerShouldAdd: ((nextText: string) => boolean) | undefined;

  constructor(private readonly tracksSources = true, chunks?: string[]) {
    if (chunks) {
      this.chunks = chunks;
      if (chunks.length > 0) {
        this.refreshPositions();
      }
    }
  }

  get line() {
    return this._line;
  }

  get column() {
    return this._column;
  }

  markSource(originParam?: unknown): void {
    if (!this.tracksSources) {
      return;
    }
    const segment = sourceSegmentFor(originParam, this._line, this._column);
    if (segment) {
      this._segments.push(segment);
    }
  }

  add(text: string, originParam?: unknown): void {
    if (!text) {
      return;
    }
    const queuedSpacerText = this._queuedSpacerText;
    if (queuedSpacerText) {
      const shouldAdd = this._queuedSpacerShouldAdd ?? DEFAULT_SPACER_SHOULD_ADD;
      this.clearQueuedSpacer();
      if (shouldAdd(text)) {
        this.addSpacer(queuedSpacerText);
      }
    }
    const chunkIndex = this.chunks.length;
    this.chunks.push(text);
    this._length += text.length;
    if (!this.tracksSources) {
      this.recordPosition(chunkIndex);
      if (!originParam) {
        this._capturedSegments = null;
      }
      return;
    }

    const currentLine = this._line;
    const currentColumn = this._column;

    // If we have captured segments and we're adding with an origin, merge them
    // This happens when captured content is added back (e.g., in Declaration.declTrimmedString)
    if (this._capturedSegments && originParam) {
      // Adjust captured segment positions to current writer position and add them
      for (const seg of this._capturedSegments) {
        // If segment is on the same line as capture start, add column offset
        // If segment is on a different line, column is already correct (relative to that line)
        const adjustedColumn = seg.genLine === 0 ? currentColumn + seg.genColumn : seg.genColumn;
        this._segments.push({
          genLine: currentLine + seg.genLine,
          genColumn: adjustedColumn,
          source: seg.source,
          origLine: seg.origLine,
          origColumn: seg.origColumn
        });
      }
      this._capturedSegments = null; // Clear after merging
    }

    // Record a mapping segment if we have origin location info
    this.markSource(originParam);

    // Track if the chunk ends with a newline and record its origin (for diagnostics)
    if (text.endsWith('\n')) {
      this._lastNewlineOrigin = originParam;
    }

    // Fast path: no newlines
    let i = text.indexOf('\n');
    if (i === -1) {
      this._column += text.length;
      this.recordPosition(chunkIndex);
      // Clear captured segments if we added content without origin (normal add, not merging captured content)
      if (!originParam) {
        this._capturedSegments = null;
      }
      return;
    }

    // Count newlines and compute trailing column after last newline
    this._line++;
    for (;;) {
      const next = text.indexOf('\n', i + 1);
      if (next === -1) {
        break;
      }
      this._line++;
      i = next;
    }
    this._column = text.length - (i + 1);
    this.recordPosition(chunkIndex);
    // Clear captured segments if we added content without origin
    if (!originParam) {
      this._capturedSegments = null;
    }
  }

  addSpacer(text: string): void {
    if (!text) {
      return;
    }
    const pendingSegments = this._capturedSegments;
    this.add(text);
    this._capturedSegments = pendingSegments;
  }

  queueSpacer(text: string, shouldAdd: (nextText: string) => boolean = DEFAULT_SPACER_SHOULD_ADD): void {
    if (!text) {
      return;
    }
    this._queuedSpacerText = text;
    this._queuedSpacerShouldAdd = shouldAdd;
  }

  mark(): number {
    return this.chunks.length;
  }

  position(): number {
    return this.chunks.length;
  }

  writesTo(chunks: string[]): boolean {
    return this.chunks === chunks;
  }

  getSince(mark: number): string {
    if (mark < 0 || mark > this.chunks.length) {
      return '';
    }
    const length = this.chunks.length;
    if (mark === length) {
      return '';
    }
    if (mark === length - 1) {
      return this.chunks[mark] ?? '';
    }
    let out = '';
    for (let i = mark; i < length; i++) {
      out += this.chunks[i] ?? '';
    }
    return out;
  }

  hasContentSince(mark: number): boolean {
    if (mark < 0 || mark > this.chunks.length) {
      return false;
    }
    for (let i = mark; i < this.chunks.length; i++) {
      if (this.chunks[i]) {
        return true;
      }
    }
    return false;
  }

  preview(fn: () => string | void, preserveSegments?: boolean): string;
  preview(fn: () => Promise<string | void>, preserveSegments?: boolean): Promise<string>;
  preview(fn: () => MaybePromise<string | void>, preserveSegments = false): MaybePromise<string> {
    const mark = this.mark();
    const segmentsBefore = this._segments.length;
    const finish = (out: string | void): string => {
      const text = this.getSince(mark) || (typeof out === 'string' ? out : '');
      const segmentsCreated = preserveSegments ? this._segments.slice(segmentsBefore) : [];
      this.restore(mark);
      if (preserveSegments) {
        this._capturedSegments = segmentsCreated.length > 0 ? segmentsCreated : null;
      }
      return text;
    };
    const out = fn();
    return isThenable(out)
      ? out.then(finish)
      : finish(out);
  }

  endsWith(suffix: string): boolean {
    if (suffix === '') {
      return true;
    }
    if (suffix.length > this._length) {
      return false;
    }
    let suffixIndex = suffix.length;
    for (let i = this.chunks.length - 1; i >= 0 && suffixIndex > 0; i--) {
      const chunk = this.chunks[i]!;
      const size = Math.min(chunk.length, suffixIndex);
      const chunkStart = chunk.length - size;
      const suffixStart = suffixIndex - size;
      if (chunk.slice(chunkStart) !== suffix.slice(suffixStart, suffixIndex)) {
        return false;
      }
      suffixIndex -= size;
    }
    return suffixIndex === 0;
  }

  lastChar(): string | undefined {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const chunk = this.chunks[i]!;
      if (chunk) {
        return chunk.at(-1);
      }
    }
    return undefined;
  }

  replaceSince(mark: number, replacer: (text: string) => string, origin?: unknown): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    const segmentMark = mark > 0 ? (this._posSegments[mark - 1] ?? 0) : 0;
    const segmentsCreated = this._segments.slice(segmentMark);
    const replacement = replacer(this.getSince(mark));
    this.restore(mark);
    this._capturedSegments = segmentsCreated.length > 0 ? segmentsCreated : null;
    this.add(replacement, origin);
  }

  trimStartSince(mark: number): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    let first = mark;
    while (first < this.chunks.length) {
      const chunk = this.chunks[first]!;
      const trimmed = chunk.replace(/^[ \t\r\n\f]+/u, '');
      if (trimmed.length === chunk.length) {
        break;
      }
      if (trimmed) {
        this.chunks[first] = trimmed;
        break;
      }
      this.chunks[first] = '';
      first++;
    }
    this.refreshPositions(mark);
  }

  trimHorizontalStartSince(mark: number): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    let first = mark;
    while (first < this.chunks.length) {
      const chunk = this.chunks[first]!;
      const trimmed = chunk.replace(/^[ \t\r\f]+/u, '');
      if (trimmed.length === chunk.length) {
        break;
      }
      if (trimmed) {
        this.chunks[first] = trimmed;
        break;
      }
      this.chunks[first] = '';
      first++;
    }
    this.refreshPositions(mark);
  }

  trimHorizontalEndSince(mark: number): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    let last = this.chunks.length - 1;
    while (last >= mark) {
      const chunk = this.chunks[last]!;
      const trimmed = chunk.replace(/[ \t\r\f]+$/u, '');
      if (trimmed.length === chunk.length) {
        break;
      }
      if (trimmed) {
        this.chunks[last] = trimmed;
        this.chunks.length = last + 1;
        break;
      }
      this.chunks.length = last;
      last--;
    }
    this.refreshPositions(mark);
  }

  trimEndSince(mark: number): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    let last = this.chunks.length - 1;
    while (last >= mark) {
      const chunk = this.chunks[last]!;
      const trimmed = chunk.replace(/[ \t\r\n\f]+$/u, '');
      if (trimmed.length === chunk.length) {
        break;
      }
      if (trimmed) {
        this.chunks[last] = trimmed;
        this.chunks.length = last + 1;
        break;
      }
      this.chunks.length = last;
      last--;
    }
    this.refreshPositions(mark);
  }

  /** Restore writer state to a given mark, discarding appended chunks and segments */
  restore(mark: number): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    this.chunks.length = mark;
    const posIndex = mark - 1;
    if (!this.tracksSources) {
      this._length = posIndex >= 0 ? (this._posLength[posIndex] ?? 0) : 0;
      this._line = 0;
      this._column = 0;
      this._segments.length = 0;
      this.truncatePositions(mark);
      this.clearQueuedSpacer();
      return;
    }
    if (posIndex >= 0 && posIndex < this._posLine.length) {
      this._line = this._posLine[posIndex] ?? 0;
      this._column = this._posColumn[posIndex] ?? 0;
      this._segments.length = this._posSegments[posIndex] ?? 0;
      this._length = this._posLength[posIndex] ?? 0;
    } else {
      this._line = 0;
      this._column = 0;
      this._segments.length = 0;
      this._length = 0;
    }
    this.truncatePositions(mark);
    this.clearQueuedSpacer();
  }

  private refreshPositions(from = 0): void {
    const start = from > 0 ? from : 0;
    const seedIndex = start - 1;
    if (!this.tracksSources) {
      this._length = seedIndex >= 0 ? (this._posLength[seedIndex] ?? 0) : 0;
      for (let i = start; i < this.chunks.length; i++) {
        this._length += this.chunks[i]!.length;
        this._posLength[i] = this._length;
      }
      this._posLength.length = this.chunks.length;
      // The tracksSources arrays are unused in this branch, but keep
      // line/column/segments in their reset state to match prior behavior.
      if (start === 0) {
        this._posLine.length = 0;
        this._posColumn.length = 0;
        this._posSegments.length = 0;
        this._line = 0;
        this._column = 0;
        this._segments.length = 0;
      }
      return;
    }
    if (seedIndex >= 0 && seedIndex < this._posLine.length) {
      this._length = this._posLength[seedIndex] ?? 0;
      this._line = this._posLine[seedIndex] ?? 0;
      this._column = this._posColumn[seedIndex] ?? 0;
    } else {
      this._length = 0;
      this._line = 0;
      this._column = 0;
    }
    for (let i = start; i < this.chunks.length; i++) {
      const text = this.chunks[i]!;
      const segmentCount = this._posSegments[i] ?? this._segments.length;
      this._length += text.length;
      const newline = text.lastIndexOf('\n');
      if (newline === -1) {
        this._column += text.length;
      } else {
        let lineBreaks = 1;
        for (let next = text.indexOf('\n', 0); ;) {
          next = text.indexOf('\n', next + 1);
          if (next === -1) {
            break;
          }
          lineBreaks++;
        }
        this._column = text.length - (newline + 1);
        this._line += lineBreaks;
      }
      this._posLine[i] = this._line;
      this._posColumn[i] = this._column;
      this._posSegments[i] = segmentCount;
      this._posLength[i] = this._length;
    }
    this._posLine.length = this.chunks.length;
    this._posColumn.length = this.chunks.length;
    this._posLength.length = this.chunks.length;
    this._posSegments.length = this.chunks.length;
    const lastIndex = this.chunks.length - 1;
    this._segments.length = lastIndex >= 0 ? (this._posSegments[lastIndex] ?? 0) : 0;
  }

  private recordPosition(index: number): void {
    if (!this.tracksSources) {
      this._posLength[index] = this._length;
      return;
    }
    this._posLine[index] = this._line;
    this._posColumn[index] = this._column;
    this._posSegments[index] = this._segments.length;
    this._posLength[index] = this._length;
  }

  private truncatePositions(length: number): void {
    if (this.tracksSources) {
      this._posLine.length = length;
      this._posColumn.length = length;
      this._posSegments.length = length;
    }
    this._posLength.length = length;
  }

  private clearQueuedSpacer(): void {
    this._queuedSpacerText = '';
    this._queuedSpacerShouldAdd = undefined;
  }

  /** Capture output from a function without committing to the main buffer */
  capture(fn: () => void): string {
    const m = this.mark();
    const segmentsBefore = this._segments.length;
    fn();
    const s = this.getSince(m);
    // Store segments created during capture (but don't add to main buffer)
    const segmentsCreated = this._segments.slice(segmentsBefore);
    this.restore(m);
    // Store captured segments for potential merging when content is added back
    this._capturedSegments = segmentsCreated.length > 0 ? segmentsCreated : null;
    return s;
  }

  toString(): string {
    return this.chunks.join('');
  }

  toSourceMapV3(): any {
    return null;
  }

  getSegments(): SourceSegment[] {
    return this._segments;
  }

  /** Diagnostic accessor */
  getLastNewlineOrigin(): unknown {
    return this._lastNewlineOrigin;
  }
}
