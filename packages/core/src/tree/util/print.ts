import type { Context } from '../../context.js';
import type { AtRule } from '../at-rule.js';
import type { Ruleset } from '../ruleset.js';

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
};

export type FinalPrintOptions = PrintOptions & {
  writer: OutputWriter;
  depth: number;
  inFrames: (Ruleset | AtRule)[];
  treeFrames: (Ruleset | AtRule)[];
  frameHeaders: string[];
  lastRenderedFrames: (Ruleset | AtRule)[];
};

export interface OutputWriter {
  add(text: string, origin?: unknown): void;
  mark(): number;
  getSince(mark: number): string;
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

export function getPrintOptions(options?: PrintOptions): FinalPrintOptions {
  options = options ?? {};
  options.depth ??= 0;
  options.writer ??= new OutputWriter();
  // Derive collapseNesting from context when missing so nested vs flat is correct for & serialization
  if (options.collapseNesting === undefined && options.context?.opts?.collapseNesting !== undefined) {
    options.collapseNesting = Boolean(options.context.opts.collapseNesting);
  }
  // Always ensure frameState exists - nodes should not need to check for it
  options.inFrames ??= [];
  options.frameHeaders ??= [];
  options.treeFrames ??= [];
  options.lastRenderedFrames ??= [];
  return options as FinalPrintOptions;
}

export class OutputWriter implements OutputWriter {
  private chunks: string[] = [];
  private _line = 0;
  private _column = 0;
  private _segments: SourceSegment[] = [];
  private _positions: Array<{ line: number; column: number; segments: number }> = [];
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
    const origin: any = originParam as any;
    const loc: any = origin && origin.location;
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
      this._positions.push({ line: this._line, column: this._column, segments: this._segments.length });
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
    this._positions.push({ line: this._line, column: this._column, segments: this._segments.length });
    // Clear captured segments if we added content without origin
    if (!originParam) {
      this._capturedSegments = null;
    }
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
    } else {
      this._line = 0;
      this._column = 0;
      this._segments.length = 0;
    }
    this._positions.length = mark;
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
