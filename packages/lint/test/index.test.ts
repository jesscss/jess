import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINT_CODES } from '@jesscss/diagnostics-core';
import {
  LINT_RULE_NAMES,
  PARSE_SYNTAX_ERROR_CODE,
  STABLE_LINT_RULES,
  STABLE_LINT_RULE_SET_VERSION,
  STYLELINT_COMPARISON_LINT_CONFIG,
  formatStyledLintResult,
  lintFiles,
  lintText,
  recommendedLintRules,
  stylelintComparisonRules
} from '../src/index.js';

describe('stable rule set', () => {
  it('pins the recommended rule policy by public rule name', () => {
    const recommended = recommendedLintRules();

    expect(STABLE_LINT_RULES.map(rule => rule.diagnosticCode)).toEqual([
      LINT_CODES.emptyRules,
      LINT_CODES.unknownProperties,
      LINT_CODES.deprecatedProperties,
      LINT_CODES.unknownPropertyValues,
      LINT_CODES.unknownAtRules,
      LINT_CODES.unknownAtRuleDescriptors,
      LINT_CODES.unknownAtRuleDescriptorValues,
      LINT_CODES.duplicateProperties,
      LINT_CODES.shorthandPropertyOverrides,
      LINT_CODES.duplicateCustomProperties,
      LINT_CODES.hexColorLength,
      LINT_CODES.zeroUnits,
      LINT_CODES.customPropertyMissingVarFunction,
      LINT_CODES.unknownCustomProperties,
      LINT_CODES.customPropertyPattern,
      LINT_CODES.keyframeDuplicateSelectors,
      LINT_CODES.keyframeDeclarationNoImportant,
      LINT_CODES.keyframesNamePattern,
      LINT_CODES.declarationNoImportant,
      LINT_CODES.invalidNamedGridAreas,
      LINT_CODES.fontFamilyDuplicateNames,
      LINT_CODES.fontFamilyMissingGeneric,
      LINT_CODES.fontFaceMissingRequiredProperties,
      LINT_CODES.propertyIgnoredDueToDisplay,
      LINT_CODES.boxModel,
      LINT_CODES.float,
      LINT_CODES.propertyNoVendorPrefix,
      LINT_CODES.atRuleNoVendorPrefix,
      LINT_CODES.vendorPrefix,
      LINT_CODES.compatibleVendorPrefixes,
      LINT_CODES.unknownVendorSpecificProperties,
      LINT_CODES.importStatement,
      LINT_CODES.invalidImportPosition,
      LINT_CODES.duplicateAtImportRules,
      LINT_CODES.unknownAnimations,
      LINT_CODES.duplicateSelectors,
      LINT_CODES.unknownUnits,
      LINT_CODES.unknownFunctions,
      LINT_CODES.linearGradientNonstandardDirection,
      LINT_CODES.colorFunctionNotation,
      LINT_CODES.alphaValueNotation,
      LINT_CODES.hueDegreeNotation,
      LINT_CODES.unknownMediaFeatureNames,
      LINT_CODES.mediaFeatureNameNoVendorPrefix,
      LINT_CODES.unknownMediaFeatureValues,
      LINT_CODES.unknownPseudoClasses,
      LINT_CODES.unknownPseudoElements,
      LINT_CODES.selectorNoVendorPrefix,
      LINT_CODES.selectorClassPattern,
      LINT_CODES.unmatchableAnbSelectors,
      LINT_CODES.unknownTypeSelectors,
      LINT_CODES.selectorMaxId,
      LINT_CODES.selectorMaxUniversal,
      LINT_CODES.incompatibleMathFunctionUnits,
      LINT_CODES.invalidColorFunctionChannels,
      LINT_CODES.invalidTypedCustomPropertyValue,
      LINT_CODES.shadowedTokens,
      LINT_CODES.unusedVariables,
      LINT_CODES.duplicateModuleLoads,
      LINT_CODES.unboundedExtends,
      LINT_CODES.deadExtends,
      LINT_CODES.suspiciousMapKeyAccess,
      LINT_CODES.unsupportedSassForm
    ]);
    expect(STABLE_LINT_RULES.map(rule => rule.ruleName)).toEqual([
      LINT_RULE_NAMES.emptyRules,
      LINT_RULE_NAMES.unknownProperties,
      LINT_RULE_NAMES.deprecatedProperties,
      LINT_RULE_NAMES.unknownPropertyValues,
      LINT_RULE_NAMES.unknownAtRules,
      LINT_RULE_NAMES.unknownAtRuleDescriptors,
      LINT_RULE_NAMES.unknownAtRuleDescriptorValues,
      LINT_RULE_NAMES.duplicateProperties,
      LINT_RULE_NAMES.shorthandPropertyOverrides,
      LINT_RULE_NAMES.duplicateCustomProperties,
      LINT_RULE_NAMES.hexColorLength,
      LINT_RULE_NAMES.zeroUnits,
      LINT_RULE_NAMES.customPropertyMissingVarFunction,
      LINT_RULE_NAMES.unknownCustomProperties,
      LINT_RULE_NAMES.customPropertyPattern,
      LINT_RULE_NAMES.keyframeDuplicateSelectors,
      LINT_RULE_NAMES.keyframeDeclarationNoImportant,
      LINT_RULE_NAMES.keyframesNamePattern,
      LINT_RULE_NAMES.declarationNoImportant,
      LINT_RULE_NAMES.invalidNamedGridAreas,
      LINT_RULE_NAMES.fontFamilyDuplicateNames,
      LINT_RULE_NAMES.fontFamilyMissingGeneric,
      LINT_RULE_NAMES.fontFaceMissingRequiredProperties,
      LINT_RULE_NAMES.propertyIgnoredDueToDisplay,
      LINT_RULE_NAMES.boxModel,
      LINT_RULE_NAMES.float,
      LINT_RULE_NAMES.propertyNoVendorPrefix,
      LINT_RULE_NAMES.atRuleNoVendorPrefix,
      LINT_RULE_NAMES.vendorPrefix,
      LINT_RULE_NAMES.compatibleVendorPrefixes,
      LINT_RULE_NAMES.unknownVendorSpecificProperties,
      LINT_RULE_NAMES.importStatement,
      LINT_RULE_NAMES.invalidImportPosition,
      LINT_RULE_NAMES.duplicateAtImportRules,
      LINT_RULE_NAMES.unknownAnimations,
      LINT_RULE_NAMES.duplicateSelectors,
      LINT_RULE_NAMES.unknownUnits,
      LINT_RULE_NAMES.unknownFunctions,
      LINT_RULE_NAMES.linearGradientNonstandardDirection,
      LINT_RULE_NAMES.colorFunctionNotation,
      LINT_RULE_NAMES.alphaValueNotation,
      LINT_RULE_NAMES.hueDegreeNotation,
      LINT_RULE_NAMES.unknownMediaFeatureNames,
      LINT_RULE_NAMES.mediaFeatureNameNoVendorPrefix,
      LINT_RULE_NAMES.unknownMediaFeatureValues,
      LINT_RULE_NAMES.unknownPseudoClasses,
      LINT_RULE_NAMES.unknownPseudoElements,
      LINT_RULE_NAMES.selectorNoVendorPrefix,
      LINT_RULE_NAMES.selectorClassPattern,
      LINT_RULE_NAMES.unmatchableAnbSelectors,
      LINT_RULE_NAMES.unknownTypeSelectors,
      LINT_RULE_NAMES.selectorMaxId,
      LINT_RULE_NAMES.selectorMaxUniversal,
      LINT_RULE_NAMES.incompatibleMathFunctionUnits,
      LINT_RULE_NAMES.invalidColorFunctionChannels,
      LINT_RULE_NAMES.invalidTypedCustomPropertyValue,
      LINT_RULE_NAMES.shadowedTokens,
      LINT_RULE_NAMES.unusedVariables,
      LINT_RULE_NAMES.duplicateModuleLoads,
      LINT_RULE_NAMES.unboundedExtends,
      LINT_RULE_NAMES.deadExtends,
      LINT_RULE_NAMES.suspiciousMapKeyAccess,
      LINT_RULE_NAMES.unsupportedSassForm
    ]);
    expect(STABLE_LINT_RULE_SET_VERSION).toBe(51);
    expect(recommended[LINT_RULE_NAMES.hexColorLength]).toBe('error');
    expect(recommended[LINT_RULE_NAMES.invalidColorFunctionChannels]).toBe('error');
    expect(recommended[LINT_RULE_NAMES.zeroUnits]).toBe('warn');
    expect(recommended[LINT_RULE_NAMES.vendorPrefix]).toBe('warn');
    expect(recommended[LINT_RULE_NAMES.boxModel]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.float]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.propertyNoVendorPrefix]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.atRuleNoVendorPrefix]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.compatibleVendorPrefixes]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.unknownVendorSpecificProperties]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.importStatement]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.selectorMaxId]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.selectorMaxUniversal]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.mediaFeatureNameNoVendorPrefix]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.selectorNoVendorPrefix]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.selectorClassPattern]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.customPropertyPattern]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.keyframesNamePattern]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.colorFunctionNotation]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.alphaValueNotation]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.hueDegreeNotation]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.shadowedTokens]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.unusedVariables]).toBe('off');
    expect(recommended[LINT_RULE_NAMES.duplicateModuleLoads]).toBe('warn');
    expect(recommended[LINT_RULE_NAMES.unboundedExtends]).toBe('warn');
    expect(recommended[LINT_RULE_NAMES.deadExtends]).toBe('warn');
    expect(recommended[LINT_RULE_NAMES.suspiciousMapKeyAccess]).toBe('warn');
  });

  it('keeps the Stylelint comparison policy limited to comparable rules', () => {
    const comparison = stylelintComparisonRules();

    expect(Object.keys(comparison).sort()).toEqual([
      LINT_RULE_NAMES.duplicateProperties,
      LINT_RULE_NAMES.duplicateCustomProperties,
      LINT_RULE_NAMES.emptyRules,
      LINT_RULE_NAMES.hexColorLength,
      LINT_RULE_NAMES.customPropertyMissingVarFunction,
      LINT_RULE_NAMES.invalidImportPosition,
      LINT_RULE_NAMES.shorthandPropertyOverrides,
      LINT_RULE_NAMES.fontFamilyDuplicateNames,
      LINT_RULE_NAMES.fontFamilyMissingGeneric,
      LINT_RULE_NAMES.duplicateAtImportRules,
      LINT_RULE_NAMES.unknownAnimations,
      LINT_RULE_NAMES.unknownUnits,
      LINT_RULE_NAMES.unknownFunctions,
      LINT_RULE_NAMES.linearGradientNonstandardDirection,
      LINT_RULE_NAMES.unknownMediaFeatureNames,
      LINT_RULE_NAMES.unknownMediaFeatureValues,
      LINT_RULE_NAMES.unknownPseudoClasses,
      LINT_RULE_NAMES.unknownPseudoElements,
      LINT_RULE_NAMES.unmatchableAnbSelectors,
      LINT_RULE_NAMES.unknownTypeSelectors,
      LINT_RULE_NAMES.keyframeDeclarationNoImportant,
      LINT_RULE_NAMES.keyframeDuplicateSelectors,
      LINT_RULE_NAMES.declarationNoImportant,
      LINT_RULE_NAMES.invalidNamedGridAreas,
      LINT_RULE_NAMES.unknownAtRules,
      LINT_RULE_NAMES.unknownAtRuleDescriptors,
      LINT_RULE_NAMES.unknownProperties,
      LINT_RULE_NAMES.zeroUnits
    ].sort());
    expect(STYLELINT_COMPARISON_LINT_CONFIG.reportSyntax).toBe(false);
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.duplicateSelectors]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.deprecatedProperties]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownPropertyValues]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.fontFaceMissingRequiredProperties]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.propertyIgnoredDueToDisplay]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.boxModel]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.float]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.propertyNoVendorPrefix]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.atRuleNoVendorPrefix]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.vendorPrefix]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.compatibleVendorPrefixes]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownVendorSpecificProperties]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.importStatement]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownAtRuleDescriptorValues]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownCustomProperties]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.mediaFeatureNameNoVendorPrefix]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.selectorNoVendorPrefix]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.selectorClassPattern]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.customPropertyPattern]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.keyframesNamePattern]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.colorFunctionNotation]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.alphaValueNotation]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.hueDegreeNotation]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.incompatibleMathFunctionUnits]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.invalidColorFunctionChannels]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.invalidTypedCustomPropertyValue]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.shadowedTokens]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.selectorMaxId]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.selectorMaxUniversal]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unusedVariables]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.duplicateModuleLoads]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unboundedExtends]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.deadExtends]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.suspiciousMapKeyAccess]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unsupportedSassForm]).toBe('off');
  });
});

