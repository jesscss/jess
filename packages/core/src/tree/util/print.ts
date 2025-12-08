import type { Context } from '../../context';
import type { AtRule } from '../at-rule';
import type { Ruleset } from '../ruleset';

export type PrintOptions = {
  /** Tracks what ruleset or at-rule body we're in, at what depth */
  frameState?: {
    frame?: Ruleset | AtRule;
    depth: number;
  }[];
  writer?: OutputWriter;
  compress?: boolean;
  collapseNesting?: boolean;
  context?: Context;
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

export function getPrintOptions(options?: PrintOptions): PrintOptions & { writer: OutputWriter } {
  options = options ?? {};
  options.writer ??= new OutputWriter();
  return options as PrintOptions & { writer: OutputWriter };
}

export class OutputWriter implements OutputWriter {
  private chunks: string[] = [];
  private _line = 0;
  private _column = 0;
  private _segments: SourceSegment[] = [];
  private _positions: Array<{ line: number; column: number; segments: number }> = [];
  /** Diagnostic: remember the origin that last wrote a trailing newline */
  private _lastNewlineOrigin: unknown = undefined;

  get line() { return this._line; }
  get column() { return this._column; }

  add(text: string, originParam?: unknown): void {
    if (!text) {
      return;
    }
    this.chunks.push(text);

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
    const segmentsCreated = this._segments.slice(segmentsBefore);
    this.restore(m);
    // Re-add segments that were created during capture
    this._segments.push(...segmentsCreated);
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
