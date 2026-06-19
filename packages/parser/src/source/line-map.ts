/** 1-based source location used by rendered diagnostics and editor services. */
export type LineColumn = {
  line: number;
  column: number;
};

/**
 * Maps UTF-16 source offsets to 1-based line/column positions.
 *
 * The map is built once per source text and then shared by diagnostics and
 * editor-facing services; callers keep ownership of the original string.
 */
export class LineMap {
  readonly lineStarts: readonly number[];

  constructor(readonly text: string) {
    this.lineStarts = computeLineStarts(text);
  }

  offsetToLineColumn(offset: number): LineColumn {
    assertOffset(offset, this.text.length);

    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const lineStart = this.lineStarts[mid]!;

      if (lineStart <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const lineIndex = high;
    return {
      line: lineIndex + 1,
      column: offset - this.lineStarts[lineIndex]! + 1
    };
  }

  lineColumnToOffset(line: number, column: number): number {
    if (!Number.isInteger(line) || line < 1 || line > this.lineStarts.length) {
      throw new RangeError(`Line ${line} is outside the source range.`);
    }
    if (!Number.isInteger(column) || column < 1) {
      throw new RangeError(`Column ${column} is outside the source range.`);
    }

    const lineStart = this.lineStarts[line - 1]!;
    const nextLineStart = this.lineStarts[line] ?? this.text.length + 1;
    const offset = lineStart + column - 1;

    if (offset >= nextLineStart) {
      throw new RangeError(`Column ${column} is outside line ${line}.`);
    }

    return offset;
  }
}

/**
 * Computes line starts without normalizing the source text.
 *
 * CRLF is treated as one newline and form-feed is a newline to match CSS token
 * trivia handling.
 */
function computeLineStarts(text: string): number[] {
  const starts = [0];

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (code === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        i++;
      }
      starts.push(i + 1);
      continue;
    }

    if (code === 10 || code === 12) {
      starts.push(i + 1);
    }
  }

  return starts;
}

function assertOffset(offset: number, max: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > max) {
    throw new RangeError(`Offset ${offset} is outside the source range.`);
  }
}