describe('lintText', () => {
  it('applies per-diagnostic severity policy without owning detection', async () => {
    const result = await lintText(
      {
        source: '.a { colr: red; width: 0px; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownProperties]: 'error',
              [LINT_RULE_NAMES.zeroUnits]: 'off'
            }
          }
        },
        includeLegacyDiagnostics: true
      }
    );

    expect(result.errors.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.unknownProperties);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.zeroUnits)).toBe(false);
  });

  it('applies policy to unknown property value diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { display: flxe; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownPropertyValues]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code])).toEqual([
      [LINT_RULE_NAMES.unknownPropertyValues, LINT_CODES.unknownPropertyValues]
    ]);
    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownPropertyValues, 'error']
    ]);
  });

  it('applies policy to deprecated property diagnostics by lint rule name', async () => {
    const result = await lintText(
      {
        source: '.a { clip: auto; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.deprecatedProperties]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_RULE_NAMES.deprecatedProperties, LINT_CODES.deprecatedProperties, 'error']
    ]);
  });

  it('keeps diagnostic-code config as a compatibility alias', async () => {
    const result = await lintText(
      {
        source: '.a { colr: red; width: 0px; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            diagnostics: {
              [LINT_CODES.unknownProperties]: 'off',
              [LINT_CODES.zeroUnits]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.zeroUnits, 'error']
    ]);
  });

  it('keeps legacy framed diagnostics opt-in', async () => {
    const result = await lintText(
      {
        source: '.a { colr: red; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {}
      }
    );

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([LINT_CODES.unknownProperties]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('can surface only parser diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { color: ; }',
        filePath: '/tmp/input.css'
      },
      {
        syntaxOnly: true,
        stylesConfig: {}
      }
    );

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([PARSE_SYNTAX_ERROR_CODE]);
    expect(result.diagnostics[0]?.ruleName).toBeUndefined();
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('routes SCSS inputs through shared diagnostics policy', async () => {
    const result = await lintText(
      {
        source: '$color: red; .a { color: $color; width: 0px; }',
        filePath: '/tmp/input.scss'
      },
      {
        stylesConfig: {}
      }
    );

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([LINT_CODES.zeroUnits]);
  });

  it('applies policy to new Stylelint-comparable source diagnostics', async () => {
    const result = await lintText(
      {
        source: '@keyframes spin { from { opacity: 1 !important; } 0% { opacity: .5; } }\n.a { color: --brand; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.customPropertyMissingVarFunction]: 'error',
              [LINT_RULE_NAMES.keyframeDeclarationNoImportant]: 'off'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.keyframeDuplicateSelectors, 'warning'],
      [LINT_CODES.customPropertyMissingVarFunction, 'error']
    ]);
  });

  it('supports Stylelint-compatible duplicate-property secondary options', async () => {
    const result = await lintText(
      {
        source: '.a { color: red; color: blue; margin: 0; color: green; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.duplicateProperties]: ['warn', { ignore: ['consecutive-duplicates'] }]
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [LINT_CODES.duplicateProperties, 'Duplicate property \'color\'']
    ]);
  });

  it('keeps empty mixin bodies quiet unless block-no-empty opts into mixins', async () => {
    const input = {
      source: '.mixin() { }\n.a { }',
      filePath: '/tmp/input.less'
    };

    const defaults = await lintText(input, {
      stylesConfig: {}
    });
    expect(defaults.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [LINT_CODES.emptyRules, 'Do not use empty rulesets']
    ]);

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.emptyRules]: ['warn', { include: ['mixins'] }]
          }
        }
      }
    });
    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [LINT_CODES.emptyRules, 'Do not use empty mixin bodies'],
      [LINT_CODES.emptyRules, 'Do not use empty rulesets']
    ]);
  });

  it('applies policy to unknown custom property diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { color: var(--missing); }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownCustomProperties]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownCustomProperties, 'error']
    ]);
  });

  it('applies policy to important declaration diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { color: red !important; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.declarationNoImportant]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.declarationNoImportant, 'error']
    ]);
  });

  it('applies policy to font-family diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { font-family: Inter, inter; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.fontFamilyDuplicateNames]: 'error',
              [LINT_RULE_NAMES.fontFamilyMissingGeneric]: 'off'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.fontFamilyDuplicateNames, 'error']
    ]);
  });

  it('applies policy to missing @font-face required property diagnostics', async () => {
    const result = await lintText(
      {
        source: '@font-face { font-family: Inter; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.fontFaceMissingRequiredProperties]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.fontFaceMissingRequiredProperties, 'error']
    ]);
  });

  it('applies policy to display interaction diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { display: block; vertical-align: middle; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.propertyIgnoredDueToDisplay]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.propertyIgnoredDueToDisplay, 'error']
    ]);
  });

  it('keeps opt-in VSCode style diagnostics quiet until configured', async () => {
    const result = await lintText(
      {
        source: '.a { width: 100px; padding-left: 1px; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {}
      }
    );

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.boxModel)).toBe(false);
  });

  it('applies policy to box-model diagnostics when opted in', async () => {
    const result = await lintText(
      {
        source: '.a { width: 100px; padding-left: 1px; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.boxModel]: 'warn'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.boxModel, 'warning'],
      [LINT_CODES.boxModel, 'warning']
    ]);
  });

  it('keeps float diagnostics opt-in', async () => {
    const defaultResult = await lintText(
      {
        source: '.a { float: left; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {}
      }
    );
    const enabledResult = await lintText(
      {
        source: '.a { float: left; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.float]: 'warn'
            }
          }
        }
      }
    );

    expect(defaultResult.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.float)).toBe(false);
    expect(enabledResult.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.float, LINT_RULE_NAMES.float, 'warning']
    ]);
  });

  it('applies policy to vendor-prefix diagnostics by lint rule name', async () => {
    const result = await lintText(
      {
        source: '.a { -webkit-transform: rotate(0); }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.vendorPrefix]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.vendorPrefix, LINT_RULE_NAMES.vendorPrefix, 'error']
    ]);
  });

  it('applies vendor-prefix policy to keyframe diagnostics by lint rule name', async () => {
    const result = await lintText({
      source: '@-webkit-keyframes spin { from { opacity: 0; } }',
      filePath: '/tmp/input.css'
    });

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.vendorPrefix, LINT_RULE_NAMES.vendorPrefix, 'warning']
    ]);
  });

  it('keeps vendor-prefix style policy opt-in by lint rule name', async () => {
    const input = {
      source: [
        '.a { -webkit-transform: rotate(0); transform: rotate(0); }',
        '@keyframes spin { from { opacity: 0; } }',
        '@-webkit-keyframes spin { from { opacity: 0; } }'
      ].join('\n'),
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.propertyNoVendorPrefix
    );
    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.atRuleNoVendorPrefix
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.propertyNoVendorPrefix]: 'error',
            [LINT_RULE_NAMES.atRuleNoVendorPrefix]: 'warn',
            [LINT_RULE_NAMES.compatibleVendorPrefixes]: 'off'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.propertyNoVendorPrefix, LINT_RULE_NAMES.propertyNoVendorPrefix, 'error'],
      [LINT_CODES.atRuleNoVendorPrefix, LINT_RULE_NAMES.atRuleNoVendorPrefix, 'warning']
    ]);
  });

  it('keeps unknown vendor-specific properties opt-in by lint rule name', async () => {
    const input = {
      source: '.a { -webkit-made-up: x; }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.unknownVendorSpecificProperties
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.unknownVendorSpecificProperties]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownVendorSpecificProperties, LINT_RULE_NAMES.unknownVendorSpecificProperties, 'error']
    ]);
  });

  it('keeps compatible vendor prefixes opt-in by lint rule name', async () => {
    const input = {
      source: '.a { -webkit-user-select: none; user-select: none; }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.compatibleVendorPrefixes
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.compatibleVendorPrefixes]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.compatibleVendorPrefixes, LINT_RULE_NAMES.compatibleVendorPrefixes, 'error']
    ]);
  });

  it('keeps compatible vendor keyframes opt-in by lint rule name', async () => {
    const input = {
      source: '@keyframes spin { from { opacity: 0; } }\n@-webkit-keyframes spin { from { opacity: 0; } }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.compatibleVendorPrefixes
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.compatibleVendorPrefixes]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.compatibleVendorPrefixes, LINT_RULE_NAMES.compatibleVendorPrefixes, 'error']
    ]);
  });

  it('applies policy to invalid named grid area diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { grid-template-areas: "a a" "b"; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.invalidNamedGridAreas]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.invalidNamedGridAreas, 'error']
    ]);
  });

  it('applies policy to shorthand property override diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { margin-left: 1px; margin: 0; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.shorthandPropertyOverrides]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.shorthandPropertyOverrides, 'error']
    ]);
  });

  it('applies policy to duplicate @import diagnostics', async () => {
    const result = await lintText(
      {
        source: '@import url("a.css");\n@import "a.css";',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.duplicateAtImportRules]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.duplicateAtImportRules, 'error']
    ]);
  });

  it('keeps import-statement diagnostics opt-in by lint rule name', async () => {
    const input = {
      source: '@import url("a.css");\n.a { color: red; }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.importStatement);

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.importStatement]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.importStatement, LINT_RULE_NAMES.importStatement, 'error']
    ]);
  });

  it('applies policy to unknown animation diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { animation: missing 1s; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownAnimations]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownAnimations, 'error']
    ]);
  });

  it('applies policy to unknown at-rule descriptor diagnostics', async () => {
    const result = await lintText(
      {
        source: '@font-face { font-family: Inter; src: url(inter.woff2); made-up: nope; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownAtRuleDescriptors]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownAtRuleDescriptors, 'error']
    ]);
  });

  it('applies policy to unknown at-rule descriptor value diagnostics', async () => {
    const result = await lintText(
      {
        source: '@property --gap { syntax: "<length>"; inherits: yes; initial-value: 1px; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownAtRuleDescriptorValues]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownAtRuleDescriptorValues, 'error']
    ]);
  });

  it('applies policy to duplicate custom property diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { --brand: red; --brand: blue; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.duplicateCustomProperties]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.duplicateCustomProperties, 'error']
    ]);
  });

  it('applies policy to invalid @import position diagnostics without syntax reporting', async () => {
    const result = await lintText(
      {
        source: '.a { color: red; }\n@import "late.css";',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            reportSyntax: false,
            rules: {
              [LINT_RULE_NAMES.invalidImportPosition]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity, diagnostic.line, diagnostic.column])).toEqual([
      [LINT_CODES.invalidImportPosition, 'error', 2, 1]
    ]);
  });

  it('applies policy to duplicate selector diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { color: red; }\n.a { color: blue; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.duplicateSelectors]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.duplicateSelectors, 'error']
    ]);
  });

  it('applies policy to unknown unit diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { width: 1pixels; height: 1bad; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownUnits]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownUnits, 'error'],
      [LINT_CODES.unknownUnits, 'error']
    ]);
  });

  it('applies policy to unknown selector pseudo diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a:foo::bar { color: red; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownPseudoClasses]: 'error',
              [LINT_RULE_NAMES.unknownPseudoElements]: 'off'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownPseudoClasses, 'error']
    ]);
  });

  it('keeps vendor-prefixed selector policy opt-in by lint rule name', async () => {
    const input = {
      source: '.a::-webkit-scrollbar { color: red; }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.selectorNoVendorPrefix);

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.selectorNoVendorPrefix]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.selectorNoVendorPrefix, LINT_RULE_NAMES.selectorNoVendorPrefix, 'error']
    ]);
  });

  it('applies policy to unknown function diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { width: project-size(1px); }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownFunctions]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownFunctions, 'error']
    ]);
  });

  it('applies policy to nonstandard linear-gradient direction diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { background: linear-gradient(top, #fff, #000); }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.linearGradientNonstandardDirection]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.linearGradientNonstandardDirection, 'error']
    ]);
  });

  it('keeps modern notation policies opt-in and filters by configured notation', async () => {
    const input = {
      source: [
        '.a { color: rgb(1, 2, 3); background: rgb(1 2 3 / .5); }',
        '.b { opacity: 50%; }',
        '.c { color: hsl(120 50% 50% / 25%); }',
        '.d { color: hsl(120deg 50% 50% / .25); }'
      ].join('\n'),
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.colorFunctionNotation);
    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.alphaValueNotation);
    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.hueDegreeNotation);

    const configuredWithoutNotation = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.alphaValueNotation]: 'warn'
          }
        }
      }
    });

    expect(configuredWithoutNotation.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.alphaValueNotation
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.colorFunctionNotation]: ['warn', { notation: 'modern' }],
            [LINT_RULE_NAMES.alphaValueNotation]: ['warn', { notation: 'percentage' }],
            [LINT_RULE_NAMES.hueDegreeNotation]: ['warn', { notation: 'angle' }]
          }
        }
      }
    });

    const configuredNotation = configured.diagnostics.filter(diagnostic =>
      diagnostic.code === LINT_CODES.colorFunctionNotation
      || diagnostic.code === LINT_CODES.alphaValueNotation
      || diagnostic.code === LINT_CODES.hueDegreeNotation
    );

    expect(configuredNotation.map(diagnostic => [
      diagnostic.code,
      diagnostic.ruleName,
      input.source.slice(diagnostic.start, diagnostic.end)
    ])).toEqual([
      [LINT_CODES.colorFunctionNotation, LINT_RULE_NAMES.colorFunctionNotation, 'rgb('],
      [LINT_CODES.alphaValueNotation, LINT_RULE_NAMES.alphaValueNotation, '.5'],
      [LINT_CODES.hueDegreeNotation, LINT_RULE_NAMES.hueDegreeNotation, '120'],
      [LINT_CODES.alphaValueNotation, LINT_RULE_NAMES.alphaValueNotation, '.25']
    ]);

    const numberNotation = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.alphaValueNotation]: ['warn', { notation: 'number' }],
            [LINT_RULE_NAMES.hueDegreeNotation]: ['warn', { notation: 'number' }]
          }
        }
      }
    });

    const numberNotationDiagnostics = numberNotation.diagnostics.filter(diagnostic =>
      diagnostic.code === LINT_CODES.alphaValueNotation
      || diagnostic.code === LINT_CODES.hueDegreeNotation
    );

    expect(numberNotationDiagnostics.map(diagnostic => [
      diagnostic.code,
      input.source.slice(diagnostic.start, diagnostic.end)
    ])).toEqual([
      [LINT_CODES.alphaValueNotation, '50%'],
      [LINT_CODES.alphaValueNotation, '25%'],
      [LINT_CODES.hueDegreeNotation, '120deg']
    ]);
  });

  it('applies policy to unmatchable An+B selector diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a:nth-child(0) { color: red; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unmatchableAnbSelectors]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unmatchableAnbSelectors, 'error']
    ]);
  });

  it('applies policy to unknown media feature name diagnostics', async () => {
    const result = await lintText(
      {
        source: '@media (project-feature: enabled) { .a { color: red; } }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownMediaFeatureNames]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownMediaFeatureNames, 'error']
    ]);
  });

  it('keeps vendor-prefixed media feature policy opt-in by lint rule name', async () => {
    const input = {
      source: '@media (-webkit-device-pixel-ratio: 2) { .a { color: red; } }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.mediaFeatureNameNoVendorPrefix
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.mediaFeatureNameNoVendorPrefix]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.mediaFeatureNameNoVendorPrefix, LINT_RULE_NAMES.mediaFeatureNameNoVendorPrefix, 'error']
    ]);
  });

  it('keeps naming pattern policies opt-in and filters by configured pattern', async () => {
    const input = {
      source: [
        '@property --BadToken { syntax: "<color>"; inherits: false; initial-value: red; }',
        '@property --good-token { syntax: "<color>"; inherits: false; initial-value: red; }',
        '.BadClass, .good-class { --BadLocal: red; --good-local: blue; }',
        '@keyframes BadSpin { from { opacity: 0; } }',
        '@keyframes good-spin { to { opacity: 1; } }'
      ].join('\n'),
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.selectorClassPattern);
    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.customPropertyPattern);
    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.keyframesNamePattern);

    const configuredWithoutPattern = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.selectorClassPattern]: 'warn'
          }
        }
      }
    });

    expect(configuredWithoutPattern.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.selectorClassPattern
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.selectorClassPattern]: ['warn', { pattern: '^[a-z][a-z0-9-]*$' }],
            [LINT_RULE_NAMES.customPropertyPattern]: ['warn', { pattern: '^--[a-z][a-z0-9-]*$' }],
            [LINT_RULE_NAMES.keyframesNamePattern]: ['warn', { pattern: '^[a-z][a-z0-9-]*$' }]
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [
      diagnostic.code,
      diagnostic.ruleName,
      input.source.slice(diagnostic.start, diagnostic.end)
    ])).toEqual([
      [LINT_CODES.customPropertyPattern, LINT_RULE_NAMES.customPropertyPattern, '--BadToken'],
      [LINT_CODES.selectorClassPattern, LINT_RULE_NAMES.selectorClassPattern, '.BadClass'],
      [LINT_CODES.customPropertyPattern, LINT_RULE_NAMES.customPropertyPattern, '--BadLocal'],
      [LINT_CODES.keyframesNamePattern, LINT_RULE_NAMES.keyframesNamePattern, 'BadSpin']
    ]);
  });

  it('applies policy to unknown media feature value diagnostics', async () => {
    const result = await lintText(
      {
        source: '@media (orientation: sideways) { .a { color: red; } }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownMediaFeatureValues]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownMediaFeatureValues, 'error']
    ]);
  });

  it('applies policy to unknown type selector diagnostics', async () => {
    const result = await lintText(
      {
        source: 'projectpanel { color: red; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unknownTypeSelectors]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownTypeSelectors, 'error']
    ]);
  });

  it('keeps ID selector policy opt-in by lint rule name', async () => {
    const input = {
      source: '#app { color: red; }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.selectorMaxId);

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.selectorMaxId]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.selectorMaxId, LINT_RULE_NAMES.selectorMaxId, 'error']
    ]);
  });

  it('keeps universal selector policy opt-in by lint rule name', async () => {
    const input = {
      source: '* { color: red; }',
      filePath: '/tmp/input.css'
    };
    const defaultResult = await lintText(input);

    expect(defaultResult.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
      LINT_CODES.selectorMaxUniversal
    );

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.selectorMaxUniversal]: 'error'
          }
        }
      }
    });

    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.ruleName, diagnostic.severity])).toEqual([
      [LINT_CODES.selectorMaxUniversal, LINT_RULE_NAMES.selectorMaxUniversal, 'error']
    ]);
  });

  it('applies policy to incompatible math function unit diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { width: min(1px, 2s); }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.incompatibleMathFunctionUnits]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.incompatibleMathFunctionUnits, 'error']
    ]);
  });

  it('applies policy to invalid color function channel diagnostics', async () => {
    const result = await lintText(
      {
        source: '.a { color: hsl(120 50 50%); }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.invalidColorFunctionChannels]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.invalidColorFunctionChannels, 'error']
    ]);
  });

  it('applies policy to invalid typed custom property value diagnostics', async () => {
    const result = await lintText(
      {
        source: '@property --gap { syntax: "<length>"; initial-value: red; inherits: false; }',
        filePath: '/tmp/input.css'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.invalidTypedCustomPropertyValue]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.invalidTypedCustomPropertyValue, 'error']
    ]);
  });

  it('keeps unused variables opt-in until project symbol facts exist', async () => {
    const input = {
      source: '$used: red; $unused: blue; .a { color: $used; }',
      filePath: '/tmp/input.scss'
    };

    const defaults = await lintText(input, {
      stylesConfig: {}
    });
    expect(defaults.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unusedVariables)).toBe(false);

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.unusedVariables]: 'warn'
          }
        }
      }
    });
    expect(configured.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unusedVariables, 'warning']
    ]);
  });

  it('keeps shadowed tokens opt-in until project symbol facts exist', async () => {
    const input = {
      source: '$tone: red; .theme { $tone: blue; color: $tone; } .root { color: $tone; }',
      filePath: '/tmp/input.scss'
    };

    const defaults = await lintText(input, {
      stylesConfig: {}
    });
    expect(defaults.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.shadowedTokens)).toBe(false);

    const configured = await lintText(input, {
      stylesConfig: {
        lint: {
          rules: {
            [LINT_RULE_NAMES.shadowedTokens]: 'warn'
          }
        }
      }
    });
    expect(configured.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_RULE_NAMES.shadowedTokens, LINT_CODES.shadowedTokens, 'warning']
    ]);
  });

  it('applies policy to duplicate module-load diagnostics by lint rule name', async () => {
    const result = await lintText(
      {
        source: '@use "theme";\n@use "theme";',
        filePath: '/tmp/input.scss'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.duplicateModuleLoads]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_RULE_NAMES.duplicateModuleLoads, LINT_CODES.duplicateModuleLoads, 'error']
    ]);
  });

  it('applies policy to unbounded extend diagnostics by lint rule name', async () => {
    const result = await lintText(
      {
        source: '.a { @extend div; }',
        filePath: '/tmp/input.scss'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.unboundedExtends]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_RULE_NAMES.unboundedExtends, LINT_CODES.unboundedExtends, 'error']
    ]);
  });

  it('applies policy to dead extend diagnostics by lint rule name', async () => {
    const result = await lintText(
      {
        source: '.hit { color: red; }\n.a { @extend .missing; }',
        filePath: '/tmp/input.scss'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.deadExtends]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_RULE_NAMES.deadExtends, LINT_CODES.deadExtends, 'error']
    ]);
  });

  it('applies policy to suspicious map key access diagnostics by lint rule name', async () => {
    const result = await lintText(
      {
        source: '$tokens: (tone: blue);\n.a { color: map-get($tokens, 0); }',
        filePath: '/tmp/input.scss'
      },
      {
        stylesConfig: {
          lint: {
            rules: {
              [LINT_RULE_NAMES.suspiciousMapKeyAccess]: 'error'
            }
          }
        }
      }
    );

    expect(result.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_RULE_NAMES.suspiciousMapKeyAccess, LINT_CODES.suspiciousMapKeyAccess, 'error']
    ]);
  });
});

