import type { SourceText } from './source/index.js';
export type { SourcePosition } from './source/line-map.js';

export interface ParserDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  start: number;
  end: number;
}

export interface ScannerParseResult<T> {
  tree: T;
  source: SourceText;
  diagnostics: readonly ParserDiagnostic[];
}

/** Append one offset-only parser diagnostic, allocating the array only on first use. */
export function appendParserDiagnostic(
  diagnostics: ParserDiagnostic[] | undefined,
  severity: ParserDiagnostic['severity'],
  code: string,
  message: string,
  start: number,
  end: number
): ParserDiagnostic[] {
  const output = diagnostics ?? [];
  output.push({ severity, code, message, start, end });
  return output;
}
