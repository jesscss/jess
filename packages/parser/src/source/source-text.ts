import { LineMap, type SourcePosition } from './line-map.js';

/**
 * Immutable source version used for cache and invalidation keys.
 *
 * Callers should change this whenever the backing text changes even if the
 * same file path is reused.
 */
export type SourceTextVersion = string | number;

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
 * Immutable source wrapper shared by scanner, parsers, and diagnostics.
 *
 * Expensive line mapping is allocated lazily so parser-only callers can
 * inspect spans and slices without paying diagnostic-rendering costs.
 */
export class SourceText {
  readonly text: string;
  readonly filePath?: string;
  readonly version: SourceTextVersion;

  #lineMap: LineMap | undefined;

  constructor(text: string, filePath?: string, version: SourceTextVersion = 0) {
    this.text = text;
    this.filePath = filePath;
    this.version = version;
  }

  get length(): number {
    return this.text.length;
  }

  /**
   * Lazily builds the line map on first human-facing position lookup.
   *
   * Parser, scanner, and AST hydration paths should prefer raw offsets so they
   * can avoid this allocation on hot paths.
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
  offsetToPosition(offset: number): SourcePosition {
    return this.lineMap.offsetToPosition(offset);
  }

  /** Converts a 1-based human/editor position back to a UTF-16 offset. */
  positionToOffset(line: number, column: number): number {
    return this.lineMap.positionToOffset(line, column);
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
