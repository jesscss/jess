import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { Region, type LineContent, type TextStyle } from 'linecraft';
import {
  collectTolerantDiagnostics,
  type CssDiagnosticMetadata,
  defaultCssDiagnosticMetadata,
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
export type { CssDiagnosticMetadata } from '@jesscss/diagnostics-core';
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
  readonly metadata?: Partial<CssDiagnosticMetadata>;
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
    const ruleName = lintRuleNameForDiagnostic(code);
    if (ruleName !== undefined) {
      rules[ruleName] = severity;
    }
  }
  return rules;
}

function lintRuleNameForDiagnostic(code: string): string | undefined {
  const ruleName = ruleNameForDiagnostic(code);
  return ruleName === code ? undefined : ruleName;
}

/**
 * `Array.isArray` is declared as `arg is any[]`, which does not remove a
 * `readonly` tuple from the union on the false branch. This predicate narrows
 * both branches; the runtime check is unchanged.
 */
function isSettingTuple(
  setting: LintRuleSetting | LintSeverity | undefined
): setting is readonly [LintSeverity | null, LintRuleOptions?] {
  return Array.isArray(setting);
}

function settingSeverity(setting: LintRuleSetting | LintSeverity | undefined): LintSeverity | null | undefined {
  return isSettingTuple(setting) ? setting[0] : setting;
}

function settingOptions(setting: LintRuleSetting | undefined): LintRuleOptions | undefined {
  return Array.isArray(setting) ? setting[1] : undefined;
}

function normalizedValidProperties(config: LintConfig): Set<string> | null {
  const validProperties = config.validProperties;
  if (validProperties === undefined || validProperties.length === 0) {
    return null;
  }
  const names = new Set<string>();
  for (const property of validProperties) {
    const name = property.trim().toLowerCase();
    if (name.length > 0) {
      names.add(name);
    }
  }
  return names.size === 0 ? null : names;
}

function metadataForLintConfig(
  metadata: Partial<CssDiagnosticMetadata> | undefined,
  config: LintConfig
): Partial<CssDiagnosticMetadata> | undefined {
  const validProperties = normalizedValidProperties(config);
  if (validProperties === null) {
    return metadata;
  }
  return {
    ...metadata,
    isKnownProperty(name) {
      if (validProperties.has(name.toLowerCase())) {
        return true;
      }
      return metadata?.isKnownProperty?.(name) ?? defaultCssDiagnosticMetadata.isKnownProperty(name);
    }
  };
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

function notationRuleTarget(diagnostic: SourceDiagnostic, source: string): string | null {
  if (
    diagnostic.code === LINT_CODES.colorFunctionNotation
    || diagnostic.code === LINT_CODES.alphaValueNotation
    || diagnostic.code === LINT_CODES.hueDegreeNotation
  ) {
    return source.slice(diagnostic.start, diagnostic.end);
  }
  return null;
}

function notationRuleOption(options: LintRuleOptions | undefined): string | null {
  return typeof options?.notation === 'string' ? options.notation : null;
}

type SpecificityTuple = readonly [number, number, number];

function parseSpecificity(value: unknown): SpecificityTuple | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parts = value.split(',');
  if (parts.length !== 3) {
    return null;
  }
  const numbers = parts.map(part => Number(part.trim()));
  return numbers.every(number => Number.isInteger(number) && number >= 0)
    ? [numbers[0]!, numbers[1]!, numbers[2]!]
    : null;
}

function specificityFromDiagnostic(diagnostic: SourceDiagnostic): SpecificityTuple | null {
  for (const qualifier of diagnostic.qualifiers ?? []) {
    if (qualifier.startsWith('specificity:')) {
      return parseSpecificity(qualifier.slice('specificity:'.length));
    }
  }
  return null;
}

function maxSpecificityRuleOption(options: LintRuleOptions | undefined): SpecificityTuple | null {
  return parseSpecificity(options?.max) ?? parseSpecificity(options?.maxSpecificity);
}

function specificityAllowed(actual: SpecificityTuple, max: SpecificityTuple): boolean {
  return actual[0] < max[0]
    || (actual[0] === max[0] && (
      actual[1] < max[1]
      || (actual[1] === max[1] && actual[2] <= max[2])
    ));
}

function isAngleNotation(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.endsWith('deg')
    || lower.endsWith('grad')
    || lower.endsWith('rad')
    || lower.endsWith('turn');
}

function shouldSuppressByNotation(diagnostic: SourceDiagnostic, source: string, options: LintRuleOptions | undefined): boolean {
  const target = notationRuleTarget(diagnostic, source);
  if (target === null) {
    return false;
  }
  const notation = notationRuleOption(options);
  if (diagnostic.code === LINT_CODES.colorFunctionNotation) {
    return notation !== 'modern';
  }
  if (diagnostic.code === LINT_CODES.alphaValueNotation) {
    if (notation === 'percentage') {
      return target.endsWith('%');
    }
    if (notation === 'number') {
      return !target.endsWith('%');
    }
    return true;
  }
  if (diagnostic.code === LINT_CODES.hueDegreeNotation) {
    if (notation === 'angle') {
      return isAngleNotation(target);
    }
    if (notation === 'number') {
      return !isAngleNotation(target);
    }
    return true;
  }
  return false;
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
  if (diagnostic.code === LINT_CODES.selectorMaxSpecificity) {
    const actual = specificityFromDiagnostic(diagnostic);
    const max = maxSpecificityRuleOption(options);
    return actual === null || max === null || specificityAllowed(actual, max);
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
  if (shouldSuppressByNotation(diagnostic, source, options)) {
    return true;
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
    const ruleName = lintRuleNameForDiagnostic(diagnostic.code);
    const policy = (ruleName !== undefined ? config.rules?.[ruleName] : undefined)
      ?? config.diagnostics?.[diagnostic.code];
    const severityPolicy = settingSeverity(policy);
    if (severityPolicy === null || severityPolicy === 'off') {
      continue;
    }
    if (severityPolicy === undefined && diagnostic.phase !== 'parse') {
      continue;
    }
    const rulePolicy = ruleName !== undefined ? config.rules?.[ruleName] : undefined;
    if (shouldSuppressByRuleOptions(diagnostic, rulePolicy, source)) {
      continue;
    }
    out.push({
      ...diagnostic,
      ruleName,
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
  const metadata = metadataForLintConfig(options.metadata, lintConfig);
  const collected = collectTolerantDiagnostics({
    source: input.source,
    filePath: input.filePath,
    language,
    metadata
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
  const metadata = metadataForLintConfig(options.metadata, lintConfig);
  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    const language = languageFromPath(filePath, options.language);
    const collected = collectTolerantDiagnostics({ source, filePath, language, metadata });
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
