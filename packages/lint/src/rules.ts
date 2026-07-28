import { LINT_CODES } from '@jesscss/diagnostics-core';
import type { LintConfig, LintSeverity } from 'styles-config';

export const PARSE_SYNTAX_ERROR_CODE = 'parse/syntax-error';
export const STABLE_LINT_RULE_SET_VERSION = 1;

export type LintRuleComparisonKind = 'stylelint-equivalent' | 'stylelint-near' | 'jess-only';
export type LintRuleTier = 'syntax' | 'css-validity' | 'maintainability' | 'style-suggestion' | 'dialect-support';

export interface StableLintRule {
  readonly code: string;
  readonly title: string;
  readonly tier: LintRuleTier;
  readonly defaultPolicy: LintSeverity;
  readonly comparison: LintRuleComparisonKind;
  readonly stylelintRule?: string;
  readonly notes: string;
}

const RECOMMENDED_DIAGNOSTICS: Record<string, LintSeverity> = {
  [PARSE_SYNTAX_ERROR_CODE]: 'error',
  [LINT_CODES.emptyRules]: 'warn',
  [LINT_CODES.unknownProperties]: 'warn',
  [LINT_CODES.unknownAtRules]: 'warn',
  [LINT_CODES.duplicateProperties]: 'warn',
  [LINT_CODES.hexColorLength]: 'error',
  [LINT_CODES.zeroUnits]: 'warn',
  [LINT_CODES.unsupportedSassForm]: 'warn'
};

const COMPARISON_DIAGNOSTICS: Record<string, LintSeverity> = {
  [LINT_CODES.emptyRules]: 'warn',
  [LINT_CODES.unknownProperties]: 'warn',
  [LINT_CODES.unknownAtRules]: 'warn',
  [LINT_CODES.duplicateProperties]: 'warn',
  [LINT_CODES.hexColorLength]: 'error',
  [LINT_CODES.zeroUnits]: 'warn'
};

export const STABLE_LINT_RULES: readonly StableLintRule[] = [
  {
    code: PARSE_SYNTAX_ERROR_CODE,
    title: 'Syntax error',
    tier: 'syntax',
    defaultPolicy: 'error',
    comparison: 'jess-only',
    notes: 'Parser diagnostic surfaced through lint policy; Stylelint reports parser errors through its own parser path.'
  },
  {
    code: LINT_CODES.emptyRules,
    title: 'Empty rules',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'block-no-empty',
    notes: 'Flags empty qualified rules after Jess dialect parsing.'
  },
  {
    code: LINT_CODES.unknownProperties,
    title: 'Unknown properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'property-no-unknown',
    notes: 'Uses Jess language metadata and suppresses dialect variables, custom properties, vendor-prefixed properties, and interpolated names.'
  },
  {
    code: LINT_CODES.unknownAtRules,
    title: 'Unknown at-rules',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-no-unknown',
    notes: 'Uses Jess language metadata plus dialect at-rule allow-lists.'
  },
  {
    code: LINT_CODES.duplicateProperties,
    title: 'Duplicate properties',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'declaration-block-no-duplicate-properties',
    notes: 'Flags duplicate declaration names in the same parsed block.'
  },
  {
    code: LINT_CODES.hexColorLength,
    title: 'Invalid hex colors',
    tier: 'css-validity',
    defaultPolicy: 'error',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'color-no-invalid-hex',
    notes: 'Flags hex color literals whose digit count is not valid CSS.'
  },
  {
    code: LINT_CODES.zeroUnits,
    title: 'Zero length units',
    tier: 'style-suggestion',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'length-zero-no-unit',
    notes: 'Flags zero values with length units; non-length units such as percentages and time are left alone.'
  },
  {
    code: LINT_CODES.unsupportedSassForm,
    title: 'Unsupported Sass forms',
    tier: 'dialect-support',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Jess dialect support diagnostic shared with the language service.'
  }
];

export const RECOMMENDED_LINT_CONFIG: LintConfig = {
  reportSyntax: true,
  diagnostics: RECOMMENDED_DIAGNOSTICS
};

export const STYLELINT_COMPARISON_LINT_CONFIG: LintConfig = {
  reportSyntax: false,
  diagnostics: COMPARISON_DIAGNOSTICS
};

export function recommendedLintDiagnostics(): Record<string, LintSeverity> {
  return { ...RECOMMENDED_DIAGNOSTICS };
}

export function stylelintComparisonDiagnostics(): Record<string, LintSeverity> {
  return { ...COMPARISON_DIAGNOSTICS };
}
