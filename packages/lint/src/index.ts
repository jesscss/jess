import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { Region, type LineContent, type TextStyle } from 'linecraft';
import {
  collectTolerantDiagnostics,
  type DiagnosticSeverityName,
  type JessLanguage,
  LINT_CODES,
  type SourceDiagnostic
} from '@jesscss/diagnostics-core';
import {
  type ErrorDiagnostic,
  type WarningDiagnostic
} from '@jesscss/core';
import type {
  LintConfig,
  LintRuleOptions,
  LintRuleSetting,
  LintSeverity,
  StylesConfig
} from 'styles-config';
import { loadConfig, loadConfigFromPath } from 'styles-config';
import {
  RECOMMENDED_LINT_CONFIG,
  ruleNameForDiagnostic
} from './rules.js';

export type { LintConfig, LintRuleOptions, LintRuleSetting, LintSeverity };
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
  readonly ruleName?: string;
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

interface DisplayDiagnostic {
  readonly code: string;
  readonly ruleName?: string;
  readonly severity: DiagnosticSeverityName;
  readonly message: string;
  readonly filePath?: string;
  readonly line: number;
  readonly column: number;
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

function settingSeverity(setting: LintRuleSetting | LintSeverity | undefined): LintSeverity | null | undefined {
  return Array.isArray(setting) ? setting[0] : setting;
}

function settingOptions(setting: LintRuleSetting | undefined): LintRuleOptions | undefined {
  return Array.isArray(setting) ? setting[1] : undefined;
}

function ignoresRuleOption(options: LintRuleOptions | undefined, value: string): boolean {
  return options?.ignore?.includes(value) === true;
}

function includesRuleOption(options: LintRuleOptions | undefined, value: string): boolean {
  return options?.include?.includes(value) === true;
}

function patternRuleTarget(diagnostic: SourceDiagnostic, source: string): string | null {
  const raw = source.slice(diagnostic.start, diagnostic.end);
  if (diagnostic.code === LINT_CODES.selectorClassPattern) {
    return raw.startsWith('.') ? raw.slice(1) : raw;
  }
  if (
    diagnostic.code === LINT_CODES.customPropertyPattern
    || diagnostic.code === LINT_CODES.keyframesNamePattern
  ) {
    return raw;
  }
  return null;
}

function patternRuleOption(options: LintRuleOptions | undefined): RegExp | null {
  const pattern = options?.pattern;
  if (pattern instanceof RegExp) {
    return pattern;
  }
  if (typeof pattern === 'string') {
    try {
      return new RegExp(pattern);
    } catch {
      return null;
    }
  }
  return null;
}

function hasQualifier(diagnostic: SourceDiagnostic, value: string): boolean {
  return diagnostic.qualifiers?.includes(value) === true;
}

function shouldSuppressByRuleOptions(
  diagnostic: SourceDiagnostic,
  setting: LintRuleSetting | undefined,
  source: string
): boolean {
  const options = settingOptions(setting);
  if (diagnostic.code === LINT_CODES.duplicateProperties) {
    return ignoresRuleOption(options, 'consecutive-duplicates')
      && hasQualifier(diagnostic, 'consecutive-duplicate');
  }
  if (diagnostic.code === LINT_CODES.emptyRules && hasQualifier(diagnostic, 'mixin-body')) {
    return !includesRuleOption(options, 'mixins');
  }
  const patternTarget = patternRuleTarget(diagnostic, source);
  if (patternTarget !== null) {
    const pattern = patternRuleOption(options);
    if (pattern === null) {
      return true;
    }
    pattern.lastIndex = 0;
    return pattern.test(patternTarget);
  }
  return false;
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

function applyPolicy(
  diagnostics: readonly SourceDiagnostic[],
  source: string,
  config: LintConfig,
  options: LintOptions
): LintDiagnostic[] {
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
    const severityPolicy = settingSeverity(policy);
    if (severityPolicy === null || severityPolicy === 'off') {
      continue;
    }
    if (severityPolicy === undefined && diagnostic.phase !== 'parse') {
      continue;
    }
    const rulePolicy = config.rules?.[ruleNameForDiagnostic(diagnostic.code)]
      ?? config.rules?.[diagnostic.code];
    if (shouldSuppressByRuleOptions(diagnostic, rulePolicy, source)) {
      continue;
    }
    const ruleName = ruleNameForDiagnostic(diagnostic.code);
    out.push({
      ...diagnostic,
      ruleName: ruleName === diagnostic.code ? undefined : ruleName,
      severity: severityPolicy === 'error'
        ? 'error'
        : severityPolicy === 'warn'
          ? 'warning'
          : diagnostic.defaultSeverity
    });
  }
  return out;
}

function toErrorDiagnostic(diagnostic: LintDiagnostic): ErrorDiagnostic {
  return {
    code: diagnostic.code,
    phase: diagnostic.phase,
    message: diagnostic.message,
    reason: diagnostic.reason,
    fix: diagnostic.fix,
    filePath: diagnostic.filePath,
    line: diagnostic.line ?? 1,
    column: diagnostic.column ?? 1,
    endLine: diagnostic.endLine,
    endColumn: diagnostic.endColumn
  };
}

function toWarningDiagnostic(diagnostic: LintDiagnostic): WarningDiagnostic {
  return {
    code: diagnostic.code,
    phase: diagnostic.phase,
    message: diagnostic.message,
    reason: diagnostic.reason,
    fix: diagnostic.fix,
    filePath: diagnostic.filePath,
    line: diagnostic.line ?? 1,
    column: diagnostic.column ?? 1,
    endLine: diagnostic.endLine,
    endColumn: diagnostic.endColumn
  };
}

function toLintResult(
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

  const errors: ErrorDiagnostic[] = [];
  const warnings: WarningDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') {
      errors.push(toErrorDiagnostic(diagnostic));
    } else {
      warnings.push(toWarningDiagnostic(diagnostic));
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
    input.filePath,
    applyPolicy(collected.diagnostics, input.source, lintConfig, options),
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
      filePath,
      applyPolicy(collected.diagnostics, source, lintConfig, options),
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
    const codeWidth = Math.max(...diagnostics.map(diagnostic => displayCode(diagnostic).length));
    for (const diagnostic of diagnostics) {
      const loc = locOf(diagnostic).padStart(locWidth);
      const severity = diagnostic.severity.padEnd(severityWidth);
      const code = displayCode(diagnostic).padEnd(codeWidth);
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
  if (file.diagnostics.length > 0) {
    return file.diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      ruleName: diagnostic.ruleName,
      severity: diagnostic.severity,
      message: diagnostic.message,
      filePath: diagnostic.filePath,
      line: diagnostic.line ?? 0,
      column: diagnostic.column ?? diagnostic.start
    }));
  }

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
  return [];
}

function displayCode(diagnostic: DisplayDiagnostic): string {
  return diagnostic.ruleName ?? diagnostic.code;
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
