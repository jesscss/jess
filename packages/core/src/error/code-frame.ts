import { readEvalErrorLocation } from './eval-error-location.js';

type SourceIndex = {
  readonly source: string;

  /** Offset of the first character of every 1-based source line. */
  readonly lineStarts: readonly number[];
};

/*
 * A DocumentContext owns one stable `file` object for its lifetime, so this is
 * naturally per source file, per compile, and cannot retain a finished compile.
 * Do not cache by source string: that would keep arbitrary caller input alive.
 */
const sourceIndexes = new WeakMap<object, SourceIndex>();

function buildSourceIndex(source: string): SourceIndex {
  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source.charCodeAt(offset) === 10 /* \n */) {
      lineStarts.push(offset + 1);
    }
  }
  return { source, lineStarts };
}

function sourceIndex(source: string, owner?: object): SourceIndex {
  const cached = owner === undefined ? undefined : sourceIndexes.get(owner);
  if (cached?.source === source) {
    return cached;
  }
  const indexed = buildSourceIndex(source);
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
 * Derive 1-based line/column at a source offset. The first diagnostic for a
 * file builds the same line-start index / binary-search shape Parseman uses;
 * later diagnostics use its O(log n) lookup.
 * `owner` should be the stable source-file object when one is available.
 */
export function lineColAt(source: string, offset: number, owner?: object): { line: number; column: number } {
  const end = Math.min(offset, source.length);
  const lineStarts = sourceIndex(source, owner).lineStarts;
  const index = lineIndexAt(lineStarts, end);
  return { line: index + 1, column: end - lineStarts[index]! + 1 };
}

/**
 * Extract the source lines around `line` (1-indexed) for a code frame, keyed by
 * line number: `{ 55: 'before', 56: 'error', 57: 'after' }`. Returns `undefined`
 * when there is no source. `contextLines` sets the before/after radius.
 */
export function extractRelevantLines(
  source: string | undefined,
  line: number,
  contextLines = 1,
  owner?: object
): Record<number, string> | undefined {
  if (!source) {
    return undefined;
  }
  const { lineStarts } = sourceIndex(source, owner);
  const target = Math.max(1, Math.min(line, lineStarts.length));
  const start = Math.max(1, target - contextLines);
  const end = Math.min(lineStarts.length, target + contextLines);

  const result: Record<number, string> = {};
  for (let i = start; i <= end; i++) {
    const from = lineStarts[i - 1]!;
    const next = lineStarts[i] ?? source.length;
    const newline = next > from && source.charCodeAt(next - 1) === 10 ? 1 : 0;
    const carriageReturn = newline === 1 && next - from > 1 && source.charCodeAt(next - 2) === 13 ? 1 : 0;
    result[i] = source.slice(from, next - newline - carriageReturn);
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
