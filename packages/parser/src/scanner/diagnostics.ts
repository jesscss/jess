import type { SourceText } from '../source/source-text.js';

/** Diagnostic severities understood by parser services. */
export type ParserDiagnosticSeverity = 'error' | 'warning';

/**
 * Offset-based diagnostic emitted during scanner or structural recovery.
 *
 * Diagnostics stay in source offsets until rendered so callers that only need
 * machine-readable spans avoid allocating line maps.
 */
export type ParserDiagnostic = {
  code: string;
  severity: ParserDiagnosticSeverity;
  message: string;
  start: number;
  end: number;
  expected?: string;
  actual?: string;
  context?: string;
  recoveryBoundary?: number;
};

/** Input form accepted by `createParserDiagnostic`. */
export type ParserDiagnosticInput = Omit<ParserDiagnostic, 'severity'> & {
  severity?: ParserDiagnosticSeverity;
};

/** Diagnostic after source offsets have been rendered to line/column data. */
export type RenderedParserDiagnostic = ParserDiagnostic & {
  filePath?: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

/** Creates a normalized diagnostic, defaulting severity to `error`. */
export function createParserDiagnostic(
  input: ParserDiagnosticInput
): ParserDiagnostic {
  return {
    severity: input.severity ?? 'error',
    code: input.code,
    message: input.message,
    start: input.start,
    end: input.end,
    expected: input.expected,
    actual: input.actual,
    context: input.context,
    recoveryBoundary: input.recoveryBoundary
  };
}

/**
 * Adds file and line/column information for UI output.
 *
 * This is the point where `SourceText.lineMap` is intentionally materialized.
 */
export function renderParserDiagnostic(
  source: SourceText,
  diagnostic: ParserDiagnostic
): RenderedParserDiagnostic {
  const start = source.offsetToPosition(diagnostic.start);
  const end = source.offsetToPosition(diagnostic.end);

  return {
    ...diagnostic,
    filePath: source.filePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column
  };
}
