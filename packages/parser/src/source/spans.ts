/**
 * Half-open source range in UTF-16 offsets.
 *
 * Parser data stores offsets as numbers first; this object shape is the
 * API view used when callers need to pass or persist a range.
 */
export type SourceSpan = {
  start: number;
  end: number;
};

/**
 * Packed span table for direct AST fields.
 *
 * Entries are keyed by the owning node's static `childKeys` order. Each field
 * consumes three numbers: start offset, end offset, and field flags. Missing
 * fields use `-1, -1, 0`.
 */
export type PackedFieldSpans = number[];

/**
 * Packed span table for array-backed field segments.
 *
 * This deliberately does not share the direct-field `fieldSpans` slot. For example,
 * `Declaration.fieldSpans` can describe the whole `value` field while
 * `Declaration.valueSpans` describes each item inside `value` when `value` is
 * an array.
 */
export type PackedSegmentSpans = number[];

/**
 * Span for a delimited construct, keeping the outer token range separate from
 * its content so deferred field parsers can choose whether to include syntax
 * wrappers.
 */
export type DelimitedSpan = {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
};

/**
 * Trivia categories preserved outside the AST node tree.
 *
 * Trivia remains source-owned so formatting and exact-source consumers can opt
 * in without making every AST node carry whitespace/comment fields.
 */
export type TriviaKind =
  | 'whitespace'
  | 'line-comment'
  | 'block-comment'
  | 'newline';

/**
 * One contiguous trivia run owned by the source, not by an AST node.
 *
 * `start`/`end` are half-open offsets into the original source.
 */
export type TriviaRun = {
  start: number;
  end: number;
  kind: TriviaKind;
};

/** Convenience constructor for half-open source spans. */
export function sourceSpan(start: number, end: number): SourceSpan {
  return { start, end };
}

/** Allocates a packed direct-field span table for `fieldCount` fields. */
export function createPackedFieldSpans(fieldCount: number): PackedFieldSpans {
  const spans = new Array<number>(fieldCount * 3);
  for (let i = 0; i < spans.length; i += 3) {
    spans[i] = -1;
    spans[i + 1] = -1;
    spans[i + 2] = 0;
  }
  return spans;
}

/** Writes one direct-field span into a packed table. */
export function setPackedFieldSpan(
  spans: PackedFieldSpans,
  fieldIndex: number,
  start: number,
  end: number,
  flags = 0
): void {
  const offset = fieldIndex * 3;
  spans[offset] = start;
  spans[offset + 1] = end;
  spans[offset + 2] = flags;
}

/** Allocates a packed segment span table for an array-backed field. */
export function createPackedSegmentSpans(segmentCount: number): PackedSegmentSpans {
  return createPackedFieldSpans(segmentCount);
}

/** Writes one array-backed field segment span into a packed segment table. */
export function setPackedSegmentSpan(
  spans: PackedSegmentSpans,
  segmentIndex: number,
  start: number,
  end: number,
  flags = 0
): void {
  setPackedFieldSpan(spans, segmentIndex, start, end, flags);
}

/** Convenience constructor for spans that distinguish delimiters from content. */
export function delimitedSpan(
  start: number,
  end: number,
  contentStart: number,
  contentEnd: number,
  openStart: number,
  openEnd: number,
  closeStart: number,
  closeEnd: number
): DelimitedSpan {
  return {
    start,
    end,
    contentStart,
    contentEnd,
    openStart,
    openEnd,
    closeStart,
    closeEnd
  };
}
