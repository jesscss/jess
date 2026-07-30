import { LINT_CODES } from '@jesscss/diagnostics-core';
import type { LintConfig, LintRuleSetting, LintSeverity } from 'styles-config';

export const PARSE_SYNTAX_ERROR_CODE = 'parse/syntax-error';
export const STABLE_LINT_RULE_SET_VERSION = 9;

export type LintRuleComparisonKind = 'stylelint-equivalent' | 'stylelint-near' | 'jess-only';
export type LintRuleTier = 'css-validity' | 'maintainability' | 'style-suggestion' | 'dialect-support';

export const LINT_RULE_NAMES = {
  emptyRules: 'block-no-empty',
  unknownProperties: 'property-no-unknown',
  unknownAtRules: 'at-rule-no-unknown',
  duplicateProperties: 'declaration-block-no-duplicate-properties',
  hexColorLength: 'color-no-invalid-hex',
  zeroUnits: 'length-zero-no-unit',
  customPropertyMissingVarFunction: 'custom-property-no-missing-var-function',
  keyframeDuplicateSelectors: 'keyframe-block-no-duplicate-selectors',
  keyframeDeclarationNoImportant: 'keyframe-declaration-no-important',
  fontFamilyDuplicateNames: 'font-family-no-duplicate-names',
  fontFamilyMissingGeneric: 'font-family-no-missing-generic-family-keyword',
  invalidImportPosition: 'no-invalid-position-at-import-rule',
  duplicateAtImportRules: 'no-duplicate-at-import-rules',
  unknownUnits: 'unit-no-unknown',
  unknownFunctions: 'function-no-unknown',
  unknownMediaFeatureNames: 'media-feature-name-no-unknown',
  unknownPseudoClasses: 'selector-pseudo-class-no-unknown',
  unknownPseudoElements: 'selector-pseudo-element-no-unknown',
  unknownTypeSelectors: 'selector-type-no-unknown',
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
  [LINT_RULE_NAMES.emptyRules]: LINT_CODES.emptyRules,
  [LINT_RULE_NAMES.unknownProperties]: LINT_CODES.unknownProperties,
  [LINT_RULE_NAMES.unknownAtRules]: LINT_CODES.unknownAtRules,
  [LINT_RULE_NAMES.duplicateProperties]: LINT_CODES.duplicateProperties,
  [LINT_RULE_NAMES.hexColorLength]: LINT_CODES.hexColorLength,
  [LINT_RULE_NAMES.zeroUnits]: LINT_CODES.zeroUnits,
  [LINT_RULE_NAMES.customPropertyMissingVarFunction]: LINT_CODES.customPropertyMissingVarFunction,
  [LINT_RULE_NAMES.keyframeDuplicateSelectors]: LINT_CODES.keyframeDuplicateSelectors,
  [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: LINT_CODES.keyframeDeclarationNoImportant,
  [LINT_RULE_NAMES.fontFamilyDuplicateNames]: LINT_CODES.fontFamilyDuplicateNames,
  [LINT_RULE_NAMES.fontFamilyMissingGeneric]: LINT_CODES.fontFamilyMissingGeneric,
  [LINT_RULE_NAMES.invalidImportPosition]: LINT_CODES.invalidImportPosition,
  [LINT_RULE_NAMES.duplicateAtImportRules]: LINT_CODES.duplicateAtImportRules,
  [LINT_RULE_NAMES.unknownUnits]: LINT_CODES.unknownUnits,
  [LINT_RULE_NAMES.unknownFunctions]: LINT_CODES.unknownFunctions,
  [LINT_RULE_NAMES.unknownMediaFeatureNames]: LINT_CODES.unknownMediaFeatureNames,
  [LINT_RULE_NAMES.unknownPseudoClasses]: LINT_CODES.unknownPseudoClasses,
  [LINT_RULE_NAMES.unknownPseudoElements]: LINT_CODES.unknownPseudoElements,
  [LINT_RULE_NAMES.unknownTypeSelectors]: LINT_CODES.unknownTypeSelectors,
  [LINT_RULE_NAMES.unsupportedSassForm]: LINT_CODES.unsupportedSassForm
};

const RULE_BY_DIAGNOSTIC: Record<string, LintRuleName> = {
  [LINT_CODES.emptyRules]: LINT_RULE_NAMES.emptyRules,
  [LINT_CODES.unknownProperties]: LINT_RULE_NAMES.unknownProperties,
  [LINT_CODES.unknownAtRules]: LINT_RULE_NAMES.unknownAtRules,
  [LINT_CODES.duplicateProperties]: LINT_RULE_NAMES.duplicateProperties,
  [LINT_CODES.hexColorLength]: LINT_RULE_NAMES.hexColorLength,
  [LINT_CODES.zeroUnits]: LINT_RULE_NAMES.zeroUnits,
  [LINT_CODES.customPropertyMissingVarFunction]: LINT_RULE_NAMES.customPropertyMissingVarFunction,
  [LINT_CODES.keyframeDuplicateSelectors]: LINT_RULE_NAMES.keyframeDuplicateSelectors,
  [LINT_CODES.keyframeDeclarationNoImportant]: LINT_RULE_NAMES.keyframeDeclarationNoImportant,
  [LINT_CODES.fontFamilyDuplicateNames]: LINT_RULE_NAMES.fontFamilyDuplicateNames,
  [LINT_CODES.fontFamilyMissingGeneric]: LINT_RULE_NAMES.fontFamilyMissingGeneric,
  [LINT_CODES.invalidImportPosition]: LINT_RULE_NAMES.invalidImportPosition,
  [LINT_CODES.duplicateAtImportRules]: LINT_RULE_NAMES.duplicateAtImportRules,
  [LINT_CODES.unknownUnits]: LINT_RULE_NAMES.unknownUnits,
  [LINT_CODES.unknownFunctions]: LINT_RULE_NAMES.unknownFunctions,
  [LINT_CODES.unknownMediaFeatureNames]: LINT_RULE_NAMES.unknownMediaFeatureNames,
  [LINT_CODES.unknownPseudoClasses]: LINT_RULE_NAMES.unknownPseudoClasses,
  [LINT_CODES.unknownPseudoElements]: LINT_RULE_NAMES.unknownPseudoElements,
  [LINT_CODES.unknownTypeSelectors]: LINT_RULE_NAMES.unknownTypeSelectors,
  [LINT_CODES.unsupportedSassForm]: LINT_RULE_NAMES.unsupportedSassForm
};

const RECOMMENDED_RULES: Record<LintRuleName, LintRuleSetting> = {
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.unknownAtRules]: 'warn',
  [LINT_RULE_NAMES.duplicateProperties]: 'warn',
  [LINT_RULE_NAMES.hexColorLength]: 'error',
  [LINT_RULE_NAMES.zeroUnits]: 'warn',
  [LINT_RULE_NAMES.customPropertyMissingVarFunction]: 'warn',
  [LINT_RULE_NAMES.keyframeDuplicateSelectors]: 'warn',
  [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: 'warn',
  [LINT_RULE_NAMES.fontFamilyDuplicateNames]: 'warn',
  [LINT_RULE_NAMES.fontFamilyMissingGeneric]: 'warn',
  [LINT_RULE_NAMES.invalidImportPosition]: 'warn',
  [LINT_RULE_NAMES.duplicateAtImportRules]: 'warn',
  [LINT_RULE_NAMES.unknownUnits]: 'warn',
  [LINT_RULE_NAMES.unknownFunctions]: 'warn',
  [LINT_RULE_NAMES.unknownMediaFeatureNames]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoClasses]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoElements]: 'warn',
  [LINT_RULE_NAMES.unknownTypeSelectors]: 'warn',
  [LINT_RULE_NAMES.unsupportedSassForm]: 'warn'
};

