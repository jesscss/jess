import { LineMap, type LineColumn } from './line-map.js';

/** Metadata carried with immutable source text for caching and diagnostics. */
export type SourceTextOptions = {
  filePath?: string;
  version?: string | number;
};

/**
 * Immutable source wrapper shared by scanner, structural parser, and services.
 *
 * Expensive line mapping is allocated lazily so structural-only callers can
 * inspect spans and slices without paying diagnostic-rendering costs.
 */
export class SourceText {
  readonly text: string;
  readonly filePath?: string;
  readonly version: string | number;

  #lineMap: LineMap | undefined;

  constructor(text: string, options: SourceTextOptions = {}) {
    this.text = text;
    this.filePath = options.filePath;
    this.version = options.version ?? 0;
  }

  get length(): number {
    return this.text.length;
  }

  get lineMap(): LineMap {
    return this.#lineMap ??= new LineMap(this.text);
  }

  get hasLineMap(): boolean {
    return this.#lineMap !== undefined;
  }

  slice(start: number, end: number = this.text.length): string {
    this.assertRange(start, end);
    return this.text.slice(start, end);
  }

  offsetToLineColumn(offset: number): LineColumn {
    return this.lineMap.offsetToLineColumn(offset);
  }

  lineColumnToOffset(line: number, column: number): number {
    return this.lineMap.lineColumnToOffset(line, column);
  }

  assertRange(start: number, end: number): void {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.text.length
    ) {
      throw new RangeError(`Invalid source range ${start}..${end}.`);
    }
  }
}
