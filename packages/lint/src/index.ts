import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { Region, type LineContent, type TextStyle } from 'linecraft';
import {
  collectTolerantDiagnostics,
  type DiagnosticSeverityName,
  type JessLanguage,
  type SourceDiagnostic
} from '@jesscss/diagnostics-core';
import {
  type ErrorDiagnostic,
  type WarningDiagnostic
} from '@jesscss/core';
import type {
  LintConfig,
  LintRuleSetting,
  LintSeverity,
  StylesConfig
} from 'styles-config';
import { loadConfig, loadConfigFromPath } from 'styles-config';
import {
  RECOMMENDED_LINT_CONFIG,
  ruleNameForDiagnostic
} from './rules.js';

export type { LintConfig, LintRuleSetting, LintSeverity };
export {
  LINT_RULE_NAMES,
  PARSE_SYNTAX_ERROR_CODE,
  RECOMMENDED_LINT_CONFIG,
  STABLE_LINT_RULES,
  STABLE_LINT_RULE_SET_VERSION,
  STYLELINT_COMPARISON_LINT_CONFIG,
  diagnosticCodeForRule,
  recommendedLintDiagnostics,
  recommendedLintRules,
  ruleNameForDiagnostic,
  stylelintComparisonDiagnostics,
  stylelintComparisonRules,
  type LintRuleComparisonKind,
  type LintRuleName,
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
  readonly includeLegacyDiagnostics?: boolean;
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

export interface LintFormatOptions {
  readonly colors?: boolean;
  readonly cwd?: string;
}

interface LinePosition {
  readonly line: number;
  readonly column: number;
}

interface DisplayDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverityName;
  readonly message: string;
  readonly filePath?: string;
  readonly line: number;
  readonly column: number;
}

class SourceLineIndex {
  readonly #source: string;
  readonly #lineStarts: number[];
  readonly #lines: string[];

