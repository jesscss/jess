/**
 * The public SCSS parse failure lives in its own module so that both AST
 * entries — `.` and `./positions` — can export it without either one reaching
 * the other's compiled grammar table. A class declared in an entry cannot be
 * re-exported by a sibling entry without dragging that entry's imports along.
 */

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
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    super(options.message ?? `SCSS parser error.${detail}`);
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
