/**
 * The public SCSS parse failure lives in its own module so that both AST
 * entries — `.` and `./positions` — can export it without either one reaching
 * the other's compiled grammar table. A class declared in an entry cannot be
 * re-exported by a sibling entry without dragging that entry's imports along.
 */

/*
 * The one at-rule-specific message this module gives. The `@charset` prelude is
 * a `<string>` and nothing else (css-syntax-3 §3.2), so a refusal there has a
 * real answer to give and must not read as `Expected: <atom>`. The atom is
 * emitted by the css grammar's `CHARSET_PRELUDE_EXPECTED` and spelled here
 * rather than imported: this module deliberately holds no grammar import.
 */
function expectedMessage(expected: readonly string[]): string {
  if (expected.includes('@charset quoted string')) {
    return 'An @charset prelude must be a quoted string, as in @charset "utf-8";.';
  }
  const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
  return `SCSS parser error.${detail}`;
}

/** Structured failure from the public direct SCSS parser. */
export class ScssParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly reason?: string;
  readonly fix?: string;

  constructor(
    offset: number,
    expected: readonly string[],
    options: {
      message?: string;
      reason?: string;
      fix?: string;
      line?: number;
      column?: number;
      endLine?: number;
      endColumn?: number;
    } = {}
  ) {
    super(options.message ?? expectedMessage(expected));
    this.name = 'ScssParseError';
    this.offset = offset;
    this.expected = expected;
    this.line = options.line;
    this.column = options.column;
    this.endLine = options.endLine;
    this.endColumn = options.endColumn;
    this.reason = options.reason;
    this.fix = options.fix;
  }
}

/**
 * A media/layer/supports postlude belongs to the plain CSS `@import` form only.
 *
 * Once the parser has decided an `@import` is compile-time — a Sass partial
 * rather than a `.css` file or a URL — a trailing query has nothing left to
 * describe: the partial's rules are spliced into this document, not linked as a
 * separate CSS resource.
 */
export class ScssImportPostludeError extends SyntaxError {
  readonly code = 'parse/import-postlude-on-compile-time-import' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason =
    'A media, layer, or supports query is only valid on a plain CSS @import.';

  readonly fix =
    'Drop the query, or wrap the import in an explicit @media/@supports/@layer block.';

  constructor(offset: number, endOffset: number) {
    super('A compile-time @import cannot carry a media query.');
    this.name = 'ScssImportPostludeError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}
