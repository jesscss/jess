import { LINT_CODES } from '@jesscss/diagnostics-core';
import type { LintConfig, LintRuleSetting, LintSeverity } from 'styles-config';

export const PARSE_SYNTAX_ERROR_CODE = 'parse/syntax-error';
export const STABLE_LINT_RULE_SET_VERSION = 47;

export type LintRuleComparisonKind = 'stylelint-equivalent' | 'stylelint-near' | 'vscode-equivalent' | 'jess-only';
export type LintRuleTier = 'css-validity' | 'maintainability' | 'style-suggestion' | 'dialect-support';

export const LINT_RULE_NAMES = {
  emptyRules: 'block-no-empty',
  unknownProperties: 'property-no-unknown',
  deprecatedProperties: 'property-no-deprecated',
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
  float: 'float',
  propertyNoVendorPrefix: 'property-no-vendor-prefix',
  atRuleNoVendorPrefix: 'at-rule-no-vendor-prefix',
  vendorPrefix: 'vendor-prefix',
  compatibleVendorPrefixes: 'compatible-vendor-prefixes',
  unknownVendorSpecificProperties: 'unknown-vendor-specific-properties',
  importStatement: 'import-statement',
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
  selectorMaxId: 'selector-max-id',
  selectorMaxUniversal: 'selector-max-universal',
  incompatibleMathFunctionUnits: 'jess/no-incompatible-math-function-units',
  invalidColorFunctionChannels: 'color-function-no-invalid-arguments',
  invalidTypedCustomPropertyValue: 'jess/no-invalid-typed-custom-property-value',
  unusedVariables: 'jess/no-unused-variable',
  duplicateModuleLoads: 'jess/no-duplicate-module-load',
  unboundedExtends: 'jess/no-unbounded-extend',
  deadExtends: 'jess/no-dead-extend',
  suspiciousMapKeyAccess: 'jess/no-suspicious-map-key-access',
  unsupportedSassForm: 'jess/unsupported-sass-form'
} as const;

export type LintRuleName = typeof LINT_RULE_NAMES[keyof typeof LINT_RULE_NAMES];

