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
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly qualifiers?: readonly string[];
}

export type CssMediaFeatureValueKind =
  | 'keyword'
  | 'integer'
  | 'number'
  | 'dimension'
  | 'percentage'
  | 'ratio'
  | 'function'
  | 'unknown';

export interface CssMediaFeatureValueFact {
  readonly raw: string;
  readonly normalized: string;
  readonly kind: CssMediaFeatureValueKind;
  readonly numericValue?: number;
  readonly unit?: string;
  readonly functionName?: string;
}

export type CssPropertyValueKind =
  | 'keyword'
  | 'integer'
  | 'number'
  | 'dimension'
  | 'percentage'
  | 'function'
  | 'color'
  | 'unknown';

export interface CssPropertyValueFact {
  readonly raw: string;
  readonly normalized: string;
  readonly kind: CssPropertyValueKind;
  readonly numericValue?: number;
  readonly unit?: string;
  readonly functionName?: string;
}

export type CssFeatureStatus = 'standard' | 'experimental' | 'nonstandard' | 'obsolete' | 'deprecated';

export interface CssDiagnosticMetadata {
  isKnownProperty(name: string): boolean;
  cssPropertyStatus?(name: string): CssFeatureStatus | undefined;
  isKnownPropertyValue(name: string, value: CssPropertyValueFact): boolean | undefined;
  isKnownAtRule(name: string): boolean;
  isKnownAtRuleDescriptor(atRuleName: string, descriptorName: string): boolean | undefined;
  isKnownFunction(name: string): boolean;
  isKnownMediaFeatureName(name: string): boolean;
  isKnownMediaFeatureValue(name: string, value: CssMediaFeatureValueFact): boolean | undefined;
  isKnownPseudoClass(name: string): boolean;
  isKnownPseudoElement(name: string): boolean;
  isKnownTypeSelector(name: string): boolean;
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
