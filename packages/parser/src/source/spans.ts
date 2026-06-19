/** Half-open source range in UTF-16 offsets. */
export type SourceSpan = {
  start: number;
  end: number;
};

/**
 * Span for a delimited construct, keeping the outer token range separate from
 * its content so island parsers can choose whether to include syntax wrappers.
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

/** Trivia categories preserved outside the structural node tree. */
export type TriviaKind =
  | 'whitespace'
  | 'line-comment'
  | 'block-comment'
  | 'newline';

/** One contiguous trivia run owned by the source, not by an AST node. */
export type TriviaRun = {
  start: number;
  end: number;
  kind: TriviaKind;
};

/** Convenience constructor for half-open source spans. */
export function sourceSpan(start: number, end: number): SourceSpan {
  return { start, end };
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