  constructor(source: string) {
    this.#source = source;
    this.#lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) {
        this.#lineStarts.push(i + 1);
      }
    }
    this.#lines = source.split(/\r?\n/);
  }

  lineColAt(offset: number): LinePosition {
    const end = Math.min(Math.max(0, offset), this.#source.length);
    let low = 0;
    let high = this.#lineStarts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = this.#lineStarts[mid] ?? 0;
      if (start <= end) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIndex = Math.max(0, high);
    return {
      line: lineIndex + 1,
      column: end - (this.#lineStarts[lineIndex] ?? 0) + 1
    };
  }

  extractRelevantLines(line: number, contextLines = 1): Record<number, string> | undefined {
    if (this.#source.length === 0) {
      return undefined;
    }
    const target = Math.max(1, Math.min(line, this.#lines.length));
    const start = Math.max(1, target - contextLines);
    const end = Math.min(this.#lines.length, target + contextLines);
    const result: Record<number, string> = {};
    for (let i = start; i <= end; i++) {
      result[i] = this.#lines[i - 1] ?? '';
    }
    return result;
  }
}

function lintConfigFromStylesConfig(config: StylesConfig | null | undefined): LintConfig | undefined {
  return config?.lint;
}

function mergeLintConfig(base?: LintConfig, override?: LintConfig): LintConfig {
  return {
    ...base,
    ...override,
    rules: {
      ...base?.rules,
      ...rulesFromDiagnostics(base?.diagnostics),
      ...rulesFromDiagnostics(override?.diagnostics),
      ...override?.rules
    },
    diagnostics: {
      ...base?.diagnostics,
      ...override?.diagnostics
    }
  };
}

function rulesFromDiagnostics(diagnostics: Record<string, LintSeverity> | undefined): Record<string, LintRuleSetting> {
  if (diagnostics === undefined) {
    return {};
  }
  const rules: Record<string, LintRuleSetting> = {};
  for (const [code, severity] of Object.entries(diagnostics)) {
    rules[ruleNameForDiagnostic(code)] = severity;
  }
  return rules;
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
    const policy = config.rules?.[ruleNameForDiagnostic(diagnostic.code)]
      ?? config.rules?.[diagnostic.code]
      ?? config.diagnostics?.[diagnostic.code];
    if (policy === undefined || policy === null || policy === 'off') {
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

function toErrorDiagnostic(diagnostic: LintDiagnostic, lines: SourceLineIndex): ErrorDiagnostic {
  const start = lines.lineColAt(diagnostic.start);
  const end = lines.lineColAt(diagnostic.end);
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
    lines: lines.extractRelevantLines(start.line)
  };
}

function toWarningDiagnostic(diagnostic: LintDiagnostic, lines: SourceLineIndex): WarningDiagnostic {
  const start = lines.lineColAt(diagnostic.start);
  const end = lines.lineColAt(diagnostic.end);
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
    lines: lines.extractRelevantLines(start.line)
  };
}

function toLintResult(
  source: string,
  filePath: string | undefined,
  diagnostics: readonly LintDiagnostic[],
  includeLegacyDiagnostics: boolean
): LintResult {
  if (!includeLegacyDiagnostics) {
    return {
      filePath,
      diagnostics,
      errors: [],
      warnings: []
    };
  }

  const lines = new SourceLineIndex(source);
  const errors: ErrorDiagnostic[] = [];
  const warnings: WarningDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') {
      errors.push(toErrorDiagnostic(diagnostic, lines));
    } else {
      warnings.push(toWarningDiagnostic(diagnostic, lines));
    }
  }
  return {
    filePath,
    diagnostics,
    errors,
    warnings
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
  return toLintResult(
    input.source,
    input.filePath,
    applyPolicy(collected.diagnostics, lintConfig, options),
    options.includeLegacyDiagnostics === true
  );
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
    results.push(toLintResult(
      source,
      filePath,
      applyPolicy(collected.diagnostics, lintConfig, options),
      options.includeLegacyDiagnostics === true
    ));
  }

  const errorCount = results.reduce(
    (sum, result) => sum + result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length,
    0
  );
  const warningCount = results.reduce(
    (sum, result) => sum + result.diagnostics.filter(diagnostic => diagnostic.severity !== 'error').length,
    0
  );
  return {
    results,
    errorCount,
    warningCount,
    errored: errorCount > 0 || (options.maxWarnings !== undefined && warningCount > options.maxWarnings)
  };
}

export function formatLintResult(result: LintRunResult): string {
  const rows = formatLintRows(result, {
    colors: false,
    cwd: process.cwd()
  }).map(row => row.text);
  return rows.join('\n');
}

export function formatStyledLintResult(result: LintRunResult, options: LintFormatOptions = {}): string {
  const colors = options.colors ?? true;
  const rows = formatLintRows(result, {
    colors,
    cwd: options.cwd ?? process.cwd()
  });
  if (!colors) {
    return rows.map(row => row.text).join('\n');
  }

  const region = Region({ disableRendering: true, width: terminalWidth() });
  region.set(rows);
  const lines: string[] = [];
  for (let line = 1; line <= region.height; line++) {
    lines.push(region.getLine(line));
  }
  region.destroy(false);
  return lines.join('\n');
}

function formatLintRows(result: LintRunResult, options: Required<LintFormatOptions>): LineContent[] {
  const rows: LineContent[] = [];
  for (const file of result.results) {
    const diagnostics = displayDiagnostics(file);
    if (diagnostics.length === 0) {
      continue;
    }

    const filePath = file.filePath ?? diagnostics[0]?.filePath;
    const fileLabel = filePath ? displayPath(options.cwd, filePath) : '<input>';
    rows.push({
      text: linkIfEnabled(options.colors, filePath, fileLabel),
      style: { color: 'cyan', bold: true }
    });

    const locWidth = Math.max(...diagnostics.map(diagnostic => locOf(diagnostic).length));
    const severityWidth = Math.max(...diagnostics.map(diagnostic => diagnostic.severity.length));
    const codeWidth = Math.max(...diagnostics.map(diagnostic => diagnostic.code.length));
    for (const diagnostic of diagnostics) {
      const loc = locOf(diagnostic).padStart(locWidth);
      const severity = diagnostic.severity.padEnd(severityWidth);
      const code = diagnostic.code.padEnd(codeWidth);
      rows.push({
        text: `  ${linkIfEnabled(options.colors, diagnostic.filePath, loc, diagnostic.line, diagnostic.column)}  ${severity}  ${code}  ${diagnostic.message}`,
        style: severityStyle(diagnostic.severity)
      });
    }
  }
  rows.push({
    text: `Linted ${result.results.length} file(s): ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    style: result.errorCount > 0
      ? { color: 'red', bold: true }
      : result.warningCount > 0
        ? { color: 'yellow', bold: true }
        : { color: 'green', bold: true }
  });
  return rows;
}

function displayDiagnostics(file: LintResult): DisplayDiagnostic[] {
  const diagnostics: DisplayDiagnostic[] = [
    ...file.errors.map(diagnostic => ({
      code: diagnostic.code,
      severity: 'error' as const,
      message: diagnostic.message,
      filePath: diagnostic.filePath,
      line: diagnostic.line,
      column: diagnostic.column
    })),
    ...file.warnings.map(diagnostic => ({
      code: diagnostic.code,
      severity: 'warning' as const,
      message: diagnostic.message,
      filePath: diagnostic.filePath,
      line: diagnostic.line,
      column: diagnostic.column
    }))
  ];
  if (diagnostics.length > 0) {
    return diagnostics;
  }
  return file.diagnostics.map(diagnostic => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    filePath: diagnostic.filePath,
    line: 0,
    column: diagnostic.start
  }));
}

function locOf(diagnostic: DisplayDiagnostic): string {
  return diagnostic.line > 0
    ? `${diagnostic.line}:${diagnostic.column}`
    : String(diagnostic.column);
}

function severityStyle(severity: DiagnosticSeverityName): TextStyle {
  if (severity === 'error') {
    return { color: 'red' };
  }
  if (severity === 'warning') {
    return { color: 'yellow' };
  }
  return { color: 'brightBlack' };
}

function terminalWidth(): number {
  return typeof process.stdout.columns === 'number' && process.stdout.columns > 0
    ? process.stdout.columns
    : 100;
}

function displayPath(cwd: string, filePath: string): string {
  const relativePath = path.relative(cwd, filePath);
  return relativePath.startsWith('..') || path.isAbsolute(relativePath)
    ? filePath
    : relativePath;
}

function linkIfEnabled(
  enabled: boolean,
  filePath: string | undefined,
  label: string,
  line?: number,
  column?: number
): string {
  if (!enabled || !filePath) {
    return label;
  }
  const resolved = path.resolve(filePath);
  const suffix = line && column ? `:${line}:${column}` : '';
  return `\x1b]8;;vscode://file/${resolved}${suffix}\x1b\\${label}\x1b]8;;\x1b\\`;
}