const COMPARISON_RULES: Record<string, LintRuleSetting> = {
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.unknownAtRules]: 'warn',
  [LINT_RULE_NAMES.duplicateProperties]: 'warn',
  [LINT_RULE_NAMES.hexColorLength]: 'error',
  [LINT_RULE_NAMES.zeroUnits]: 'warn',
  [LINT_RULE_NAMES.customPropertyMissingVarFunction]: 'warn',
  [LINT_RULE_NAMES.keyframeDuplicateSelectors]: 'warn',
  [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: 'warn',
  [LINT_RULE_NAMES.fontFamilyDuplicateNames]: 'warn',
  [LINT_RULE_NAMES.fontFamilyMissingGeneric]: 'warn',
  [LINT_RULE_NAMES.invalidImportPosition]: 'warn',
  [LINT_RULE_NAMES.duplicateAtImportRules]: 'warn',
  [LINT_RULE_NAMES.unknownUnits]: 'warn',
  [LINT_RULE_NAMES.unknownFunctions]: 'warn',
  [LINT_RULE_NAMES.unknownMediaFeatureNames]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoClasses]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoElements]: 'warn',
  [LINT_RULE_NAMES.unknownTypeSelectors]: 'warn'
};

export const STABLE_LINT_RULES: readonly StableLintRule[] = [
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
    code: LINT_CODES.customPropertyMissingVarFunction,
    ruleName: LINT_RULE_NAMES.customPropertyMissingVarFunction,
    title: 'Bare custom property references',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'custom-property-no-missing-var-function',
    notes: 'Flags custom property names used as ordinary values without wrapping them in var(...).'
  },
  {
    code: LINT_CODES.keyframeDuplicateSelectors,
    ruleName: LINT_RULE_NAMES.keyframeDuplicateSelectors,
    title: 'Duplicate keyframe selectors',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'keyframe-block-no-duplicate-selectors',
    notes: 'Flags duplicate selectors in one @keyframes block, normalizing from/to to 0%/100%.'
  },
  {
    code: LINT_CODES.keyframeDeclarationNoImportant,
    ruleName: LINT_RULE_NAMES.keyframeDeclarationNoImportant,
    title: 'Important keyframe declarations',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'keyframe-declaration-no-important',
    notes: 'Flags !important declarations inside @keyframes blocks.'
  },
  {
    code: LINT_CODES.fontFamilyDuplicateNames,
    ruleName: LINT_RULE_NAMES.fontFamilyDuplicateNames,
    title: 'Duplicate font family names',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'font-family-no-duplicate-names',
    notes: 'Flags duplicate names in font-family declarations while leaving dynamic values alone.'
  },
  {
    code: LINT_CODES.fontFamilyMissingGeneric,
    ruleName: LINT_RULE_NAMES.fontFamilyMissingGeneric,
    title: 'Missing generic font family',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'font-family-no-missing-generic-family-keyword',
    notes: 'Flags definite font-family declarations that omit a generic family keyword.'
  },
  {
    code: LINT_CODES.invalidImportPosition,
    ruleName: LINT_RULE_NAMES.invalidImportPosition,
    title: 'Invalid @import positions',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'no-invalid-position-at-import-rule',
    notes: 'Flags CSS @import rules that appear after style rules or blocking at-rules; @charset and statement @layer do not block imports.'
  },
  {
    code: LINT_CODES.duplicateAtImportRules,
    ruleName: LINT_RULE_NAMES.duplicateAtImportRules,
    title: 'Duplicate @import rules',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'no-duplicate-at-import-rules',
    notes: 'Flags repeated @import targets with the same authored options and conditions in one file.'
  },
  {
    code: LINT_CODES.unknownUnits,
    ruleName: LINT_RULE_NAMES.unknownUnits,
    title: 'Unknown units',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'unit-no-unknown',
    notes: 'Flags unknown CSS units from parsed Dimension nodes, suppressing url() values and allowing resolution x where CSS permits it.'
  },
  {
    code: LINT_CODES.unknownFunctions,
    ruleName: LINT_RULE_NAMES.unknownFunctions,
    title: 'Unknown functions',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'function-no-unknown',
    notes: 'Flags unknown CSS declaration functions using css-functions-list; dialect callable checks wait for semantic facts.'
  },
  {
    code: LINT_CODES.unknownMediaFeatureNames,
    ruleName: LINT_RULE_NAMES.unknownMediaFeatureNames,
    title: 'Unknown media feature names',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'media-feature-name-no-unknown',
    notes: 'Flags unknown CSS @media feature names; skips custom media and vendor-prefixed features.'
  },
  {
    code: LINT_CODES.unknownPseudoClasses,
    ruleName: LINT_RULE_NAMES.unknownPseudoClasses,
    title: 'Unknown pseudo-classes',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-pseudo-class-no-unknown',
    notes: 'Flags unknown pseudo-class selectors using CSS metadata while suppressing custom, vendor, and dialect pseudo-classes.'
  },
  {
    code: LINT_CODES.unknownPseudoElements,
    ruleName: LINT_RULE_NAMES.unknownPseudoElements,
    title: 'Unknown pseudo-elements',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-pseudo-element-no-unknown',
    notes: 'Flags unknown pseudo-element selectors using CSS metadata while suppressing vendor pseudo-elements.'
  },
  {
    code: LINT_CODES.unknownTypeSelectors,
    ruleName: LINT_RULE_NAMES.unknownTypeSelectors,
    title: 'Unknown type selectors',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-type-no-unknown',
    notes: 'Flags unknown CSS type selectors using HTML, SVG, and MathML metadata; custom elements and dialect selectors are intentionally skipped.'
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
