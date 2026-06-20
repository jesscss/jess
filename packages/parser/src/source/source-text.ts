import { LineMap, type LineColumn } from './line-map.js';

/**
 * Metadata carried with immutable source text for caching and diagnostics.
 *
 * `version` participates in island cache keys, so callers should change it
 * whenever the backing text changes even if the same file path is reused.
 */
export type SourceTextOptions = {
  filePath?: string;
  version?: string | number;
};

/**
 * Cold source-size report used by parser performance guards.
 *
 * `lineMapEntries` is reported only after a consumer has already requested the
 * lazy line map, so collecting stats does not force human-facing location data.
 */
export type SourceTextStats = {
  readonly sourceBytes: number;
  readonly sourceLength: number;
  readonly lineMapMaterialized: boolean;
  readonly lineMapEntries?: number;
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

  /**
   * Lazily builds the line map on first human-facing position lookup.
   *
   * Structural parsing, island planning, and semantic indexing should prefer
   * raw offsets so they can avoid this allocation on hot paths.
   */
  get lineMap(): LineMap {
    return this.#lineMap ??= new LineMap(this.text);
  }

  /** Returns whether any consumer has forced line-map materialization. */
  get hasLineMap(): boolean {
    return this.#lineMap !== undefined;
  }

  /** Reports source size and lazy line-map state without forcing allocation. */
  stats(): SourceTextStats {
    return {
      sourceBytes: new TextEncoder().encode(this.text).byteLength,
      sourceLength: this.text.length,
      lineMapMaterialized: this.#lineMap !== undefined,
      lineMapEntries: this.#lineMap?.lineStarts.length
    };
  }

  /** Returns a checked source slice using half-open UTF-16 offsets. */
  slice(start: number, end: number = this.text.length): string {
    this.assertRange(start, end);
    return this.text.slice(start, end);
  }

  /** Converts an offset to a 1-based human/editor position. */
  offsetToLineColumn(offset: number): LineColumn {
    return this.lineMap.offsetToLineColumn(offset);
  }

  /** Converts a 1-based human/editor position back to a UTF-16 offset. */
  lineColumnToOffset(line: number, column: number): number {
    return this.lineMap.lineColumnToOffset(line, column);
  }

  /** Throws when a half-open range is outside this source. */
  assertRange(start: number, end: number): void {
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end < start
      || end > this.text.length
    ) {
      throw new RangeError(`Invalid source range ${start}..${end}.`);
    }
  }
}
