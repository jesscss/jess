/**
 * The public Jess parse failure lives in its own module so that both AST
 * entries — `.` and `./positions` — can export it without either one reaching
 * the other's compiled grammar table. A class declared in an entry cannot be
 * re-exported by a sibling entry without dragging that entry's imports along.
 */

/** Structured failure from the public direct Jess parser. */
export class JessParseError extends SyntaxError {
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
    super(options.message ?? `Jess parser error.${detail}`);
    this.name = 'JessParseError';
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
 * A value-position `selector(…)` whose argument is not a selector list
 * (`selector()`, `selector(1px)`, `selector($x)`): it captures a selector list,
 * the argument `:is()` takes (owner 2026-10-16, ledger P49). Located at the
 * argument; the parse reads the rest of it as opaque text and carries on (P45).
 */
export class JessSelectorCaptureArgumentError extends SyntaxError {
  readonly code = 'parse/selector-capture-argument' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'In a value, selector() captures a selector list, the argument :is() takes, and this argument is not one.';
  readonly fix = 'Write a selector list, for example selector(.a, .b > .c).';

  constructor(offset: number, endOffset: number) {
    super('selector() takes a selector list.');
    this.name = 'JessSelectorCaptureArgumentError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/**
 * The removed `*[…]` selector capture (owner 2026-10-16, ledger P49: replaced
 * by `selector(…)`, no alias). Located at the whole `*[…]`; the parse carries
 * on (P45).
 */
export class JessRemovedSelectorCaptureError extends SyntaxError {
  readonly code = 'parse/removed-selector-capture' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'The `*[…]` selector capture is removed; a selector capture is written selector(<selector-list>).';
  readonly fix: string;

  constructor(offset: number, endOffset: number, list: string) {
    super('Selector capture is now written selector(…).');
    this.name = 'JessRemovedSelectorCaptureError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.fix = `Write selector(${list}).`;
  }
}

/** A problem the grammar recovered from: a located error diagnostic the parse carries on past (ledger P45). */
export type JessRecoveredError = JessSelectorCaptureArgumentError | JessRemovedSelectorCaptureError;
