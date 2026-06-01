import type { Context } from '../../context.js';
import type { IToken } from 'chevrotain';
import type { TriviaMap } from '../../types/index.js';
import type { AtRule } from '../at-rule.js';
import type { Node } from '../node.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

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
  /** Session-local composed selector cache keyed by rendered ruleset. */
  composedSelectorCache?: WeakMap<Ruleset, Selector>;
  /** Render-local override for one at-rule header prelude during direct render. */
  atRuleHeaderNode?: AtRule;
  atRuleHeaderPrelude?: Node;
  /** Render-local override for one at-rule body during direct render. */
  atRuleBodyNode?: AtRule;
  atRuleBodyOverride?: import('../rules.js').Rules;
  /** Render-local override for one at-rule hoist flag during direct render. */
  atRuleHoistNode?: AtRule;
  atRuleHoistOverride?: boolean;
  /** Render-local override for one at-rule frame stack during direct render. */
  atRuleFrameNode?: AtRule;
  atRuleFrameOverride?: (Ruleset | AtRule)[];
  /** Whether the current ampersand is at the start of its containing selector. */
  ampersandFirst?: boolean;
  trivia?: TriviaMap;
  emittedTrivia?: Set<IToken[]>;
  suppressBoundaryTrivia?: 'pre' | 'post' | 'both';
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
  | 'suppressBoundaryTrivia'
  | 'writer';

function isTriviaMap(value: unknown): value is TriviaMap {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'runs') instanceof Set
    && typeof Reflect.get(value, 'lookup') === 'function'
    && typeof Reflect.get(value, 'entries') === 'function'
    && typeof Reflect.get(value, 'has') === 'function'
  );
}

