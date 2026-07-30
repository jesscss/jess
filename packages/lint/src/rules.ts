import { LINT_CODES } from '@jesscss/diagnostics-core';
import type { LintConfig, LintRuleSetting, LintSeverity } from 'styles-config';

export const PARSE_SYNTAX_ERROR_CODE = 'parse/syntax-error';
export const STABLE_LINT_RULE_SET_VERSION = 29;

export type LintRuleComparisonKind = 'stylelint-equivalent' | 'stylelint-near' | 'vscode-equivalent' | 'jess-only';
export type LintRuleTier = 'css-validity' | 'maintainability' | 'style-suggestion' | 'dialect-support';

export const LINT_RULE_NAMES = {
  emptyRules: 'block-no-empty',
  unknownProperties: 'property-no-unknown',
  unknownPropertyValues: 'declaration-property-value-no-unknown',
  unknownAtRules: 'at-rule-no-unknown',
  unknownAtRuleDescriptors: 'at-rule-descriptor-no-unknown',
  unknownAtRuleDescriptorValues: 'at-rule-descriptor-value-no-unknown',
  duplicateProperties: 'declaration-block-no-duplicate-properties',
  shorthandPropertyOverrides: 'declaration-block-no-shorthand-property-overrides',
  duplicateCustomProperties: 'declaration-block-no-duplicate-custom-properties',
  hexColorLength: 'color-no-invalid-hex',
  zeroUnits: 'length-zero-no-unit',
  customPropertyMissingVarFunction: 'custom-property-no-missing-var-function',
  unknownCustomProperties: 'no-unknown-custom-properties',
  keyframeDuplicateSelectors: 'keyframe-block-no-duplicate-selectors',
  keyframeDeclarationNoImportant: 'keyframe-declaration-no-important',
  declarationNoImportant: 'declaration-no-important',
  invalidNamedGridAreas: 'named-grid-areas-no-invalid',
  fontFamilyDuplicateNames: 'font-family-no-duplicate-names',
  fontFamilyMissingGeneric: 'font-family-no-missing-generic-family-keyword',
  fontFaceMissingRequiredProperties: 'font-face-no-missing-required-properties',
  propertyIgnoredDueToDisplay: 'property-ignored-due-to-display',
  boxModel: 'box-model',
  invalidImportPosition: 'no-invalid-position-at-import-rule',
  duplicateAtImportRules: 'no-duplicate-at-import-rules',
  unknownAnimations: 'no-unknown-animations',
  duplicateSelectors: 'no-duplicate-selectors',
  unknownUnits: 'unit-no-unknown',
  unknownFunctions: 'function-no-unknown',
  linearGradientNonstandardDirection: 'function-linear-gradient-no-nonstandard-direction',
  unknownMediaFeatureNames: 'media-feature-name-no-unknown',
  unknownMediaFeatureValues: 'media-feature-name-value-no-unknown',
  unknownPseudoClasses: 'selector-pseudo-class-no-unknown',
  unknownPseudoElements: 'selector-pseudo-element-no-unknown',
  unmatchableAnbSelectors: 'selector-anb-no-unmatchable',
  unknownTypeSelectors: 'selector-type-no-unknown',
  incompatibleMathFunctionUnits: 'jess/no-incompatible-math-function-units',
  invalidColorFunctionChannels: 'color-function-no-invalid-arguments',
  invalidTypedCustomPropertyValue: 'jess/no-invalid-typed-custom-property-value',
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
  [LINT_RULE_NAMES.unknownPropertyValues]: LINT_CODES.unknownPropertyValues,
  [LINT_RULE_NAMES.unknownAtRules]: LINT_CODES.unknownAtRules,
  [LINT_RULE_NAMES.unknownAtRuleDescriptors]: LINT_CODES.unknownAtRuleDescriptors,
  [LINT_RULE_NAMES.unknownAtRuleDescriptorValues]: LINT_CODES.unknownAtRuleDescriptorValues,
  [LINT_RULE_NAMES.duplicateProperties]: LINT_CODES.duplicateProperties,
  [LINT_RULE_NAMES.shorthandPropertyOverrides]: LINT_CODES.shorthandPropertyOverrides,
  [LINT_RULE_NAMES.duplicateCustomProperties]: LINT_CODES.duplicateCustomProperties,
  [LINT_RULE_NAMES.hexColorLength]: LINT_CODES.hexColorLength,
  [LINT_RULE_NAMES.zeroUnits]: LINT_CODES.zeroUnits,
  [LINT_RULE_NAMES.customPropertyMissingVarFunction]: LINT_CODES.customPropertyMissingVarFunction,
  [LINT_RULE_NAMES.unknownCustomProperties]: LINT_CODES.unknownCustomProperties,
  [LINT_RULE_NAMES.keyframeDuplicateSelectors]: LINT_CODES.keyframeDuplicateSelectors,
  [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: LINT_CODES.keyframeDeclarationNoImportant,
  [LINT_RULE_NAMES.declarationNoImportant]: LINT_CODES.declarationNoImportant,
  [LINT_RULE_NAMES.invalidNamedGridAreas]: LINT_CODES.invalidNamedGridAreas,
  [LINT_RULE_NAMES.fontFamilyDuplicateNames]: LINT_CODES.fontFamilyDuplicateNames,
  [LINT_RULE_NAMES.fontFamilyMissingGeneric]: LINT_CODES.fontFamilyMissingGeneric,
  [LINT_RULE_NAMES.fontFaceMissingRequiredProperties]: LINT_CODES.fontFaceMissingRequiredProperties,
  [LINT_RULE_NAMES.propertyIgnoredDueToDisplay]: LINT_CODES.propertyIgnoredDueToDisplay,
  [LINT_RULE_NAMES.boxModel]: LINT_CODES.boxModel,
  [LINT_RULE_NAMES.invalidImportPosition]: LINT_CODES.invalidImportPosition,
  [LINT_RULE_NAMES.duplicateAtImportRules]: LINT_CODES.duplicateAtImportRules,
  [LINT_RULE_NAMES.unknownAnimations]: LINT_CODES.unknownAnimations,
  [LINT_RULE_NAMES.duplicateSelectors]: LINT_CODES.duplicateSelectors,
  [LINT_RULE_NAMES.unknownUnits]: LINT_CODES.unknownUnits,
  [LINT_RULE_NAMES.unknownFunctions]: LINT_CODES.unknownFunctions,
  [LINT_RULE_NAMES.linearGradientNonstandardDirection]: LINT_CODES.linearGradientNonstandardDirection,
  [LINT_RULE_NAMES.unknownMediaFeatureNames]: LINT_CODES.unknownMediaFeatureNames,
  [LINT_RULE_NAMES.unknownMediaFeatureValues]: LINT_CODES.unknownMediaFeatureValues,
  [LINT_RULE_NAMES.unknownPseudoClasses]: LINT_CODES.unknownPseudoClasses,
  [LINT_RULE_NAMES.unknownPseudoElements]: LINT_CODES.unknownPseudoElements,
  [LINT_RULE_NAMES.unmatchableAnbSelectors]: LINT_CODES.unmatchableAnbSelectors,
  [LINT_RULE_NAMES.unknownTypeSelectors]: LINT_CODES.unknownTypeSelectors,
  [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: LINT_CODES.incompatibleMathFunctionUnits,
  [LINT_RULE_NAMES.invalidColorFunctionChannels]: LINT_CODES.invalidColorFunctionChannels,
  [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: LINT_CODES.invalidTypedCustomPropertyValue,
  [LINT_RULE_NAMES.unsupportedSassForm]: LINT_CODES.unsupportedSassForm
};

const RULE_BY_DIAGNOSTIC: Record<string, LintRuleName> = {
  [LINT_CODES.emptyRules]: LINT_RULE_NAMES.emptyRules,
  [LINT_CODES.unknownProperties]: LINT_RULE_NAMES.unknownProperties,
  [LINT_CODES.unknownPropertyValues]: LINT_RULE_NAMES.unknownPropertyValues,
  [LINT_CODES.unknownAtRules]: LINT_RULE_NAMES.unknownAtRules,
  [LINT_CODES.unknownAtRuleDescriptors]: LINT_RULE_NAMES.unknownAtRuleDescriptors,
  [LINT_CODES.unknownAtRuleDescriptorValues]: LINT_RULE_NAMES.unknownAtRuleDescriptorValues,
  [LINT_CODES.duplicateProperties]: LINT_RULE_NAMES.duplicateProperties,
  [LINT_CODES.shorthandPropertyOverrides]: LINT_RULE_NAMES.shorthandPropertyOverrides,
  [LINT_CODES.duplicateCustomProperties]: LINT_RULE_NAMES.duplicateCustomProperties,
  [LINT_CODES.hexColorLength]: LINT_RULE_NAMES.hexColorLength,
  [LINT_CODES.zeroUnits]: LINT_RULE_NAMES.zeroUnits,
  [LINT_CODES.customPropertyMissingVarFunction]: LINT_RULE_NAMES.customPropertyMissingVarFunction,
  [LINT_CODES.unknownCustomProperties]: LINT_RULE_NAMES.unknownCustomProperties,
  [LINT_CODES.keyframeDuplicateSelectors]: LINT_RULE_NAMES.keyframeDuplicateSelectors,
  [LINT_CODES.keyframeDeclarationNoImportant]: LINT_RULE_NAMES.keyframeDeclarationNoImportant,
  [LINT_CODES.declarationNoImportant]: LINT_RULE_NAMES.declarationNoImportant,
  [LINT_CODES.invalidNamedGridAreas]: LINT_RULE_NAMES.invalidNamedGridAreas,
  [LINT_CODES.fontFamilyDuplicateNames]: LINT_RULE_NAMES.fontFamilyDuplicateNames,
  [LINT_CODES.fontFamilyMissingGeneric]: LINT_RULE_NAMES.fontFamilyMissingGeneric,
  [LINT_CODES.fontFaceMissingRequiredProperties]: LINT_RULE_NAMES.fontFaceMissingRequiredProperties,
  [LINT_CODES.propertyIgnoredDueToDisplay]: LINT_RULE_NAMES.propertyIgnoredDueToDisplay,
  [LINT_CODES.boxModel]: LINT_RULE_NAMES.boxModel,
  [LINT_CODES.invalidImportPosition]: LINT_RULE_NAMES.invalidImportPosition,
  [LINT_CODES.duplicateAtImportRules]: LINT_RULE_NAMES.duplicateAtImportRules,
  [LINT_CODES.unknownAnimations]: LINT_RULE_NAMES.unknownAnimations,
  [LINT_CODES.duplicateSelectors]: LINT_RULE_NAMES.duplicateSelectors,
  [LINT_CODES.unknownUnits]: LINT_RULE_NAMES.unknownUnits,
  [LINT_CODES.unknownFunctions]: LINT_RULE_NAMES.unknownFunctions,
  [LINT_CODES.linearGradientNonstandardDirection]: LINT_RULE_NAMES.linearGradientNonstandardDirection,
  [LINT_CODES.unknownMediaFeatureNames]: LINT_RULE_NAMES.unknownMediaFeatureNames,
  [LINT_CODES.unknownMediaFeatureValues]: LINT_RULE_NAMES.unknownMediaFeatureValues,
  [LINT_CODES.unknownPseudoClasses]: LINT_RULE_NAMES.unknownPseudoClasses,
  [LINT_CODES.unknownPseudoElements]: LINT_RULE_NAMES.unknownPseudoElements,
  [LINT_CODES.unmatchableAnbSelectors]: LINT_RULE_NAMES.unmatchableAnbSelectors,
  [LINT_CODES.unknownTypeSelectors]: LINT_RULE_NAMES.unknownTypeSelectors,
  [LINT_CODES.incompatibleMathFunctionUnits]: LINT_RULE_NAMES.incompatibleMathFunctionUnits,
  [LINT_CODES.invalidColorFunctionChannels]: LINT_RULE_NAMES.invalidColorFunctionChannels,
  [LINT_CODES.invalidTypedCustomPropertyValue]: LINT_RULE_NAMES.invalidTypedCustomPropertyValue,
  [LINT_CODES.unsupportedSassForm]: LINT_RULE_NAMES.unsupportedSassForm
};

const RECOMMENDED_RULES: Record<LintRuleName, LintRuleSetting> = {
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.unknownPropertyValues]: 'warn',
  [LINT_RULE_NAMES.unknownAtRules]: 'warn',
  [LINT_RULE_NAMES.unknownAtRuleDescriptors]: 'warn',
  [LINT_RULE_NAMES.unknownAtRuleDescriptorValues]: 'warn',
  [LINT_RULE_NAMES.duplicateProperties]: 'warn',
  [LINT_RULE_NAMES.shorthandPropertyOverrides]: 'warn',
  [LINT_RULE_NAMES.duplicateCustomProperties]: 'warn',
  [LINT_RULE_NAMES.hexColorLength]: 'error',
  [LINT_RULE_NAMES.zeroUnits]: 'warn',
  [LINT_RULE_NAMES.customPropertyMissingVarFunction]: 'warn',
  [LINT_RULE_NAMES.unknownCustomProperties]: 'warn',
  [LINT_RULE_NAMES.keyframeDuplicateSelectors]: 'warn',
  [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: 'warn',
  [LINT_RULE_NAMES.declarationNoImportant]: 'warn',
  [LINT_RULE_NAMES.invalidNamedGridAreas]: 'warn',
  [LINT_RULE_NAMES.fontFamilyDuplicateNames]: 'warn',
  [LINT_RULE_NAMES.fontFamilyMissingGeneric]: 'warn',
  [LINT_RULE_NAMES.fontFaceMissingRequiredProperties]: 'warn',
  [LINT_RULE_NAMES.propertyIgnoredDueToDisplay]: 'warn',
  [LINT_RULE_NAMES.boxModel]: 'off',
  [LINT_RULE_NAMES.invalidImportPosition]: 'warn',
  [LINT_RULE_NAMES.duplicateAtImportRules]: 'warn',
  [LINT_RULE_NAMES.unknownAnimations]: 'warn',
  [LINT_RULE_NAMES.duplicateSelectors]: 'warn',
  [LINT_RULE_NAMES.unknownUnits]: 'warn',
  [LINT_RULE_NAMES.unknownFunctions]: 'warn',
  [LINT_RULE_NAMES.linearGradientNonstandardDirection]: 'warn',
  [LINT_RULE_NAMES.unknownMediaFeatureNames]: 'warn',
  [LINT_RULE_NAMES.unknownMediaFeatureValues]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoClasses]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoElements]: 'warn',
  [LINT_RULE_NAMES.unmatchableAnbSelectors]: 'warn',
  [LINT_RULE_NAMES.unknownTypeSelectors]: 'warn',
  [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: 'warn',
  [LINT_RULE_NAMES.invalidColorFunctionChannels]: 'error',
  [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: 'warn',
  [LINT_RULE_NAMES.unsupportedSassForm]: 'warn'
};

const COMPARISON_RULES: Record<string, LintRuleSetting> = {
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.unknownAtRules]: 'warn',
  [LINT_RULE_NAMES.unknownAtRuleDescriptors]: 'warn',
  [LINT_RULE_NAMES.duplicateProperties]: 'warn',
  [LINT_RULE_NAMES.shorthandPropertyOverrides]: 'warn',
  [LINT_RULE_NAMES.duplicateCustomProperties]: 'warn',
  [LINT_RULE_NAMES.hexColorLength]: 'error',
  [LINT_RULE_NAMES.zeroUnits]: 'warn',
  [LINT_RULE_NAMES.customPropertyMissingVarFunction]: 'warn',
  [LINT_RULE_NAMES.keyframeDuplicateSelectors]: 'warn',
  [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: 'warn',
  [LINT_RULE_NAMES.declarationNoImportant]: 'warn',
  [LINT_RULE_NAMES.invalidNamedGridAreas]: 'warn',
  [LINT_RULE_NAMES.fontFamilyDuplicateNames]: 'warn',
  [LINT_RULE_NAMES.fontFamilyMissingGeneric]: 'warn',
  [LINT_RULE_NAMES.invalidImportPosition]: 'warn',
  [LINT_RULE_NAMES.duplicateAtImportRules]: 'warn',
  [LINT_RULE_NAMES.unknownAnimations]: 'warn',
  [LINT_RULE_NAMES.unknownUnits]: 'warn',
  [LINT_RULE_NAMES.unknownFunctions]: 'warn',
  [LINT_RULE_NAMES.linearGradientNonstandardDirection]: 'warn',
  [LINT_RULE_NAMES.unknownMediaFeatureNames]: 'warn',
  [LINT_RULE_NAMES.unknownMediaFeatureValues]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoClasses]: 'warn',
  [LINT_RULE_NAMES.unknownPseudoElements]: 'warn',
  [LINT_RULE_NAMES.unmatchableAnbSelectors]: 'warn',
  [LINT_RULE_NAMES.unknownTypeSelectors]: 'warn'
};

const COMPARISON_DISABLED_RULES: Record<string, LintRuleSetting> = {
  [LINT_RULE_NAMES.duplicateSelectors]: 'off',
  [LINT_RULE_NAMES.unknownPropertyValues]: 'off',
  [LINT_RULE_NAMES.fontFaceMissingRequiredProperties]: 'off',
  [LINT_RULE_NAMES.propertyIgnoredDueToDisplay]: 'off',
  [LINT_RULE_NAMES.boxModel]: 'off',
  [LINT_RULE_NAMES.unknownAtRuleDescriptorValues]: 'off',
  [LINT_RULE_NAMES.unknownCustomProperties]: 'off',
  [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: 'off',
  [LINT_RULE_NAMES.invalidColorFunctionChannels]: 'off',
  [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: 'off',
  [LINT_RULE_NAMES.unsupportedSassForm]: 'off'
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
    code: LINT_CODES.unknownPropertyValues,
    ruleName: LINT_RULE_NAMES.unknownPropertyValues,
    title: 'Unknown property values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'declaration-property-value-no-unknown',
    notes: 'Flags definite unknown CSS enum keyword values from VSCode web custom data; dynamic values, non-enum value grammars, colors, and dialect values stay unknown until richer value facts exist.'
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
    code: LINT_CODES.unknownAtRuleDescriptors,
    ruleName: LINT_RULE_NAMES.unknownAtRuleDescriptors,
    title: 'Unknown at-rule descriptors',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-descriptor-no-unknown',
    notes: 'Flags unknown descriptors in parsed CSS descriptor blocks using shared CSS metadata, including CSS @page page-context and margin-box descriptors.'
  },
  {
    code: LINT_CODES.unknownAtRuleDescriptorValues,
    ruleName: LINT_RULE_NAMES.unknownAtRuleDescriptorValues,
    title: 'Unknown at-rule descriptor values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-descriptor-value-no-unknown',
    notes: 'Flags definite invalid CSS descriptor values in parsed descriptor blocks; the initial subset covers @property syntax/inherits and @font-face font-display while leaving dynamic or unsupported descriptor grammars unknown.'
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
    code: LINT_CODES.shorthandPropertyOverrides,
    ruleName: LINT_RULE_NAMES.shorthandPropertyOverrides,
    title: 'Shorthand property overrides',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'declaration-block-no-shorthand-property-overrides',
    notes: 'Flags common CSS shorthands that override earlier longhands in the same parsed block; the initial property table covers high-value shorthand families and can expand with metadata.'
  },
  {
    code: LINT_CODES.duplicateCustomProperties,
    ruleName: LINT_RULE_NAMES.duplicateCustomProperties,
    title: 'Duplicate custom properties',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'declaration-block-no-duplicate-custom-properties',
    notes: 'Flags duplicate custom property declarations in the same parsed block, using exact custom property names.'
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
    code: LINT_CODES.unknownCustomProperties,
    ruleName: LINT_RULE_NAMES.unknownCustomProperties,
    title: 'Unknown custom properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'no-unknown-custom-properties',
    notes: 'Flags var() references without a same-file custom property declaration or @property registration; project reference files and import graph facts remain future work.'
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
    code: LINT_CODES.declarationNoImportant,
    ruleName: LINT_RULE_NAMES.declarationNoImportant,
    title: 'Important declarations',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'declaration-no-important',
    notes: 'Flags CSS !important declarations outside @keyframes; keyframe declarations use the dedicated keyframe rule to avoid duplicate default diagnostics.'
  },
  {
    code: LINT_CODES.invalidNamedGridAreas,
    ruleName: LINT_RULE_NAMES.invalidNamedGridAreas,
    title: 'Invalid named grid areas',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'named-grid-areas-no-invalid',
    notes: 'Flags empty, ragged, or non-rectangular named grid area strings in CSS declarations; dialect value facts remain future work.'
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
    code: LINT_CODES.fontFaceMissingRequiredProperties,
    ruleName: LINT_RULE_NAMES.fontFaceMissingRequiredProperties,
    title: 'Missing @font-face required properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service fontFaceProperties: CSS @font-face blocks must define both font-family and src; dialect semantic facts remain future work.'
  },
  {
    code: LINT_CODES.propertyIgnoredDueToDisplay,
    ruleName: LINT_RULE_NAMES.propertyIgnoredDueToDisplay,
    title: 'Properties ignored by display',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service propertyIgnoredDueToDisplay for CSS display:inline-block with non-none float and display:block with vertical-align; dialect semantic facts remain future work.'
  },
  {
    code: LINT_CODES.boxModel,
    ruleName: LINT_RULE_NAMES.boxModel,
    title: 'Box model size risks',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service boxModel for definite CSS width/height with non-zero padding or border, suppressing blocks that declare box-sizing and leaving dynamic or dialect values unknown.'
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
    code: LINT_CODES.unknownAnimations,
    ruleName: LINT_RULE_NAMES.unknownAnimations,
    title: 'Unknown animations',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'no-unknown-animations',
    notes: 'Flags definite CSS animation names that do not have a same-file @keyframes definition; dynamic values and dialect animation facts remain future work.'
  },
  {
    code: LINT_CODES.duplicateSelectors,
    ruleName: LINT_RULE_NAMES.duplicateSelectors,
    title: 'Duplicate selectors',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'no-duplicate-selectors',
    notes: 'Flags duplicate CSS selector-list entries and duplicate selector lists among sibling rules; dialect nested selector resolution waits for selector facts.'
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
    code: LINT_CODES.linearGradientNonstandardDirection,
    ruleName: LINT_RULE_NAMES.linearGradientNonstandardDirection,
    title: 'Nonstandard linear-gradient directions',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'function-linear-gradient-no-nonstandard-direction',
    notes: 'Flags old side-or-corner direction syntax and unitless numeric directions in CSS linear-gradient() and repeating-linear-gradient() calls.'
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
    code: LINT_CODES.unknownMediaFeatureValues,
    ruleName: LINT_RULE_NAMES.unknownMediaFeatureValues,
    title: 'Unknown media feature values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'media-feature-name-value-no-unknown',
    notes: 'Flags definite invalid CSS @media feature values using Jess media metadata; dynamic values are left unknown.'
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
    code: LINT_CODES.unmatchableAnbSelectors,
    ruleName: LINT_RULE_NAMES.unmatchableAnbSelectors,
    title: 'Unmatchable An+B selectors',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'selector-anb-no-unmatchable',
    notes: 'Flags CSS nth-selector An+B expressions that can never match; dialect selector facts remain future work.'
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
    code: LINT_CODES.incompatibleMathFunctionUnits,
    ruleName: LINT_RULE_NAMES.incompatibleMathFunctionUnits,
    title: 'Incompatible math function units',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags definite CSS min()/max()/clamp() numeric-kind mismatches while leaving dynamic, percentage, and compound arguments unknown.'
  },
  {
    code: LINT_CODES.invalidColorFunctionChannels,
    ruleName: LINT_RULE_NAMES.invalidColorFunctionChannels,
    title: 'Invalid color function channels',
    tier: 'css-validity',
    defaultPolicy: 'error',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service argumentsInColorFunction for definite rgb()/rgba()/hsl()/hsla() channel arity/type errors while leaving dynamic and nested values unknown.'
  },
  {
    code: LINT_CODES.invalidTypedCustomPropertyValue,
    ruleName: LINT_RULE_NAMES.invalidTypedCustomPropertyValue,
    title: 'Invalid typed custom property values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags definite CSS @property initial-value descriptors that do not match simple syntax descriptors such as <length>, <integer>, or <color>; dynamic and unsupported syntax stays unknown.'
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
  rules: {
    ...COMPARISON_DISABLED_RULES,
    ...COMPARISON_RULES
  }
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
