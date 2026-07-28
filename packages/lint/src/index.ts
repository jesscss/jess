import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import {
  collectTolerantDiagnostics,
  type DiagnosticSeverityName,
  type JessLanguage,
  type SourceDiagnostic
} from '@jesscss/diagnostics-core';
import {
  extractRelevantLines,
  lineColAt,
  type ErrorDiagnostic,
  type WarningDiagnostic
} from '@jesscss/core';
import type {
  LintConfig,
  LintSeverity,
  StylesConfig
} from 'styles-config';
import { loadConfig, loadConfigFromPath } from 'styles-config';
import {
  RECOMMENDED_LINT_CONFIG
} from './rules.js';

export type { LintConfig, LintSeverity };
export {
  PARSE_SYNTAX_ERROR_CODE,
  RECOMMENDED_LINT_CONFIG,
  STABLE_LINT_RULES,
  STABLE_LINT_RULE_SET_VERSION,
  STYLELINT_COMPARISON_LINT_CONFIG,
  recommendedLintDiagnostics,
  stylelintComparisonDiagnostics,
  type LintRuleComparisonKind,
  type LintRuleTier,
  type StableLintRule
} from './rules.js';

const DEFAULT_FILE_PATTERNS = ['**/*.{css,less,scss,jess}'];

export interface LintOptions {
  readonly cwd?: string;
  readonly configFile?: string;
  readonly stylesConfig?: StylesConfig;
  readonly lintConfig?: LintConfig;
  readonly language?: JessLanguage;
  readonly maxWarnings?: number;
  readonly syntaxOnly?: boolean;
}

export interface LintTextInput {
  readonly source: string;
  readonly filePath?: string;
  readonly language?: JessLanguage;
}

export interface LintDiagnostic extends SourceDiagnostic {
  readonly severity: DiagnosticSeverityName;
}

export interface LintResult {
  readonly filePath?: string;
  readonly diagnostics: readonly LintDiagnostic[];
  readonly errors: readonly ErrorDiagnostic[];
  readonly warnings: readonly WarningDiagnostic[];
}

export interface LintRunResult {
  readonly results: readonly LintResult[];
  readonly errored: boolean;
  readonly warningCount: number;
  readonly errorCount: number;
}

function lintConfigFromStylesConfig(config: StylesConfig | null | undefined): LintConfig | undefined {
  return config?.lint;
}

function mergeLintConfig(base?: LintConfig, override?: LintConfig): LintConfig {
  return {
    ...base,
    ...override,
    diagnostics: {
      ...base?.diagnostics,
      ...override?.diagnostics
    }
  };
}

async function resolveLintConfig(options: LintOptions): Promise<LintConfig> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = options.stylesConfig
    ?? (options.configFile
      ? await loadConfigFromPath(options.configFile)
      : await loadConfig(cwd));
  return mergeLintConfig(
    mergeLintConfig(RECOMMENDED_LINT_CONFIG, lintConfigFromStylesConfig(loaded)),
    options.lintConfig
  );
}

function languageFromPath(filePath: string | undefined, fallback: JessLanguage | undefined): JessLanguage {
  if (fallback) {
    return fallback;
  }
  const ext = path.extname(filePath ?? '').toLowerCase();
  if (ext === '.less') {
    return 'less';
  }
  if (ext === '.scss') {
    return 'scss';
  }
  if (ext === '.jess') {
    return 'jess';
  }
  return 'css';
}

function applyPolicy(diagnostics: readonly SourceDiagnostic[], config: LintConfig, options: LintOptions): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (options.syntaxOnly === true && diagnostic.phase !== 'parse') {
      continue;
    }
    if (config.reportSyntax === false && diagnostic.phase === 'parse') {
      continue;
    }
    const policy = config.diagnostics?.[diagnostic.code];
    if (policy === undefined || policy === 'off') {
      continue;
    }
    out.push({
      ...diagnostic,
      severity: policy === 'error'
        ? 'error'
        : policy === 'warn'
          ? 'warning'
          : diagnostic.defaultSeverity
    });
  }
  return out;
}

