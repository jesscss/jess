import { LINT_CODES } from '@jesscss/diagnostics-core';
import type { LintConfig, LintRuleSetting, LintSeverity } from 'styles-config';

export const PARSE_SYNTAX_ERROR_CODE = 'parse/syntax-error';
export const STABLE_LINT_RULE_SET_VERSION = 1;

export type LintRuleComparisonKind = 'stylelint-equivalent' | 'stylelint-near' | 'jess-only';
export type LintRuleTier = 'syntax' | 'css-validity' | 'maintainability' | 'style-suggestion' | 'dialect-support';

export const LINT_RULE_NAMES = {
  syntaxError: PARSE_SYNTAX_ERROR_CODE,
  emptyRules: 'block-no-empty',
  unknownProperties: 'property-no-unknown',
  unknownAtRules: 'at-rule-no-unknown',
  duplicateProperties: 'declaration-block-no-duplicate-properties',
  hexColorLength: 'color-no-invalid-hex',
  zeroUnits: 'length-zero-no-unit',
  unsupportedSassForm: 'jess/unsupported-sass-form'
} as const;

export type LintRuleName = typeof LINT_RULE_NAMES[keyof typeof LINT_RULE_NAMES];

export interface StableLintRule {
  readonly code: string;
  readonly ruleName: LintRuleName;
  readonly title: string;
  readonly tier: LintRuleTier;
  readonly defaultPolicy: LintSeverity;
  readonly comparison: LintRuleComparisonKind;
  readonly stylelintRule?: string;
  readonly notes: string;
}

const DIAGNOSTIC_BY_RULE: Record<LintRuleName, string> = {
  [LINT_RULE_NAMES.syntaxError]: PARSE_SYNTAX_ERROR_CODE,
  [LINT_RULE_NAMES.emptyRules]: LINT_CODES.emptyRules,
  [LINT_RULE_NAMES.unknownProperties]: LINT_CODES.unknownProperties,
  [LINT_RULE_NAMES.unknownAtRules]: LINT_CODES.unknownAtRules,
  [LINT_RULE_NAMES.duplicateProperties]: LINT_CODES.duplicateProperties,
  [LINT_RULE_NAMES.hexColorLength]: LINT_CODES.hexColorLength,
  [LINT_RULE_NAMES.zeroUnits]: LINT_CODES.zeroUnits,
  [LINT_RULE_NAMES.unsupportedSassForm]: LINT_CODES.unsupportedSassForm
};

const RULE_BY_DIAGNOSTIC: Record<string, LintRuleName> = {
  [PARSE_SYNTAX_ERROR_CODE]: LINT_RULE_NAMES.syntaxError,
  [LINT_CODES.emptyRules]: LINT_RULE_NAMES.emptyRules,
  [LINT_CODES.unknownProperties]: LINT_RULE_NAMES.unknownProperties,
  [LINT_CODES.unknownAtRules]: LINT_RULE_NAMES.unknownAtRules,
  [LINT_CODES.duplicateProperties]: LINT_RULE_NAMES.duplicateProperties,
  [LINT_CODES.hexColorLength]: LINT_RULE_NAMES.hexColorLength,
  [LINT_CODES.zeroUnits]: LINT_RULE_NAMES.zeroUnits,
  [LINT_CODES.unsupportedSassForm]: LINT_RULE_NAMES.unsupportedSassForm
};

const RECOMMENDED_RULES: Record<LintRuleName, LintRuleSetting> = {
  [LINT_RULE_NAMES.syntaxError]: 'error',
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.unknownAtRules]: 'warn',
  [LINT_RULE_NAMES.duplicateProperties]: 'warn',
  [LINT_RULE_NAMES.hexColorLength]: 'error',
  [LINT_RULE_NAMES.zeroUnits]: 'warn',
  [LINT_RULE_NAMES.unsupportedSassForm]: 'warn'
};

const COMPARISON_RULES: Record<string, LintRuleSetting> = {
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.unknownAtRules]: 'warn',
  [LINT_RULE_NAMES.duplicateProperties]: 'warn',
  [LINT_RULE_NAMES.hexColorLength]: 'error',
  [LINT_RULE_NAMES.zeroUnits]: 'warn'
};

