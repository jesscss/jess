import { readEvalErrorLocation } from './eval-error-location.js';

/**
 * A source file's identity, as a DocumentContext holds it. A host may prepare
 * the text it parses (Less `banner`/`globalVars` ahead of the file, `modifyVars`
 * after it): the authored file then starts `sourceOffset` characters in and ends
 * at `sourceEnd`.
 */
export interface SourceOwner {
  readonly source?: string;
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

/** The note a diagnostic in host-injected text carries (see {@link fileAt}). */
export const INJECTED_TEXT_NOTE = 'This is in text the compiler added around the file (Less `banner`, `globalVars` or `modifyVars`), not in the file as written.';

/**
 * The file a position at `offset` is counted in. A position in the authored
 * file is counted in `file` itself. One in text the host injected around it
 * (Less `banner`/`globalVars` ahead, `modifyVars` after) has no line in the
 * authored file, so it is counted in the same file read as the whole prepared
 * text: its line and frame show the injected line it is on, never a line before
 * 1 or past the authored end (ledger O16), and the diagnostic says so
 * ({@link INJECTED_TEXT_NOTE}).
 */
export function fileAt<F extends SourceOwner>(file: F, source: string, offset: number): F {
  const start = file.sourceOffset ?? 0;
  const end = file.sourceEnd ?? source.length;
  if (offset >= start && offset <= end) {
    return file;
  }

  /* ponytail: a fresh view per diagnostic re-indexes the text; only a diagnostic in injected text pays it. */
  return { ...file, sourceOffset: undefined, sourceEnd: undefined };
}

/**
 * Derive 1-based line/column at a source offset, counted in the file as the
 * author wrote it: text a host prepared ahead of it is not counted (ledger O16);
 * a position in that text is counted by {@link fileAt}. The first diagnostic for a file
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
 * prepared text — in the authored file, as {@link lineColAt} counts, or
 * `undefined` for a position in text the host injected around the file, which
 * stays counted in the prepared text ({@link fileAt}).
 */
export function authoredLineCol(source: string, line: number, column: number, owner: SourceOwner): { line: number; column: number } | undefined {
  const { lineStarts, originLine, originColumn } = sourceIndex(source, owner);
  const offset = (lineStarts[line - 1] ?? source.length) + column - 1;
  if (fileAt(owner, source, offset) !== owner) {
    return undefined;
  }
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

  /** {@link INJECTED_TEXT_NOTE} when the position is in text the host added around the file. */
  note?: string;
}

/**
 * Recover a code-frame position for a generic error raised during eval. The
 * central eval seam stamps the offending node's source span + source onto the
 * error; here we resolve that span into 1-based line/column and the surrounding
 * source lines, counted in the file as written (ledger O16), as every other
 * diagnostic is. Returns `undefined` when nothing was stamped (e.g. a throw with
 * no source-bearing node), so callers keep their existing `1:1` fallback.
 */
export function evalErrorFrameFrom(err: unknown): EvalErrorFrame | undefined {
  const loc = readEvalErrorLocation(err);
  const source = loc?.file?.source;
  if (loc === undefined || source === undefined) {
    return undefined;
  }
  const owner = fileAt(loc.file!, source, loc.spanStart);
  const { line, column } = lineColAt(source, loc.spanStart, owner);
  const end = loc.spanEnd !== undefined ? lineColAt(source, loc.spanEnd, owner) : undefined;
  return {
    line,
    column,
    endLine: end?.line,
    endColumn: end?.column,
    lines: extractRelevantLines(source, line, 1, owner),
    ...(owner === loc.file ? {} : { note: INJECTED_TEXT_NOTE })
  };
}
