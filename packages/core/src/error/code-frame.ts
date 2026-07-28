import { readEvalErrorLocation } from '../tree/util/provenance.js';

/**
 * Derive 1-based line/column at a source offset. Line/col are not stored on
 * nodes (only offsets are) — they're computed here on the cold error path.
 */
export function lineColAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/**
 * Extract the source lines around `line` (1-indexed) for a code frame, keyed by
 * line number: `{ 55: 'before', 56: 'error', 57: 'after' }`. Returns `undefined`
 * when there is no source. `contextLines` sets the before/after radius.
 */
export function extractRelevantLines(
  source: string | undefined,
  line: number,
  contextLines = 1
): Record<number, string> | undefined {
  if (!source) {
    return undefined;
  }
  const lines = source.split(/\r?\n/);
  const target = Math.max(1, Math.min(line, lines.length));
  const start = Math.max(1, target - contextLines);
  const end = Math.min(lines.length, target + contextLines);

  const result: Record<number, string> = {};
  for (let i = start; i <= end; i++) {
    result[i] = lines[i - 1]!;
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
