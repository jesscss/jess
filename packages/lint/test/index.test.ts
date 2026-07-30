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
      LINT_CODES.unknownAtRules,
      LINT_CODES.duplicateProperties,
      LINT_CODES.hexColorLength,
      LINT_CODES.zeroUnits,
      LINT_CODES.customPropertyMissingVarFunction,
      LINT_CODES.keyframeDuplicateSelectors,
      LINT_CODES.keyframeDeclarationNoImportant,
      LINT_CODES.fontFamilyDuplicateNames,
      LINT_CODES.fontFamilyMissingGeneric,
      LINT_CODES.unsupportedSassForm
    ]);
    expect(STABLE_LINT_RULES.map(rule => rule.ruleName)).toEqual([
      LINT_RULE_NAMES.emptyRules,
      LINT_RULE_NAMES.unknownProperties,
      LINT_RULE_NAMES.unknownAtRules,
      LINT_RULE_NAMES.duplicateProperties,
      LINT_RULE_NAMES.hexColorLength,
      LINT_RULE_NAMES.zeroUnits,
      LINT_RULE_NAMES.customPropertyMissingVarFunction,
      LINT_RULE_NAMES.keyframeDuplicateSelectors,
      LINT_RULE_NAMES.keyframeDeclarationNoImportant,
      LINT_RULE_NAMES.fontFamilyDuplicateNames,
      LINT_RULE_NAMES.fontFamilyMissingGeneric,
      LINT_RULE_NAMES.unsupportedSassForm
    ]);
    expect(STABLE_LINT_RULE_SET_VERSION).toBe(2);
    expect(recommended[LINT_RULE_NAMES.hexColorLength]).toBe('error');
    expect(recommended[LINT_RULE_NAMES.zeroUnits]).toBe('warn');
  });

  it('keeps the Stylelint comparison policy limited to comparable rules', () => {
    const comparison = stylelintComparisonRules();

    expect(Object.keys(comparison).sort()).toEqual([
      LINT_RULE_NAMES.duplicateProperties,
      LINT_RULE_NAMES.emptyRules,
      LINT_RULE_NAMES.hexColorLength,
      LINT_RULE_NAMES.customPropertyMissingVarFunction,
      LINT_RULE_NAMES.fontFamilyDuplicateNames,
      LINT_RULE_NAMES.fontFamilyMissingGeneric,
      LINT_RULE_NAMES.keyframeDeclarationNoImportant,
      LINT_RULE_NAMES.keyframeDuplicateSelectors,
      LINT_RULE_NAMES.unknownAtRules,
      LINT_RULE_NAMES.unknownProperties,
      LINT_RULE_NAMES.zeroUnits
    ].sort());
    expect(STYLELINT_COMPARISON_LINT_CONFIG.reportSyntax).toBe(false);
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