function ensureFinalPrintOptions(options: PrintOptions): asserts options is FinalPrintOptions {
  options.depth ??= 0;
  options.writer ??= new OutputWriter();
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

type SourceMapOrigin = {
  location?: unknown;
  treeContext?: {
    file?: {
      fullPath?: string;
      path?: string;
      name?: string;
    };
  };
};

const isSourceMapOrigin = (value: unknown): value is SourceMapOrigin => {
  return typeof value === 'object' && value !== null;
};

function sourceSegmentFor(originParam: unknown, genLine: number, genColumn: number): SourceSegment | undefined {
  const origin = isSourceMapOrigin(originParam) ? originParam : undefined;
  const loc = origin?.location;
  if (!loc || !Array.isArray(loc) || loc.length !== 6) {
    return undefined;
  }
  const startLine = (loc[1] ?? 1) - 1;
  const startColumn = (loc[2] ?? 1) - 1;
  const file = origin?.treeContext?.file?.fullPath || origin?.treeContext?.file?.path || origin?.treeContext?.file?.name;
  return {
    genLine,
    genColumn,
    source: file,
    origLine: startLine,
    origColumn: startColumn
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
        if (detached.collapseNesting === undefined && detached.context?.opts?.collapseNesting !== undefined) {
          detached.collapseNesting = Boolean(detached.context.opts.collapseNesting);
        }
        ensureFinalPrintOptions(detached);
        return detached;
      }
      return prepareContextPrintState(options.context, options);
    }
    const resolved = options.context.printState;
    if (resolved.collapseNesting === undefined && resolved.context?.opts?.collapseNesting !== undefined) {
      resolved.collapseNesting = Boolean(resolved.context.opts.collapseNesting);
    }
    ensureFinalPrintOptions(resolved);
    return resolved;
  }
  const resolved = options ?? {};
  // Derive collapseNesting from context when missing so nested vs flat is correct for & serialization
  if (resolved.collapseNesting === undefined && resolved.context?.opts?.collapseNesting !== undefined) {
    resolved.collapseNesting = Boolean(resolved.context.opts.collapseNesting);
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
  state.writer = seed?.writer ?? new OutputWriter();
  state.compress = seed?.compress;
  state.collapseNesting = seed?.collapseNesting;
  state.inCustom = seed?.inCustom;
  state.referenceMode = seed?.referenceMode ?? false;
  state.referenceRenderEnabled = seed?.referenceRenderEnabled ?? true;
  state.referenceFilterTargets = seed?.referenceFilterTargets ?? false;
  state.composedSelectorStack = seed?.composedSelectorStack;
  state.composedSelectorCache = new WeakMap();
  state.ampersandFirst = seed?.ampersandFirst;
  const contextTrivia = Reflect.get(context.opts, 'trivia');
  state.trivia = seed?.trivia ?? (isTriviaMap(contextTrivia) ? contextTrivia : undefined);
  state.emittedTrivia = new Set();

  if (state.collapseNesting === undefined && context.opts.collapseNesting !== undefined) {
    state.collapseNesting = Boolean(context.opts.collapseNesting);
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

export function getCachedComposedSelector(
  options: FinalPrintOptions,
  ruleset: Ruleset
): Selector | undefined {
  return options.composedSelectorCache?.get(ruleset);
}

export function setCachedComposedSelector(
  options: FinalPrintOptions,
  ruleset: Ruleset,
  selector: Selector
): void {
  options.composedSelectorCache?.set(ruleset, selector);
}

export class OutputWriter implements OutputWriter {
  private chunks: string[] = [];
  private _length = 0;
  private _line = 0;
  private _column = 0;
  private _segments: SourceSegment[] = [];
  private _positions: Array<{ line: number; column: number; segments: number; length: number }> = [];
  /** Diagnostic: remember the origin that last wrote a trailing newline */
  private _lastNewlineOrigin: unknown = undefined;
  /** Store segments from the most recent capture for merging when content is added back */
  private _capturedSegments: SourceSegment[] | null = null;
  private _queuedSpacer: { text: string; shouldAdd: (nextText: string) => boolean } | null = null;

  get line() {
    return this._line;
  }

  get column() {
    return this._column;
  }

  markSource(originParam?: unknown): void {
    const segment = sourceSegmentFor(originParam, this._line, this._column);
    if (segment) {
      this._segments.push(segment);
    }
  }

  add(text: string, originParam?: unknown): void {
    if (!text) {
      return;
    }
    const queuedSpacer = this._queuedSpacer;
    if (queuedSpacer) {
      this._queuedSpacer = null;
      if (queuedSpacer.shouldAdd(text)) {
        this.addSpacer(queuedSpacer.text);
      }
    }
    this.chunks.push(text);
    this._length += text.length;

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
      this._positions.push({ line: this._line, column: this._column, segments: this._segments.length, length: this._length });
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
    this._positions.push({ line: this._line, column: this._column, segments: this._segments.length, length: this._length });
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

  queueSpacer(text: string, shouldAdd: (nextText: string) => boolean = nextText => !/^[ \t\r\n\f]/u.test(nextText)): void {
    if (!text) {
      return;
    }
    this._queuedSpacer = { text, shouldAdd };
  }

  mark(): number {
    return this.chunks.length;
  }

  getSince(mark: number): string {
    if (mark < 0 || mark > this.chunks.length) {
      return '';
    }
    return this.chunks.slice(mark).join('');
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
    const segmentMark = mark > 0 ? (this._positions[mark - 1]?.segments ?? 0) : 0;
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
    this.refreshPositions();
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
    this.refreshPositions();
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
    this.refreshPositions();
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
    this.refreshPositions();
  }

  /** Restore writer state to a given mark, discarding appended chunks and segments */
  restore(mark: number): void {
    if (mark < 0 || mark > this.chunks.length) {
      return;
    }
    this.chunks.length = mark;
    const pos = this._positions[mark - 1];
    if (pos) {
      this._line = pos.line;
      this._column = pos.column;
      this._segments.length = pos.segments;
      this._length = pos.length;
    } else {
      this._line = 0;
      this._column = 0;
      this._segments.length = 0;
      this._length = 0;
    }
    this._positions.length = mark;
    this._queuedSpacer = null;
  }

  private refreshPositions(): void {
    const segmentCounts = this._positions.map(pos => pos.segments);
    this._positions = [];
    this._length = 0;
    this._line = 0;
    this._column = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const text = this.chunks[i]!;
      this._length += text.length;
      const newline = text.lastIndexOf('\n');
      if (newline === -1) {
        this._column += text.length;
      } else {
        this._line += text.split('\n').length - 1;
        this._column = text.length - (newline + 1);
      }
      this._positions.push({
        line: this._line,
        column: this._column,
        segments: segmentCounts[i] ?? this._segments.length,
        length: this._length
      });
    }
    const last = this._positions.at(-1);
    this._segments.length = last?.segments ?? 0;
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
