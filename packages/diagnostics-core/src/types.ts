import type { Phase } from '@jesscss/core';

export type JessLanguage = 'css' | 'less' | 'scss' | 'jess';

export type DiagnosticSeverityName = 'error' | 'warning' | 'information' | 'hint';

export interface SourceDiagnostic {
  readonly code: string;
  readonly phase: Phase;
  readonly source: 'jess';
  readonly message: string;
  readonly reason: string;
  readonly fix: string;
  readonly defaultSeverity: DiagnosticSeverityName;
  readonly filePath?: string;
  readonly start: number;
  readonly end: number;
}

export interface CssDiagnosticMetadata {
  isKnownProperty(name: string): boolean;
  isKnownAtRule(name: string): boolean;
}

export interface CollectDiagnosticsInput {
  readonly source: string;
  readonly language: JessLanguage;
  readonly filePath?: string;
  readonly metadata?: Partial<CssDiagnosticMetadata>;
}

export interface CollectDiagnosticsResult {
  readonly diagnostics: readonly SourceDiagnostic[];
}
