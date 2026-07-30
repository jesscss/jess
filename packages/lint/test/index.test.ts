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

    expect(STABLE_LINT_RULES.map(rule => rule.code)).toEqual([
      LINT_CODES.emptyRules,
      LINT_CODES.unknownProperties,
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
      LINT_CODES.keyframeDuplicateSelectors,
      LINT_CODES.keyframeDeclarationNoImportant,
      LINT_CODES.declarationNoImportant,
      LINT_CODES.invalidNamedGridAreas,
      LINT_CODES.fontFamilyDuplicateNames,
      LINT_CODES.fontFamilyMissingGeneric,
      LINT_CODES.invalidImportPosition,
      LINT_CODES.duplicateAtImportRules,
      LINT_CODES.unknownAnimations,
      LINT_CODES.duplicateSelectors,
      LINT_CODES.unknownUnits,
      LINT_CODES.unknownFunctions,
      LINT_CODES.linearGradientNonstandardDirection,
      LINT_CODES.unknownMediaFeatureNames,
      LINT_CODES.unknownMediaFeatureValues,
      LINT_CODES.unknownPseudoClasses,
      LINT_CODES.unknownPseudoElements,
      LINT_CODES.unmatchableAnbSelectors,
      LINT_CODES.unknownTypeSelectors,
      LINT_CODES.incompatibleMathFunctionUnits,
      LINT_CODES.invalidColorFunctionChannels,
      LINT_CODES.invalidTypedCustomPropertyValue,
      LINT_CODES.unsupportedSassForm
    ]);
    expect(STABLE_LINT_RULES.map(rule => rule.ruleName)).toEqual([
      LINT_RULE_NAMES.emptyRules,
      LINT_RULE_NAMES.unknownProperties,
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
      LINT_RULE_NAMES.keyframeDuplicateSelectors,
      LINT_RULE_NAMES.keyframeDeclarationNoImportant,
      LINT_RULE_NAMES.declarationNoImportant,
      LINT_RULE_NAMES.invalidNamedGridAreas,
      LINT_RULE_NAMES.fontFamilyDuplicateNames,
      LINT_RULE_NAMES.fontFamilyMissingGeneric,
      LINT_RULE_NAMES.invalidImportPosition,
      LINT_RULE_NAMES.duplicateAtImportRules,
      LINT_RULE_NAMES.unknownAnimations,
      LINT_RULE_NAMES.duplicateSelectors,
      LINT_RULE_NAMES.unknownUnits,
      LINT_RULE_NAMES.unknownFunctions,
      LINT_RULE_NAMES.linearGradientNonstandardDirection,
      LINT_RULE_NAMES.unknownMediaFeatureNames,
      LINT_RULE_NAMES.unknownMediaFeatureValues,
      LINT_RULE_NAMES.unknownPseudoClasses,
      LINT_RULE_NAMES.unknownPseudoElements,
      LINT_RULE_NAMES.unmatchableAnbSelectors,
      LINT_RULE_NAMES.unknownTypeSelectors,
      LINT_RULE_NAMES.incompatibleMathFunctionUnits,
      LINT_RULE_NAMES.invalidColorFunctionChannels,
      LINT_RULE_NAMES.invalidTypedCustomPropertyValue,
      LINT_RULE_NAMES.unsupportedSassForm
    ]);
    expect(STABLE_LINT_RULE_SET_VERSION).toBe(25);
    expect(recommended[LINT_RULE_NAMES.hexColorLength]).toBe('error');
    expect(recommended[LINT_RULE_NAMES.zeroUnits]).toBe('warn');
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
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownPropertyValues]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownAtRuleDescriptorValues]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.unknownCustomProperties]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.incompatibleMathFunctionUnits]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.invalidColorFunctionChannels]).toBe('off');
    expect(STYLELINT_COMPARISON_LINT_CONFIG.rules?.[LINT_RULE_NAMES.invalidTypedCustomPropertyValue]).toBe('off');
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

    expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      [LINT_CODES.unknownPropertyValues, 'error']
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
        source: '@font-face { made-up: nope; }',
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
    expect(output).toContain(LINT_CODES.unknownProperties);
    expect(output).toContain(LINT_CODES.zeroUnits);
    expect(output).not.toContain('colr: red;');
    expect(output).not.toContain('width: 0px;');
  });
});
