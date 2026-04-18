import type { Context } from '../../context.js';
import type { IToken } from 'chevrotain';
import type { TriviaMap } from '../../types/index.js';
import type { AtRule } from '../at-rule.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';

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
  /** Whether the current ampersand is at the start of its containing selector. */
  ampersandFirst?: boolean;
  trivia?: TriviaMap;
  emittedTrivia?: Set<IToken[]>;
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
  | 'writer';

type RestorablePrintState = Pick<FinalPrintOptions, RestorablePrintStateKey>;

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
  addSpacer(text: string): void;
  mark(): number;
  getSince(mark: number): string;
  captureWithMeta(fn: () => void): CapturedOutput;
  signalBoundaryIntent(side: 'pre' | 'post', intent: BoundaryIntent): void;
  toString(): string;
  toSourceMapV3(): any;
  getSegments(): SourceSegment[];
}

export type BoundaryIntent = 'implicit' | 'explicit_none' | 'explicit_space';

export type BoundaryIntentOptions = {
  preIntent?: BoundaryIntent;
  postIntent?: BoundaryIntent;
};

export type CapturedOutput = {
  text: string;
  leadingIntent: BoundaryIntent;
  trailingIntent: BoundaryIntent;
};

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

export function getPrintOptions(options?: PrintOptions): FinalPrintOptions {
  if (options?.context) {
    if (options !== options.context.printState) {
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
  state.trivia = seed?.trivia;
  state.emittedTrivia = new Set();

  if (state.collapseNesting === undefined && context.opts.collapseNesting !== undefined) {
    state.collapseNesting = Boolean(context.opts.collapseNesting);
  }

  ensureFinalPrintOptions(state);
  return state;
}

export type SavedPrintState = Array<[RestorablePrintStateKey, RestorablePrintState[RestorablePrintStateKey]]>;

export function savePrintState(
  options: FinalPrintOptions,
  keys: readonly RestorablePrintStateKey[]
): SavedPrintState {
  const saved: SavedPrintState = [];
  for (const key of keys) {
    saved.push([key, options[key]]);
  }
  return saved;
}

export function restorePrintState(
  options: FinalPrintOptions,
  saved: SavedPrintState
): void {
  for (let i = 0; i < saved.length; i++) {
    const [key, value] = saved[i]!;
    options[key] = value;
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
  private _boundarySignals: Array<{ side: 'pre' | 'post'; intent: BoundaryIntent; offset: number }> = [];
  private _signalPositions: number[] = [];
  /** Diagnostic: remember the origin that last wrote a trailing newline */
  private _lastNewlineOrigin: unknown = undefined;
  /** Store segments from the most recent capture for merging when content is added back */
  private _capturedSegments: SourceSegment[] | null = null;

  get line() {
    return this._line;
  }

  get column() {
    return this._column;
  }

  add(text: string, originParam?: unknown): void {
    if (!text) {
      return;
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
    const origin = isSourceMapOrigin(originParam) ? originParam : undefined;
    const loc = origin?.location;
    if (loc && Array.isArray(loc) && loc.length === 6) {
      const startLine = (loc[1] ?? 1) - 1;     // convert to 0-based
      const startColumn = (loc[2] ?? 1) - 1;   // convert to 0-based
      const file = origin?.treeContext?.file?.fullPath || origin?.treeContext?.file?.path || origin?.treeContext?.file?.name;
      this._segments.push({
        genLine: this._line,
        genColumn: this._column,
        source: file,
        origLine: startLine,
        origColumn: startColumn
      });
    }

    // Track if the chunk ends with a newline and record its origin (for diagnostics)
    if (text.endsWith('\n')) {
      this._lastNewlineOrigin = originParam;
    }

    // Fast path: no newlines
    let i = text.indexOf('\n');
    if (i === -1) {
      this._column += text.length;
      this._positions.push({ line: this._line, column: this._column, segments: this._segments.length, length: this._length });
      this._signalPositions.push(this._boundarySignals.length);
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
    this._signalPositions.push(this._boundarySignals.length);
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

  mark(): number {
    return this.chunks.length;
  }

  getSince(mark: number): string {
    if (mark < 0 || mark > this.chunks.length) {
      return '';
    }
    return this.chunks.slice(mark).join('');
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
    const signalCount = this._signalPositions[mark - 1] ?? 0;
    this._boundarySignals.length = signalCount;
    this._signalPositions.length = mark;
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

  captureWithMeta(fn: () => void): CapturedOutput {
    const m = this.mark();
    const segmentsBefore = this._segments.length;
    const startLen = this._length;
    const signalStart = this._boundarySignals.length;
    fn();
    const text = this.getSince(m);
    const endLen = this._length;
    const capturedSignals = this._boundarySignals.slice(signalStart);
    const segmentsCreated = this._segments.slice(segmentsBefore);
    this.restore(m);
    this._capturedSegments = segmentsCreated.length > 0 ? segmentsCreated : null;

    let leadingIntent: BoundaryIntent = 'implicit';
    let trailingIntent: BoundaryIntent = 'implicit';
    for (const signal of capturedSignals) {
      if (signal.side === 'pre' && signal.offset === startLen) {
        leadingIntent = signal.intent;
        break;
      }
    }
    for (let i = capturedSignals.length - 1; i >= 0; i--) {
      const signal = capturedSignals[i]!;
      if (signal.side === 'post' && signal.offset === endLen) {
        trailingIntent = signal.intent;
        break;
      }
    }
    return { text, leadingIntent, trailingIntent };
  }

  signalBoundaryIntent(side: 'pre' | 'post', intent: BoundaryIntent): void {
    this._boundarySignals.push({ side, intent, offset: this._length });
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
