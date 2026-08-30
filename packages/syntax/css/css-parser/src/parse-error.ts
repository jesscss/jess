/**
 * The public CSS parse failure lives in its own module so that both AST
 * entries — `.` and `./positions` — can export it without either one reaching
 * the other's compiled grammar table. A class declared in an entry cannot be
 * re-exported by a sibling entry without dragging that entry's imports along.
 */

function expectedIncludes(expected: ReadonlySet<string>, value: string): boolean {
  return expected.has(value);
}

/**
 * A clean, human message for a CSS parse failure, chosen from the SHAPE of the
 * expected set — never by printing the set. Parseman surfaces expected atoms as
 * regex literals and lexer token-class names; joining them into the message
 * leaks parser internals to the author and makes the text a function of the
 * compiled table. Mirrors the Less parser's `expectedMessage`; CSS surfaces its
 * value atoms as raw regexes rather than Less's token-class names, so the value
 * position is recognized by the custom-property-name fallback and the function
 * `(` that only a value slot admits together.
 */
function expectedMessage(expected: readonly string[]): string {
  if (expected.length === 0) {
    return 'Unexpected CSS syntax.';
  }
  const expectedSet = new Set(expected);
  if (expectedIncludes(expectedSet, '")"')) {
    return 'Missing closing parenthesis.';
  }
  if (expectedSet.size === 1) {
    if (expectedIncludes(expectedSet, '"]"')) {
      return 'Missing closing bracket.';
    }
    if (expectedIncludes(expectedSet, '"}"')) {
      return 'Missing closing brace.';
    }
  }
  const looksLikeValueProduction =
    expectedIncludes(expectedSet, 'CustomPropertyName')
    && expectedIncludes(expectedSet, '"("');
  if (looksLikeValueProduction) {
    return 'Unexpected CSS syntax. Expected a CSS value.';
  }
  if (expectedIncludes(expectedSet, '";"')) {
    return 'Missing semicolon.';
  }
  return 'Unexpected CSS syntax. Expected valid CSS syntax here.';
}

/** Structured failure from the public direct CSS parser. */
export class CssParseError extends SyntaxError {
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
    this.name = 'CssParseError';
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
