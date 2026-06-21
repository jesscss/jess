export interface SourcePosition {
  /** 1-based line number. */
  line: number;
  /** 1-based UTF-16 column number. */
  column: number;
}

export interface ParserDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  start: number;
  end: number;
}

export interface ScannerParseResult<T> {
  tree: T;
  source: SourceText;
  diagnostics: readonly ParserDiagnostic[];
}

export class LineMap {
  readonly #lineStarts: number[];

  constructor(private readonly source: string) {
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      if (code === 13) {
        if (source.charCodeAt(i + 1) === 10) {
          i++;
        }
        lineStarts.push(i + 1);
      } else if (code === 10) {
        lineStarts.push(i + 1);
      }
    }
    this.#lineStarts = lineStarts;
  }

  offsetToPosition(offset: number): SourcePosition {
    const bounded = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.#lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const start = this.#lineStarts[mid]!;
      if (start <= bounded) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIndex = Math.max(0, high);
    return {
      line: lineIndex + 1,
      column: bounded - this.#lineStarts[lineIndex]! + 1
    };
  }

  positionToOffset(position: SourcePosition): number {
    const lineIndex = Math.max(0, Math.min(position.line - 1, this.#lineStarts.length - 1));
    const lineStart = this.#lineStarts[lineIndex]!;
    const nextLineStart = this.#lineStarts[lineIndex + 1] ?? this.source.length + 1;
    return Math.max(lineStart, Math.min(lineStart + position.column - 1, nextLineStart - 1));
  }
}

export class SourceText {
  private _lineMap: LineMap | undefined;

  constructor(
    readonly text: string,
    readonly filePath = '<inline>',
    readonly version: string | number = 0
  ) {}

  get length(): number {
    return this.text.length;
  }

  get lineMap(): LineMap {
    return (this._lineMap ??= new LineMap(this.text));
  }

  offsetToPosition(offset: number): SourcePosition {
    return this.lineMap.offsetToPosition(offset);
  }

  positionToOffset(position: SourcePosition): number {
    return this.lineMap.positionToOffset(position);
  }
}