export interface StableLintRule {
  readonly diagnosticCode: string;
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
  [LINT_RULE_NAMES.deprecatedProperties]: LINT_CODES.deprecatedProperties,
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
  [LINT_RULE_NAMES.float]: LINT_CODES.float,
  [LINT_RULE_NAMES.propertyNoVendorPrefix]: LINT_CODES.propertyNoVendorPrefix,
  [LINT_RULE_NAMES.atRuleNoVendorPrefix]: LINT_CODES.atRuleNoVendorPrefix,
  [LINT_RULE_NAMES.vendorPrefix]: LINT_CODES.vendorPrefix,
  [LINT_RULE_NAMES.compatibleVendorPrefixes]: LINT_CODES.compatibleVendorPrefixes,
  [LINT_RULE_NAMES.unknownVendorSpecificProperties]: LINT_CODES.unknownVendorSpecificProperties,
  [LINT_RULE_NAMES.importStatement]: LINT_CODES.importStatement,
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
  [LINT_RULE_NAMES.selectorMaxId]: LINT_CODES.selectorMaxId,
  [LINT_RULE_NAMES.selectorMaxUniversal]: LINT_CODES.selectorMaxUniversal,
  [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: LINT_CODES.incompatibleMathFunctionUnits,
  [LINT_RULE_NAMES.invalidColorFunctionChannels]: LINT_CODES.invalidColorFunctionChannels,
  [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: LINT_CODES.invalidTypedCustomPropertyValue,
  [LINT_RULE_NAMES.unusedVariables]: LINT_CODES.unusedVariables,
  [LINT_RULE_NAMES.duplicateModuleLoads]: LINT_CODES.duplicateModuleLoads,
  [LINT_RULE_NAMES.unboundedExtends]: LINT_CODES.unboundedExtends,
  [LINT_RULE_NAMES.deadExtends]: LINT_CODES.deadExtends,
  [LINT_RULE_NAMES.suspiciousMapKeyAccess]: LINT_CODES.suspiciousMapKeyAccess,
  [LINT_RULE_NAMES.unsupportedSassForm]: LINT_CODES.unsupportedSassForm
};

const RULE_BY_DIAGNOSTIC: Record<string, LintRuleName> = {
  [LINT_CODES.emptyRules]: LINT_RULE_NAMES.emptyRules,
  [LINT_CODES.unknownProperties]: LINT_RULE_NAMES.unknownProperties,
  [LINT_CODES.deprecatedProperties]: LINT_RULE_NAMES.deprecatedProperties,
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
  [LINT_CODES.float]: LINT_RULE_NAMES.float,
  [LINT_CODES.propertyNoVendorPrefix]: LINT_RULE_NAMES.propertyNoVendorPrefix,
  [LINT_CODES.atRuleNoVendorPrefix]: LINT_RULE_NAMES.atRuleNoVendorPrefix,
  [LINT_CODES.vendorPrefix]: LINT_RULE_NAMES.vendorPrefix,
  [LINT_CODES.compatibleVendorPrefixes]: LINT_RULE_NAMES.compatibleVendorPrefixes,
  [LINT_CODES.unknownVendorSpecificProperties]: LINT_RULE_NAMES.unknownVendorSpecificProperties,
  [LINT_CODES.importStatement]: LINT_RULE_NAMES.importStatement,
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
  [LINT_CODES.selectorMaxId]: LINT_RULE_NAMES.selectorMaxId,
  [LINT_CODES.selectorMaxUniversal]: LINT_RULE_NAMES.selectorMaxUniversal,
  [LINT_CODES.incompatibleMathFunctionUnits]: LINT_RULE_NAMES.incompatibleMathFunctionUnits,
  [LINT_CODES.invalidColorFunctionChannels]: LINT_RULE_NAMES.invalidColorFunctionChannels,
  [LINT_CODES.invalidTypedCustomPropertyValue]: LINT_RULE_NAMES.invalidTypedCustomPropertyValue,
  [LINT_CODES.unusedVariables]: LINT_RULE_NAMES.unusedVariables,
  [LINT_CODES.duplicateModuleLoads]: LINT_RULE_NAMES.duplicateModuleLoads,
  [LINT_CODES.unboundedExtends]: LINT_RULE_NAMES.unboundedExtends,
  [LINT_CODES.deadExtends]: LINT_RULE_NAMES.deadExtends,
  [LINT_CODES.suspiciousMapKeyAccess]: LINT_RULE_NAMES.suspiciousMapKeyAccess,
  [LINT_CODES.unsupportedSassForm]: LINT_RULE_NAMES.unsupportedSassForm
};

const RECOMMENDED_RULES: Record<LintRuleName, LintRuleSetting> = {
  [LINT_RULE_NAMES.emptyRules]: 'warn',
  [LINT_RULE_NAMES.unknownProperties]: 'warn',
  [LINT_RULE_NAMES.deprecatedProperties]: 'warn',
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
  [LINT_RULE_NAMES.float]: 'off',
  [LINT_RULE_NAMES.propertyNoVendorPrefix]: 'off',
  [LINT_RULE_NAMES.atRuleNoVendorPrefix]: 'off',
  [LINT_RULE_NAMES.vendorPrefix]: 'warn',
  [LINT_RULE_NAMES.compatibleVendorPrefixes]: 'off',
  [LINT_RULE_NAMES.unknownVendorSpecificProperties]: 'off',
  [LINT_RULE_NAMES.importStatement]: 'off',
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
  [LINT_RULE_NAMES.selectorMaxId]: 'off',
  [LINT_RULE_NAMES.selectorMaxUniversal]: 'off',
  [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: 'warn',
  [LINT_RULE_NAMES.invalidColorFunctionChannels]: 'error',
  [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: 'warn',
  [LINT_RULE_NAMES.unusedVariables]: 'off',
  [LINT_RULE_NAMES.duplicateModuleLoads]: 'warn',
  [LINT_RULE_NAMES.unboundedExtends]: 'warn',
  [LINT_RULE_NAMES.deadExtends]: 'warn',
  [LINT_RULE_NAMES.suspiciousMapKeyAccess]: 'warn',
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
  [LINT_RULE_NAMES.deprecatedProperties]: 'off',
  [LINT_RULE_NAMES.unknownPropertyValues]: 'off',
  [LINT_RULE_NAMES.fontFaceMissingRequiredProperties]: 'off',
  [LINT_RULE_NAMES.propertyIgnoredDueToDisplay]: 'off',
  [LINT_RULE_NAMES.boxModel]: 'off',
  [LINT_RULE_NAMES.float]: 'off',
  [LINT_RULE_NAMES.propertyNoVendorPrefix]: 'off',
  [LINT_RULE_NAMES.atRuleNoVendorPrefix]: 'off',
  [LINT_RULE_NAMES.vendorPrefix]: 'off',
  [LINT_RULE_NAMES.compatibleVendorPrefixes]: 'off',
  [LINT_RULE_NAMES.unknownVendorSpecificProperties]: 'off',
  [LINT_RULE_NAMES.importStatement]: 'off',
  [LINT_RULE_NAMES.unknownAtRuleDescriptorValues]: 'off',
  [LINT_RULE_NAMES.unknownCustomProperties]: 'off',
  [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: 'off',
  [LINT_RULE_NAMES.invalidColorFunctionChannels]: 'off',
  [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: 'off',
  [LINT_RULE_NAMES.selectorMaxId]: 'off',
  [LINT_RULE_NAMES.selectorMaxUniversal]: 'off',
  [LINT_RULE_NAMES.unusedVariables]: 'off',
  [LINT_RULE_NAMES.duplicateModuleLoads]: 'off',
  [LINT_RULE_NAMES.unboundedExtends]: 'off',
  [LINT_RULE_NAMES.deadExtends]: 'off',
  [LINT_RULE_NAMES.suspiciousMapKeyAccess]: 'off',
  [LINT_RULE_NAMES.unsupportedSassForm]: 'off'
};

export const STABLE_LINT_RULES: readonly StableLintRule[] = [
  {
    diagnosticCode: LINT_CODES.emptyRules,
    ruleName: LINT_RULE_NAMES.emptyRules,
    title: 'Empty rules',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'block-no-empty',
    notes: 'Flags empty qualified rules after Jess dialect parsing; supports opt-in include: ["mixins"] for empty Less/SCSS/Jess mixin bodies.'
  },
  {
    diagnosticCode: LINT_CODES.unknownProperties,
    ruleName: LINT_RULE_NAMES.unknownProperties,
    title: 'Unknown properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'property-no-unknown',
    notes: 'Uses Jess language metadata and suppresses dialect variables, custom properties, vendor-prefixed properties, and interpolated names.'
  },
  {
    diagnosticCode: LINT_CODES.deprecatedProperties,
    ruleName: LINT_RULE_NAMES.deprecatedProperties,
    title: 'Deprecated properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'property-no-deprecated',
    notes: 'Flags CSS properties marked obsolete or deprecated in VSCode web custom data; nonstandard and vendor-prefixed properties are not treated as deprecated.'
  },
  {
    diagnosticCode: LINT_CODES.unknownPropertyValues,
    ruleName: LINT_RULE_NAMES.unknownPropertyValues,
    title: 'Unknown property values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'declaration-property-value-no-unknown',
    notes: 'Flags definite unknown simple CSS property values from VSCode web custom data values and restrictions; compound, dynamic, and dialect values stay unknown until richer value facts exist.'
  },
  {
    diagnosticCode: LINT_CODES.unknownAtRules,
    ruleName: LINT_RULE_NAMES.unknownAtRules,
    title: 'Unknown at-rules',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-no-unknown',
    notes: 'Uses Jess language metadata plus dialect at-rule allow-lists.'
  },
  {
    diagnosticCode: LINT_CODES.unknownAtRuleDescriptors,
    ruleName: LINT_RULE_NAMES.unknownAtRuleDescriptors,
    title: 'Unknown at-rule descriptors',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-descriptor-no-unknown',
    notes: 'Flags unknown descriptors in parsed CSS descriptor blocks using shared CSS metadata, including CSS @page page-context and margin-box descriptors.'
  },
  {
    diagnosticCode: LINT_CODES.unknownAtRuleDescriptorValues,
    ruleName: LINT_RULE_NAMES.unknownAtRuleDescriptorValues,
    title: 'Unknown at-rule descriptor values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-descriptor-value-no-unknown',
    notes: 'Flags definite invalid CSS descriptor values in parsed descriptor blocks; the initial subset covers @property syntax/inherits and @font-face font-display while leaving dynamic or unsupported descriptor grammars unknown.'
  },
  {
    diagnosticCode: LINT_CODES.duplicateProperties,
    ruleName: LINT_RULE_NAMES.duplicateProperties,
    title: 'Duplicate properties',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'declaration-block-no-duplicate-properties',
    notes: 'Flags duplicate declaration names in the same parsed block; supports Stylelint-compatible ignore: ["consecutive-duplicates"] filtering through lint policy.'
  },
  {
    diagnosticCode: LINT_CODES.shorthandPropertyOverrides,
    ruleName: LINT_RULE_NAMES.shorthandPropertyOverrides,
    title: 'Shorthand property overrides',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'declaration-block-no-shorthand-property-overrides',
    notes: 'Flags common CSS shorthands that override earlier longhands in the same parsed block; the static table covers physical, logical, layout, text, transition, animation, border, and font shorthand families.'
  },
  {
    diagnosticCode: LINT_CODES.duplicateCustomProperties,
    ruleName: LINT_RULE_NAMES.duplicateCustomProperties,
    title: 'Duplicate custom properties',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'declaration-block-no-duplicate-custom-properties',
    notes: 'Flags duplicate custom property declarations in the same parsed block, using exact custom property names.'
  },
  {
    diagnosticCode: LINT_CODES.hexColorLength,
    ruleName: LINT_RULE_NAMES.hexColorLength,
    title: 'Invalid hex colors',
    tier: 'css-validity',
    defaultPolicy: 'error',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'color-no-invalid-hex',
    notes: 'Flags hex color literals whose digit count is not valid CSS.'
  },
  {
    diagnosticCode: LINT_CODES.zeroUnits,
    ruleName: LINT_RULE_NAMES.zeroUnits,
    title: 'Zero length units',
    tier: 'style-suggestion',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'length-zero-no-unit',
    notes: 'Flags zero values with length units; non-length units such as percentages and time are left alone.'
  },
  {
    diagnosticCode: LINT_CODES.customPropertyMissingVarFunction,
    ruleName: LINT_RULE_NAMES.customPropertyMissingVarFunction,
    title: 'Bare custom property references',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'custom-property-no-missing-var-function',
    notes: 'Flags custom property names used as ordinary values without wrapping them in var(...).'
  },
  {
    diagnosticCode: LINT_CODES.unknownCustomProperties,
    ruleName: LINT_RULE_NAMES.unknownCustomProperties,
    title: 'Unknown custom properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'no-unknown-custom-properties',
    notes: 'Flags var() references without a same-file custom property declaration or @property registration; project reference files and import graph facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.keyframeDuplicateSelectors,
    ruleName: LINT_RULE_NAMES.keyframeDuplicateSelectors,
    title: 'Duplicate keyframe selectors',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'keyframe-block-no-duplicate-selectors',
    notes: 'Flags duplicate selectors in one @keyframes block, normalizing from/to to 0%/100%.'
  },
  {
    diagnosticCode: LINT_CODES.keyframeDeclarationNoImportant,
    ruleName: LINT_RULE_NAMES.keyframeDeclarationNoImportant,
    title: 'Important keyframe declarations',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'keyframe-declaration-no-important',
    notes: 'Flags !important declarations inside @keyframes blocks.'
  },
  {
    diagnosticCode: LINT_CODES.declarationNoImportant,
    ruleName: LINT_RULE_NAMES.declarationNoImportant,
    title: 'Important declarations',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'declaration-no-important',
    notes: 'Flags CSS !important declarations outside @keyframes; keyframe declarations use the dedicated keyframe rule to avoid duplicate default diagnostics.'
  },
  {
    diagnosticCode: LINT_CODES.invalidNamedGridAreas,
    ruleName: LINT_RULE_NAMES.invalidNamedGridAreas,
    title: 'Invalid named grid areas',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'named-grid-areas-no-invalid',
    notes: 'Flags empty, ragged, or non-rectangular named grid area strings in CSS declarations; dialect value facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.fontFamilyDuplicateNames,
    ruleName: LINT_RULE_NAMES.fontFamilyDuplicateNames,
    title: 'Duplicate font family names',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'font-family-no-duplicate-names',
    notes: 'Flags duplicate names in font-family declarations while leaving dynamic values alone.'
  },
  {
    diagnosticCode: LINT_CODES.fontFamilyMissingGeneric,
    ruleName: LINT_RULE_NAMES.fontFamilyMissingGeneric,
    title: 'Missing generic font family',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'font-family-no-missing-generic-family-keyword',
    notes: 'Flags definite font-family declarations that omit a generic family keyword.'
  },
  {
    diagnosticCode: LINT_CODES.fontFaceMissingRequiredProperties,
    ruleName: LINT_RULE_NAMES.fontFaceMissingRequiredProperties,
    title: 'Missing @font-face required properties',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service fontFaceProperties: CSS @font-face blocks must define both font-family and src; dialect semantic facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.propertyIgnoredDueToDisplay,
    ruleName: LINT_RULE_NAMES.propertyIgnoredDueToDisplay,
    title: 'Properties ignored by display',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service propertyIgnoredDueToDisplay for CSS display:inline-block with non-none float and display:block with vertical-align; dialect semantic facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.boxModel,
    ruleName: LINT_RULE_NAMES.boxModel,
    title: 'Box model size risks',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service boxModel for definite CSS width/height with non-zero padding or border, suppressing blocks that declare box-sizing and leaving dynamic or dialect values unknown.'
  },
  {
    diagnosticCode: LINT_CODES.float,
    ruleName: LINT_RULE_NAMES.float,
    title: 'Float layout',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service float for definite CSS float declarations whose value is not none; dynamic or dialect values stay unknown until semantic facts exist.'
  },
  {
    diagnosticCode: LINT_CODES.propertyNoVendorPrefix,
    ruleName: LINT_RULE_NAMES.propertyNoVendorPrefix,
    title: 'Vendor-prefixed properties',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'stylelint-near',
    stylelintRule: 'property-no-vendor-prefix',
    notes: 'Opt-in Stylelint migration rule that flags authored CSS vendor-prefixed property names; the recommended vendor-prefix rule remains focused on missing standard counterparts.'
  },
  {
    diagnosticCode: LINT_CODES.atRuleNoVendorPrefix,
    ruleName: LINT_RULE_NAMES.atRuleNoVendorPrefix,
    title: 'Vendor-prefixed at-rules',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'stylelint-near',
    stylelintRule: 'at-rule-no-vendor-prefix',
    notes: 'Opt-in Stylelint migration rule that flags authored CSS vendor-prefixed keyframe at-rules; broader vendor at-rule facts can be added as metadata grows.'
  },
  {
    diagnosticCode: LINT_CODES.vendorPrefix,
    ruleName: LINT_RULE_NAMES.vendorPrefix,
    title: 'Vendor prefixes',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service vendorPrefix for CSS vendor-prefixed declarations and keyframe at-rules whose standard form is missing; dialect semantic facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.compatibleVendorPrefixes,
    ruleName: LINT_RULE_NAMES.compatibleVendorPrefixes,
    title: 'Compatible vendor prefixes',
    tier: 'css-validity',
    defaultPolicy: 'off',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service compatibleVendorPrefixes for CSS declarations and keyframe at-rules that use one known vendor-prefixed form but omit other known vendor-prefixed siblings.'
  },
  {
    diagnosticCode: LINT_CODES.unknownVendorSpecificProperties,
    ruleName: LINT_RULE_NAMES.unknownVendorSpecificProperties,
    title: 'Unknown vendor-specific properties',
    tier: 'css-validity',
    defaultPolicy: 'off',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service unknownVendorSpecificProperties for CSS declarations whose single-hyphen prefixed property name is not known; opt-in to match VSCode defaults.'
  },
  {
    diagnosticCode: LINT_CODES.importStatement,
    ruleName: LINT_RULE_NAMES.importStatement,
    title: '@import statements',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'vscode-equivalent',
    notes: 'Opt-in VSCode stylesheet-service importStatement parity for CSS @import rules that may block parallel stylesheet loading.'
  },
  {
    diagnosticCode: LINT_CODES.invalidImportPosition,
    ruleName: LINT_RULE_NAMES.invalidImportPosition,
    title: 'Invalid @import positions',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'no-invalid-position-at-import-rule',
    notes: 'Flags CSS @import rules that appear after style rules or blocking at-rules; @charset and statement @layer do not block imports.'
  },
  {
    diagnosticCode: LINT_CODES.duplicateAtImportRules,
    ruleName: LINT_RULE_NAMES.duplicateAtImportRules,
    title: 'Duplicate @import rules',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'no-duplicate-at-import-rules',
    notes: 'Flags repeated @import targets with the same authored options and conditions in one file.'
  },
  {
    diagnosticCode: LINT_CODES.unknownAnimations,
    ruleName: LINT_RULE_NAMES.unknownAnimations,
    title: 'Unknown animations',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'no-unknown-animations',
    notes: 'Flags definite CSS animation names that do not have a same-file @keyframes definition; dynamic values and dialect animation facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.duplicateSelectors,
    ruleName: LINT_RULE_NAMES.duplicateSelectors,
    title: 'Duplicate selectors',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'no-duplicate-selectors',
    notes: 'Flags duplicate CSS selector-list entries and duplicate selector lists among sibling rules; dialect nested selector resolution waits for selector facts.'
  },
  {
    diagnosticCode: LINT_CODES.unknownUnits,
    ruleName: LINT_RULE_NAMES.unknownUnits,
    title: 'Unknown units',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'unit-no-unknown',
    notes: 'Flags unknown CSS units from parsed Dimension nodes, suppressing url() values and allowing resolution x where CSS permits it.'
  },
  {
    diagnosticCode: LINT_CODES.unknownFunctions,
    ruleName: LINT_RULE_NAMES.unknownFunctions,
    title: 'Unknown functions',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'function-no-unknown',
    notes: 'Flags unknown CSS declaration functions using css-functions-list; dialect callable checks wait for semantic facts.'
  },
  {
    diagnosticCode: LINT_CODES.linearGradientNonstandardDirection,
    ruleName: LINT_RULE_NAMES.linearGradientNonstandardDirection,
    title: 'Nonstandard linear-gradient directions',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'function-linear-gradient-no-nonstandard-direction',
    notes: 'Flags old side-or-corner direction syntax and unitless numeric directions in CSS linear-gradient() and repeating-linear-gradient() calls.'
  },
  {
    diagnosticCode: LINT_CODES.unknownMediaFeatureNames,
    ruleName: LINT_RULE_NAMES.unknownMediaFeatureNames,
    title: 'Unknown media feature names',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'media-feature-name-no-unknown',
    notes: 'Flags unknown CSS @media feature names; skips custom media and vendor-prefixed features.'
  },
  {
    diagnosticCode: LINT_CODES.unknownMediaFeatureValues,
    ruleName: LINT_RULE_NAMES.unknownMediaFeatureValues,
    title: 'Unknown media feature values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'media-feature-name-value-no-unknown',
    notes: 'Flags definite invalid CSS @media feature values using Jess media metadata; dynamic values are left unknown.'
  },
  {
    diagnosticCode: LINT_CODES.unknownPseudoClasses,
    ruleName: LINT_RULE_NAMES.unknownPseudoClasses,
    title: 'Unknown pseudo-classes',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-pseudo-class-no-unknown',
    notes: 'Flags unknown pseudo-class selectors using CSS metadata while suppressing custom, vendor, and dialect pseudo-classes.'
  },
  {
    diagnosticCode: LINT_CODES.unknownPseudoElements,
    ruleName: LINT_RULE_NAMES.unknownPseudoElements,
    title: 'Unknown pseudo-elements',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-pseudo-element-no-unknown',
    notes: 'Flags unknown pseudo-element selectors using CSS metadata while suppressing vendor pseudo-elements.'
  },
  {
    diagnosticCode: LINT_CODES.unmatchableAnbSelectors,
    ruleName: LINT_RULE_NAMES.unmatchableAnbSelectors,
    title: 'Unmatchable An+B selectors',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-equivalent',
    stylelintRule: 'selector-anb-no-unmatchable',
    notes: 'Flags CSS nth-selector An+B expressions that can never match; dialect selector facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.unknownTypeSelectors,
    ruleName: LINT_RULE_NAMES.unknownTypeSelectors,
    title: 'Unknown type selectors',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-type-no-unknown',
    notes: 'Flags unknown CSS type selectors using HTML, SVG, and MathML metadata; custom elements and dialect selectors are intentionally skipped.'
  },
  {
    diagnosticCode: LINT_CODES.selectorMaxId,
    ruleName: LINT_RULE_NAMES.selectorMaxId,
    title: 'ID selectors',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-max-id',
    notes: 'Opt-in VSCode idSelector parity surfaced under the Stylelint selector-max-id name; the initial subset reports any static CSS ID selector as max-0.'
  },
  {
    diagnosticCode: LINT_CODES.selectorMaxUniversal,
    ruleName: LINT_RULE_NAMES.selectorMaxUniversal,
    title: 'Universal selectors',
    tier: 'style-suggestion',
    defaultPolicy: 'off',
    comparison: 'stylelint-near',
    stylelintRule: 'selector-max-universal',
    notes: 'Opt-in VSCode universalSelector parity surfaced under the Stylelint selector-max-universal name; the initial subset reports any static CSS universal selector as max-0.'
  },
  {
    diagnosticCode: LINT_CODES.incompatibleMathFunctionUnits,
    ruleName: LINT_RULE_NAMES.incompatibleMathFunctionUnits,
    title: 'Incompatible math function units',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags definite CSS min()/max()/clamp() numeric-kind mismatches while leaving dynamic, percentage, and compound arguments unknown.'
  },
  {
    diagnosticCode: LINT_CODES.invalidColorFunctionChannels,
    ruleName: LINT_RULE_NAMES.invalidColorFunctionChannels,
    title: 'Invalid color function channels',
    tier: 'css-validity',
    defaultPolicy: 'error',
    comparison: 'vscode-equivalent',
    notes: 'Matches VSCode stylesheet-service argumentsInColorFunction for definite rgb()/rgba()/hsl()/hsla() channel arity/type errors while leaving dynamic and nested values unknown.'
  },
  {
    diagnosticCode: LINT_CODES.invalidTypedCustomPropertyValue,
    ruleName: LINT_RULE_NAMES.invalidTypedCustomPropertyValue,
    title: 'Invalid typed custom property values',
    tier: 'css-validity',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags definite CSS @property initial-value descriptors that do not match simple syntax descriptors such as <length>, <integer>, or <color>; dynamic and unsupported syntax stays unknown.'
  },
  {
    diagnosticCode: LINT_CODES.unusedVariables,
    ruleName: LINT_RULE_NAMES.unusedVariables,
    title: 'Unused variables',
    tier: 'maintainability',
    defaultPolicy: 'off',
    comparison: 'jess-only',
    notes: 'Opt-in same-file dialect diagnostic for Less, SCSS, and Jess variables that are declared but never referenced in the parsed file; import/export-aware symbol facts remain future work.'
  },
  {
    diagnosticCode: LINT_CODES.duplicateModuleLoads,
    ruleName: LINT_RULE_NAMES.duplicateModuleLoads,
    title: 'Duplicate module loads',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags repeated same-file static SCSS/Jess module-load directives with the same target and authored options; import graph aliasing remains future semantic-facts work.'
  },
  {
    diagnosticCode: LINT_CODES.unboundedExtends,
    ruleName: LINT_RULE_NAMES.unboundedExtends,
    title: 'Unbounded extends',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags static Less/SCSS/Jess extend targets that have no top-level class, id, placeholder, or parent selector anchor; selector graph reachability remains future work.'
  },
  {
    diagnosticCode: LINT_CODES.deadExtends,
    ruleName: LINT_RULE_NAMES.deadExtends,
    title: 'Dead extends',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags exact static Less/SCSS/Jess extend targets that match no same-file selector when the file has no imports or module loads; import graph reachability remains future work.'
  },
  {
    diagnosticCode: LINT_CODES.suspiciousMapKeyAccess,
    ruleName: LINT_RULE_NAMES.suspiciousMapKeyAccess,
    title: 'Suspicious map key access',
    tier: 'maintainability',
    defaultPolicy: 'warn',
    comparison: 'jess-only',
    notes: 'Flags numeric bracket or map-get() access against same-file map-like Less, SCSS, and Jess variables; project value facts can later replace the same-file approximation.'
  },
  {
    diagnosticCode: LINT_CODES.unsupportedSassForm,
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
  for (const [ruleName, setting] of Object.entries(rules)) {
    const severity = Array.isArray(setting) ? setting[0] : setting;
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