describe('lintFiles', () => {
  it('uses configured files and ignore patterns when no explicit patterns are passed', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'jess-lint-'));
    await writeFile(path.join(cwd, 'included.css'), '.a { colr: red; }');
    await writeFile(path.join(cwd, 'ignored.css'), '.b { colr: red; }');

    const result = await lintFiles([], {
      cwd,
      stylesConfig: {
        lint: {
          files: ['*.css'],
          ignoreFiles: ['ignored.css']
        }
      }
    });

    expect(result.results.map(file => path.basename(file.filePath ?? ''))).toEqual(['included.css']);
    expect(result.warningCount).toBeGreaterThan(0);
  });
});

describe('formatStyledLintResult', () => {
  it('renders compact per-file line diagnostics without source excerpts', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'jess-lint-format-'));
    const filePath = path.join(cwd, 'bad.css');
    await writeFile(filePath, '.a {\n  colr: red;\n  width: 0px;\n}\n');

    const result = await lintFiles([filePath], {
      cwd,
      includeLegacyDiagnostics: true,
      stylesConfig: {}
    });
    const output = formatStyledLintResult(result, { colors: false, cwd });

    expect(output).toContain('bad.css');
    expect(output).toContain('2:3');
    expect(output).toContain('3:10');
    expect(output).toContain('warning');
    expect(output).toContain(LINT_RULE_NAMES.unknownProperties);
    expect(output).toContain(LINT_RULE_NAMES.zeroUnits);
    expect(output).not.toContain(LINT_CODES.unknownProperties);
    expect(output).not.toContain(LINT_CODES.zeroUnits);
    expect(output).not.toContain('colr: red;');
    expect(output).not.toContain('width: 0px;');
  });
});
