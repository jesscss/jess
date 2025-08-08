export type PrintOptions = {
  depth?: number;
  writer?: OutputWriter;
  defaultPre?: string;
  defaultPost?: string;
  compress?: boolean;
};

export interface OutputWriter {
  add(text: string, origin?: unknown): void;
  mark(): number;
  getSince(mark: number): string;
  toString(): string;
  toSourceMapV3(): any;
}

export function getPrintOptions(options?: PrintOptions): PrintOptions {
  options = options ?? {
    writer: new OutputWriterImpl()
  };
  options.writer ??= new OutputWriterImpl();
  return options;
}

export class OutputWriterImpl implements OutputWriter {
  private chunks: string[] = [];
  private _line = 0;
  private _column = 0;

  get line() { return this._line; }
  get column() { return this._column; }

  add(text: string, _origin?: unknown): void {
    if (!text) return;
    this.chunks.push(text);

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
}