function toErrorDiagnostic(diagnostic: LintDiagnostic, source: string): ErrorDiagnostic {
  const start = lineColAt(source, diagnostic.start);
  const end = lineColAt(source, diagnostic.end);
  return {
    code: diagnostic.code,
    phase: diagnostic.phase,
    message: diagnostic.message,
    reason: diagnostic.reason,
    fix: diagnostic.fix,
    filePath: diagnostic.filePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    lines: extractRelevantLines(source, start.line)
  };
}

function toWarningDiagnostic(diagnostic: LintDiagnostic, source: string): WarningDiagnostic {
  const start = lineColAt(source, diagnostic.start);
  const end = lineColAt(source, diagnostic.end);
  return {
    code: diagnostic.code,
    phase: diagnostic.phase,
    message: diagnostic.message,
    reason: diagnostic.reason,
    fix: diagnostic.fix,
    filePath: diagnostic.filePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    lines: extractRelevantLines(source, start.line)
  };
}

function toLintResult(
  source: string,
  filePath: string | undefined,
  diagnostics: readonly LintDiagnostic[]
): LintResult {
  return {
    filePath,
    diagnostics,
    errors: diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => toErrorDiagnostic(diagnostic, source)),
    warnings: diagnostics
      .filter(diagnostic => diagnostic.severity !== 'error')
      .map(diagnostic => toWarningDiagnostic(diagnostic, source))
  };
}

export async function lintText(input: LintTextInput, options: LintOptions = {}): Promise<LintResult> {
  const lintConfig = await resolveLintConfig(options);
  const language = languageFromPath(input.filePath, input.language ?? options.language);
  const collected = collectTolerantDiagnostics({
    source: input.source,
    filePath: input.filePath,
    language
  });
  return toLintResult(input.source, input.filePath, applyPolicy(collected.diagnostics, lintConfig, options));
}

function patternsOf(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return typeof value === 'string' ? [value] : [...value];
}

export async function lintFiles(patterns: string | readonly string[], options: LintOptions = {}): Promise<LintRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const lintConfig = await resolveLintConfig(options);
  const inputPatterns = typeof patterns === 'string' ? [patterns] : [...patterns];
  const configuredPatterns = patternsOf(lintConfig.files);
  const searchPatterns = inputPatterns.length > 0
    ? inputPatterns
    : configuredPatterns.length > 0
      ? configuredPatterns
      : DEFAULT_FILE_PATTERNS;
  const files = await glob(searchPatterns, {
    cwd,
    absolute: true,
    nodir: true,
    ignore: patternsOf(lintConfig.ignoreFiles)
  });
  files.sort();

  const results: LintResult[] = [];
  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    const language = languageFromPath(filePath, options.language);
    const collected = collectTolerantDiagnostics({ source, filePath, language });
    results.push(toLintResult(source, filePath, applyPolicy(collected.diagnostics, lintConfig, options)));
  }

  const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);
  const warningCount = results.reduce((sum, result) => sum + result.warnings.length, 0);
  return {
    results,
    errorCount,
    warningCount,
    errored: errorCount > 0 || (options.maxWarnings !== undefined && warningCount > options.maxWarnings)
  };
}

export function formatLintResult(result: LintRunResult): string {
  const lines: string[] = [];
  for (const file of result.results) {
    for (const diagnostic of file.diagnostics) {
      const loc = `${file.filePath ?? '<input>'}:${diagnostic.start}`;
      lines.push(`${loc} ${diagnostic.severity} ${diagnostic.code} ${diagnostic.message}`);
    }
  }
  lines.push(`Linted ${result.results.length} file(s): ${result.errorCount} error(s), ${result.warningCount} warning(s)`);
  return lines.join('\n');
}
