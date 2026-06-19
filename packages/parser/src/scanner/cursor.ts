import { SourceText } from '../source/source-text.js';

/**
 * Mutable cursor over a `SourceText` instance.
 *
 * Scanners own cursor advancement, but not the source; this keeps recovery
 * routines cheap because they can skip ahead without allocating token objects.
 */
export class ScannerCursor {
  readonly source: SourceText;

  offset = 0;

  constructor(source: SourceText | string) {
    this.source = typeof source === 'string' ? new SourceText(source) : source;
  }

  get text(): string {
    return this.source.text;
  }

  get length(): number {
    return this.source.length;
  }

  /** Returns true when the supplied offset, or current offset, is at EOF. */
  eof(offset: number = this.offset): boolean {
    return offset >= this.length;
  }

  /** Peeks a UTF-16 code unit relative to the current offset, or `-1` at EOF. */
  peekCode(ahead = 0): number {
    const offset = this.offset + ahead;
    return offset < this.length ? this.text.charCodeAt(offset) : -1;
  }

  /** Reads a UTF-16 code unit at an absolute offset, or `-1` at EOF. */
  codeAt(offset: number): number {
    return offset < this.length ? this.text.charCodeAt(offset) : -1;
  }

  /** Advances by `count` code units and returns the new offset. */
  advance(count = 1): number {
    const nextOffset = this.offset + count;
    if (!Number.isInteger(count) || count < 0 || nextOffset > this.length) {
      throw new RangeError(`Cannot advance scanner by ${count}.`);
    }
    this.offset = nextOffset;
    return this.offset;
  }

  /** Moves to an absolute source offset after range validation. */
  moveTo(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw new RangeError(`Offset ${offset} is outside the source range.`);
    }
    this.offset = offset;
  }

  /** Tests whether the source at the current offset starts with `text`. */
  match(text: string): boolean {
    return this.source.text.startsWith(text, this.offset);
  }

  /** Consumes `text` only when it matches exactly at the current offset. */
  consume(text: string): boolean {
    if (!this.match(text)) {
      return false;
    }
    this.offset += text.length;
    return true;
  }

  /** Returns a checked slice from `start` through `end` or current offset. */
  slice(start: number, end: number = this.offset): string {
    return this.source.slice(start, end);
  }
}
