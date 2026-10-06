import { readEvalErrorLocation } from './eval-error-location.js';

/**
 * A source file's identity, as a DocumentContext holds it. A host may prepare
 * the text it parses (Less `banner`/`globalVars` ahead of the file, `modifyVars`
 * after it): the authored file then starts `sourceOffset` characters in and ends
 * at `sourceEnd`.
 */
export interface SourceOwner {
  readonly sourceOffset?: number;
  readonly sourceEnd?: number;
}

type SourceIndex = {
  readonly source: string;

  /** Offset of the first character of every 1-based source line. */
  readonly lineStarts: readonly number[];

  /** 0-based index of the line the authored file starts on, and the column it starts at there. */
  readonly originLine: number;
  readonly originColumn: number;

  /** 0-based index of the authored file's last line. */
  readonly lastLine: number;
};

/*
 * A DocumentContext owns one stable `file` object for its lifetime, so this is
 * naturally per source file, per compile, and cannot retain a finished compile.
 * Do not cache by source string: that would keep arbitrary caller input alive.
 */
const sourceIndexes = new WeakMap<object, SourceIndex>();

function buildSourceIndex(source: string, owner: SourceOwner | undefined): SourceIndex {
  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source.charCodeAt(offset) === 10 /* \n */) {
      lineStarts.push(offset + 1);
    }
  }
  const start = Math.min(owner?.sourceOffset ?? 0, source.length);
  const originLine = lineIndexAt(lineStarts, start);
  const end = owner?.sourceEnd;
  return {
    source,
    lineStarts,
    originLine,
    originColumn: start - lineStarts[originLine]!,
    lastLine: end === undefined ? lineStarts.length - 1 : lineIndexAt(lineStarts, Math.max(start, end - 1))
  };
}

function sourceIndex(source: string, owner?: SourceOwner): SourceIndex {
  const cached = owner === undefined ? undefined : sourceIndexes.get(owner);
  if (cached?.source === source) {
    return cached;
  }
  const indexed = buildSourceIndex(source, owner);
  if (owner !== undefined) {
    sourceIndexes.set(owner, indexed);
  }
  return indexed;
}

function lineIndexAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (lineStarts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * Derive 1-based line/column at a source offset, counted in the file as the
 * author wrote it: text a host prepared ahead of it is not counted (ledger O16),
 * so that text sits on line 0 and before. The first diagnostic for a file
 * builds the same line-start index / binary-search shape Parseman uses; later
 * diagnostics use its O(log n) lookup. `owner` should be the stable source-file
 * object when one is available.
 */
export function lineColAt(source: string, offset: number, owner?: SourceOwner): { line: number; column: number } {
  const end = Math.min(offset, source.length);
  const indexed = sourceIndex(source, owner);
  const index = lineIndexAt(indexed.lineStarts, end);
  const column = end - indexed.lineStarts[index]! + 1;
  return {
    line: index - indexed.originLine + 1,
    column: index === indexed.originLine ? column - indexed.originColumn : column
  };
}

/**
 * Re-count a line/column a parser reported in the text it was given — the
 * prepared text — in the authored file, as {@link lineColAt} counts.
 */
export function authoredLineCol(source: string, line: number, column: number, owner: SourceOwner): { line: number; column: number } {
  const { originLine, originColumn } = sourceIndex(source, owner);
  return { line: line - originLine, column: line - 1 === originLine ? column - originColumn : column };
}

/**
 * Extract the source lines around `line` for a code frame, keyed by line
 * number as {@link lineColAt} counts it: `{ 55: 'before', 56: 'error', 57:
 * 'after' }`. A frame around an authored line stays inside the authored file.
 * Returns `undefined` when there is no source. `contextLines` sets the
 * before/after radius.
 */
export function extractRelevantLines(
  source: string | undefined,
  line: number,
  contextLines = 1,
  owner?: SourceOwner
): Record<number, string> | undefined {
  if (!source) {
    return undefined;
  }
  const { lineStarts, originLine, originColumn, lastLine } = sourceIndex(source, owner);
  const index = Math.max(0, Math.min(line - 1 + originLine, lineStarts.length - 1));
  const inside = index >= originLine && index <= lastLine;
  const first = Math.max(inside ? originLine : 0, index - contextLines);
  const last = Math.min(inside ? lastLine : lineStarts.length - 1, index + contextLines);

  const result: Record<number, string> = {};
  for (let i = first; i <= last; i++) {
    const from = i === originLine ? lineStarts[i]! + originColumn : lineStarts[i]!;
    const next = lineStarts[i + 1] ?? source.length;
    const newline = next > from && source.charCodeAt(next - 1) === 10 ? 1 : 0;
    const carriageReturn = newline === 1 && next - from > 1 && source.charCodeAt(next - 2) === 13 ? 1 : 0;
    result[i - originLine + 1] = source.slice(from, next - newline - carriageReturn);
  }
  return result;
}

/**
 * Resolved code-frame position for a plain (non-`JessError`) error thrown during
 * eval, derived from the source span the eval dispatch stamped onto it.
 */
export interface EvalErrorFrame {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  lines?: Record<number, string>;
}

/**
 * Recover a code-frame position for a generic error raised during eval. The
 * central eval seam stamps the offending node's source span + source onto the
 * error; here we resolve that span into 1-based line/column and the surrounding
 * source lines. Returns `undefined` when nothing was stamped (e.g. a throw with
 * no source-bearing node), so callers keep their existing `1:1` fallback.
 */
export function evalErrorFrameFrom(err: unknown): EvalErrorFrame | undefined {
  const loc = readEvalErrorLocation(err);
  if (loc?.source === undefined) {
    return undefined;
  }
  const { line, column } = lineColAt(loc.source, loc.spanStart);
  const end = loc.spanEnd !== undefined ? lineColAt(loc.source, loc.spanEnd) : undefined;
  return {
    line,
    column,
    endLine: end?.line,
    endColumn: end?.column,
    lines: extractRelevantLines(loc.source, line)
  };
}
