import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINT_CODES } from '@jesscss/diagnostics-core';
import {
  PARSE_SYNTAX_ERROR_CODE,
  STABLE_LINT_RULES,
  STYLELINT_COMPARISON_LINT_CONFIG,
  formatStyledLintResult,
  lintFiles,
  lintText,
  recommendedLintDiagnostics,
  stylelintComparisonDiagnostics
} from '../src/index.js';

describe('stable rule set', () => {
  it('pins the recommended diagnostic policy by code', () => {
    const recommended = recommendedLintDiagnostics();

    expect(STABLE_LINT_RULES.map(rule => rule.code)).toEqual([
      PARSE_SYNTAX_ERROR_CODE,
      LINT_CODES.emptyRules,
      LINT_CODES.unknownProperties,
      LINT_CODES.unknownAtRules,
      LINT_CODES.duplicateProperties,
      LINT_CODES.hexColorLength,
      LINT_CODES.zeroUnits,
      LINT_CODES.unsupportedSassForm
    ]);
    expect(recommended[LINT_CODES.hexColorLength]).toBe('error');
    expect(recommended[LINT_CODES.zeroUnits]).toBe('warn');
  });

  it('keeps the Stylelint comparison policy limited to comparable rules', () => {
    const comparison = stylelintComparisonDiagnostics();

    expect(Object.keys(comparison).sort()).toEqual([
      LINT_CODES.duplicateProperties,
      LINT_CODES.emptyRules,
      LINT_CODES.hexColorLength,
      LINT_CODES.unknownAtRules,
      LINT_CODES.unknownProperties,
      LINT_CODES.zeroUnits
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
            diagnostics: {
              [LINT_CODES.unknownProperties]: 'error',
              [LINT_CODES.zeroUnits]: 'off'
            }
          }
        },
        includeLegacyDiagnostics: true
      }
    );

    expect(result.errors.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.unknownProperties);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.zeroUnits)).toBe(false);
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
        source: '.a { colr: red; }',
        filePath: '/tmp/input.css'
      },
      {
        syntaxOnly: true,
        stylesConfig: {}
      }
    );

    expect(result.diagnostics).toEqual([]);
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
