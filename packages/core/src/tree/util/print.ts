export type PrintOptions = {
  depth?: number;
  writer?: OutputWriter;
  defaultPre?: string;
  defaultPost?: string;
  compress?: boolean;
  /**
   * Hint for containers like Rules: do not prepend a leading newline/indent
   * before the first emitted child. The parent is responsible for line breaks.
   */
  suppressLeadingNewline?: boolean;
  /**
   * Suppress pure-whitespace string tokens in `pre` when emitting children,
   * preserving comment nodes and non-whitespace tokens.
   */
  stripPreWhitespace?: boolean;
  /**
   * Signal that the next emitted node should insert a single space
   * if it does not naturally begin with whitespace.
   */
  pendingSpaceBeforeNext?: boolean;
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

export function getPrintOptions(options?: PrintOptions): PrintOptions {
  options = options ?? {
    writer: new OutputWriter()
  };
  options.writer ??= new OutputWriter();
  return options;
}

export class OutputWriter implements OutputWriter {
  private chunks: string[] = [];
  private _line = 0;
  private _column = 0;
  private _segments: SourceSegment[] = [];

  get line() { return this._line; }
  get column() { return this._column; }

  add(text: string, _origin?: unknown): void {
    if (!text) return;
    this.chunks.push(text);

    // Record a mapping segment if we have origin location info
    const origin: any = _origin as any;
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

    // Fast path: no newlines
    let i = text.indexOf('\n');
    if (i === -1) {
      this._column += text.length;
      return;
    }

    // Count newlines and compute trailing column after last newline
    this._line++;
    for (;;) {
      const next = text.indexOf('\n', i + 1);
      if (next === -1) break;
      this._line++;
      i = next;
    }
    this._column = text.length - (i + 1);
  }

  mark(): number {
    return this.chunks.length;
  }

  getSince(mark: number): string {
    if (mark < 0 || mark > this.chunks.length) return '';
    return this.chunks.slice(mark).join('');
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
}
