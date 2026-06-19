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

  eof(offset: number = this.offset): boolean {
    return offset >= this.length;
  }

  peekCode(ahead = 0): number {
    const offset = this.offset + ahead;
    return offset < this.length ? this.text.charCodeAt(offset) : -1;
  }

  codeAt(offset: number): number {
    return offset < this.length ? this.text.charCodeAt(offset) : -1;
  }

  advance(count = 1): number {
    const nextOffset = this.offset + count;
    if (!Number.isInteger(count) || count < 0 || nextOffset > this.length) {
      throw new RangeError(`Cannot advance scanner by ${count}.`);
    }
    this.offset = nextOffset;
    return this.offset;
  }

  moveTo(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw new RangeError(`Offset ${offset} is outside the source range.`);
    }
    this.offset = offset;
  }

  match(text: string): boolean {
    return this.source.text.startsWith(text, this.offset);
  }

  consume(text: string): boolean {
    if (!this.match(text)) {
      return false;
    }
    this.offset += text.length;
    return true;
  }

  slice(start: number, end: number = this.offset): string {
    return this.source.slice(start, end);
  }
}
