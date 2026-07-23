/** Structured failure from the public direct Less parser. */
export class LessParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];

  constructor(offset: number, expected: readonly string[]) {
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(`Less parser error.${detail}`);
    this.name = 'LessParseError';
    this.offset = offset;
    this.expected = expected;
  }
}

/** Less 5 deliberately rejects interpolation inside the CSS @charset token. */
export class LessDynamicCharsetError extends SyntaxError {
  readonly code = 'parse/dynamic-charset' as const;
  readonly offset: number;
  readonly endOffset: number;

  constructor(offset: number, endOffset: number) {
    super('Less 5 does not support interpolation in @charset.');
    this.name = 'LessDynamicCharsetError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}
