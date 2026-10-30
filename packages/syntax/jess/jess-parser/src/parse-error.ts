/**
 * The public Jess parse failure lives in its own module so that both AST
 * entries — `.` and `./positions` — can export it without either one reaching
 * the other's compiled grammar table. A class declared in an entry cannot be
 * re-exported by a sibling entry without dragging that entry's imports along.
 */

import type { LeadingSeparatorValueError } from '@jesscss/core/diagnostics';

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

  /** The value the parse kept for it; a report whose value is not in the accepted tree is dropped. */
  readonly recoveredValue: object;

  constructor(offset: number, endOffset: number, recoveredValue: object) {
    super('selector() takes a selector list.');
    this.name = 'JessSelectorCaptureArgumentError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.recoveredValue = recoveredValue;
  }
}

/**
 * A `*` between two numbers or variables in a statement value, outside
 * `$( … )`: `.jess` computes only inside `$( … )` (ledger P17), so it is an
 * error at the `*`, and the parse carries on (P45).
 */
export class JessArithmeticOutsideExpressionError extends SyntaxError {
  readonly code = 'parse/arithmetic-outside-expression' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'A .jess value computes only inside $( … ), so outside it this `*` would be written as it is, not multiplied.';
  readonly fix = 'Write the operation inside $( … ), for example $(2 * 3).';

  /** The value the parse kept for it; a report whose value is not in the accepted tree is dropped. */
  readonly recoveredValue: object;

  constructor(offset: number, endOffset: number, recoveredValue: object) {
    super('`*` multiplies only inside $( … ).');
    this.name = 'JessArithmeticOutsideExpressionError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.recoveredValue = recoveredValue;
  }
}

/**
 * A map written `{ key: value; }`: a `.jess` map is `#{ … }` (ledger P31) and a
 * bare `{ … }` is the curly list (P51), so it is an error at the block, and the
 * parse carries on with the map (P45).
 */
export class JessBareBraceMapError extends SyntaxError {
  readonly code = 'parse/bare-brace-map' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'In .jess a map is written #{ … }; a bare { … } is a list passed as one value.';
  readonly fix = 'Write the map as #{ key: value; }.';

  /** The value the parse kept for it; a report whose value is not in the accepted tree is dropped. */
  readonly recoveredValue: object;

  constructor(offset: number, endOffset: number, recoveredValue: object) {
    super('A map is written #{ … }.');
    this.name = 'JessBareBraceMapError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.recoveredValue = recoveredValue;
  }
}

/** A problem the grammar recovered from: a located error diagnostic the parse carries on past (ledger P45). */
export type JessRecoveredError = JessSelectorCaptureArgumentError | LeadingSeparatorValueError | JessArithmeticOutsideExpressionError | JessBareBraceMapError;