export const STABLE_LINT_RULES: readonly StableLintRule[] = [
  {
    code: PARSE_SYNTAX_ERROR_CODE,
    ruleName: LINT_RULE_NAMES.syntaxError,
    title: 'Syntax error',
    tier: 'syntax',
    defaultPolicy: 'error',
    comparison: 'jess-only',
    notes: 'Parser diagnostic surfaced through lint policy; Stylelint reports parser errors through its own parser path.'
  },
  {
    code: LINT_CODES.emptyRules,
    ruleName: LINT_RULE_NAMES.emptyRules,
    title: 'Empty rules',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'block-no-empty',
    notes: 'Flags empty qualified rules after Jess dialect parsing.'
  },
  {
    code: LINT_CODES.unknownProperties,
    ruleName: LINT_RULE_NAMES.unknownProperties,
    title: 'Unknown properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'property-no-unknown',
    notes: 'Uses Jess language metadata and suppresses dialect variables, custom properties, vendor-prefixed properties, and interpolated names.'
  },
  {
    code: LINT_CODES.unknownAtRules,
    ruleName: LINT_RULE_NAMES.unknownAtRules,
    title: 'Unknown at-rules',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-no-unknown',
    notes: 'Uses Jess language metadata plus dialect at-rule allow-lists.'
  },
  {
    code: LINT_CODES.duplicateProperties,
    ruleName: LINT_RULE_NAMES.duplicateProperties,
    title: 'Duplicate properties',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'declaration-block-no-duplicate-properties',
    notes: 'Flags duplicate declaration names in the same parsed block.'
  },
  {
    code: LINT_CODES.hexColorLength,
    ruleName: LINT_RULE_NAMES.hexColorLength,
    title: 'Invalid hex colors',
    tier: 'css-validity',
    defaultPolicy: 'error',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'color-no-invalid-hex',
    notes: 'Flags hex color literals whose digit count is not valid CSS.'
  },
  {
    code: LINT_CODES.zeroUnits,
    ruleName: LINT_RULE_NAMES.zeroUnits,
    title: 'Zero length units',
    tier: 'style-suggestion',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'length-zero-no-unit',
    notes: 'Flags zero values with length units; non-length units such as percentages and time are left alone.'
  },
  {
    code: LINT_CODES.unsupportedSassForm,
    ruleName: LINT_RULE_NAMES.unsupportedSassForm,
    title: 'Unsupported Sass forms',
    tier: 'dialect-support',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Jess dialect support diagnostic shared with the language service.'
  }
];

export const RECOMMENDED_LINT_CONFIG: LintConfig = {
  reportSyntax: true,
  rules: RECOMMENDED_RULES
};

export const STYLELINT_COMPARISON_LINT_CONFIG: LintConfig = {
  reportSyntax: false,
  rules: COMPARISON_RULES
};

function isLintRuleName(ruleName: string): ruleName is LintRuleName {
  return Object.hasOwn(DIAGNOSTIC_BY_RULE, ruleName);
}

export function diagnosticCodeForRule(ruleName: string): string | undefined {
  return isLintRuleName(ruleName) ? DIAGNOSTIC_BY_RULE[ruleName] : undefined;
}

export function ruleNameForDiagnostic(code: string): string {
  return RULE_BY_DIAGNOSTIC[code] ?? code;
}

export function recommendedLintRules(): Record<string, LintRuleSetting> {
  return { ...RECOMMENDED_RULES };
}

export function recommendedLintDiagnostics(): Record<string, LintSeverity> {
  return diagnosticPoliciesForRules(RECOMMENDED_RULES);
}

export function stylelintComparisonRules(): Record<string, LintRuleSetting> {
  return { ...COMPARISON_RULES };
}

export function stylelintComparisonDiagnostics(): Record<string, LintSeverity> {
  return diagnosticPoliciesForRules(COMPARISON_RULES);
}

function diagnosticPoliciesForRules(rules: Record<string, LintRuleSetting>): Record<string, LintSeverity> {
  const diagnostics: Record<string, LintSeverity> = {};
  for (const [ruleName, severity] of Object.entries(rules)) {
    if (severity === null || severity === 'off') {
      continue;
    }
    const code = diagnosticCodeForRule(ruleName);
    if (code) {
      diagnostics[code] = severity;
    }
  }
  return diagnostics;
}
