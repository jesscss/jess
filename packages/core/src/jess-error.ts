// errors.ts
import path from 'node:path';
import chalk from 'chalk';
import { type IRecognitionException, type ILexingResult } from '@chevrotain/types';
import type { TreeContext } from './context.js';
import type { OptionalLocation } from './tree/node.js';
import type { Deprecation } from './deprecation.js';

type JessFile = TreeContext['file'];

/** Minimal shape for passing context and a node to helpers. */
export type TreeContextLike = { file: JessFile };

/** Node type carrying a `location` (full span, empty tuple, or unset). */
export type LocNode = { location?: OptionalLocation };

type Phase = 'parse' | 'resolve' | 'import' | 'eval' | 'extend' | 'plugin';
type Severity = 'error' | 'warn';

/**
 * Normalized error format for all phases (lexing, parsing, evaluation).
 * This is the format returned by safeParse/safeRender methods.
 */
export interface ErrorDiagnostic {
  code: string;
  phase: Phase;
  message: string;
  reason: string;
  fix: string;
  note?: string;

  // File location information
  file?: {
    name: string;
    path: string;
    fullPath: string;
    source?: string;
  };
  filePath?: string;
  line: number;
  column: number;
  /**
   * Relevant source lines for code frame display.
   * Keys are line numbers (1-indexed), values are the line content.
   * Includes the error line and context lines (before/after).
   * Example: { 55: 'before line', 56: 'error line', 57: 'after line' }
   */
  lines?: Record<number, string>;

  // Raw error data (for parser/lexer errors)
  errors?: IRecognitionException[];
  lexerErrors?: ILexingResult['errors'];
}

/**
 * Normalized warning format for all phases (lexing, parsing, evaluation).
 * This is the format returned by safeParse/safeRender methods.
 */
export interface WarningDiagnostic {
  code: string;
  phase: Phase;
  message: string;
  reason: string;
  fix: string;
  note?: string;

  // File location information
  file?: {
    name: string;
    path: string;
    fullPath: string;
    // Note: source is NOT included - use 'lines' property for code frame display
  };
  filePath?: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  /**
   * Relevant source lines for code frame display.
   * Keys are line numbers (1-indexed), values are the line content.
   * Includes the warning line and context lines (before/after).
   * Example: { 55: 'before line', 56: 'warning line', 57: 'after line' }
   */
  lines?: Record<number, string>;
}

/**
 * Initialization bag for a diagnostic.
 * Prefer passing `ctx` + `node` so file/line/column/source are auto-wired.
 * If those aren’t available, provide `filePath`/`source`/`line`/`column` directly.
 */
export type JessErrorInit = {
  severity?: Severity;
  code: string;
  phase: Phase;

  /** Optional: auto-wire file/line/col/source from compiler context + node */
  ctx?: TreeContextLike;
  node?: LocNode;

  /** Manual overrides if ctx/node aren’t provided */
  filePath?: string;
  source?: string;
  line?: number;
  column?: number;

  /** Interpolation values for the selected template */
  meta?: Record<string, unknown>;

  /** Optional overrides for the template’s strings */
  summary?: string;
  reason?: string;
  fix?: string;

  /** Optional one-liner for extra context */
  note?: string;

  /** Optional overrides for the template’s strings */
  errors?: IRecognitionException[];
  lexerErrors?: ILexingResult['errors'];
};

/* =========================
 * Template registry
 * ========================= */

/**
 * Template record for codes.
 * Keep these short and actionable. Use `${placeholders}` for meta fields.
 */
type Template = { summary: string; reason: string; fix: string };

/* eslint-disable @typescript-eslint/naming-convention */
const TEMPLATES = {
  // Parse/Lex
  'parse/unexpected-token': {
    summary: 'Unexpected token',
    reason: 'Token "${token}" is not valid here.',
    fix: 'Check for a missing quote/comma or wrong operator.'
  },
  'parse/unterminated-string': {
    summary: 'Unterminated string',
    reason: 'Missing closing quote.',
    fix: 'Close the string, e.g. url("hero.jpg").'
  },
  'parse/unexpected-syntax': {
    summary: 'Unexpected syntax',
    reason: 'Expected ${expected}, got ${got}.',
    fix: 'Add the expected token or remove the unexpected one.'
  },
  'parse/syntax-error': {
    summary: 'Syntax error',
    reason: '${message}',
    fix: 'Check surrounding tokens near this location.'
  },

  // Resolve/Import
  'resolve/name-not-found': {
    summary: 'Name not found',
    reason: 'Symbol "${symbol}" is undefined in this scope.',
    fix: 'Define "${symbol}" or import a file that provides it.'
  },
  'import/circular-compose': {
    summary: 'Circular @-compose detected',
    reason: '${chain}',
    fix: 'Break the cycle (extract shared bits and compose that).'
  },

  // Eval
  'eval/bad-call-arity': {
    summary: 'Bad call: wrong arity',
    reason: '${callee} expects ${expectedCount} args, got ${gotCount}.',
    fix: 'Add/remove arguments to match the signature.'
  },
  'eval/type-mismatch': {
    summary: 'Type mismatch',
    reason: '${callee} expects ${expected}, got ${got}.',
    fix: 'Pass a ${expected}; convert or choose a compatible value.'
  },

  // Extend
  'extend/protected-boundary': {
    summary: 'Extend blocked by protected boundary',
    reason: '"${target}" is defined behind a protected compose boundary.',
    fix: 'Move "${target}" to a shared file or create a local shim.'
  },
  'extend/not-found': {
    summary: 'Extend target "${target}" not found',
    reason: 'No ruleset found matching "${target}" in accessible extend roots.',
    fix: 'Ensure "${target}" exists and is accessible from the current extend root.'
  },
  'extend/not-accessible': {
    summary: 'Extend target "${target}" not accessible',
    reason: '"${target}" exists but is not accessible from the current extend root (blocked by at-rule or compose boundary).',
    fix: 'Move the extend or the target to a shared extend root, or use a different approach.'
  },

  // Plugin
  'plugin/unsupported-feature': {
    summary: 'Unsupported feature',
    reason: 'Plugin "${plugin}" does not implement ${feature}.',
    fix: 'Use a supported alternative or enable a fallback.'
  },

  // ---------- Warnings (examples you can expand) ----------
  'eval/deprecated': {
    summary: 'Deprecated feature',
    reason: '"${what}" is deprecated.',
    fix: 'Use "${use}" instead.'
  },
  'resolve/unused-variable': {
    summary: 'Unused variable',
    reason: '"${symbol}" is declared but its value is never used.',
    fix: 'Remove it or prefix with "_" to silence.'
  },
  'selector/duplicate': {
    summary: 'Duplicate selector',
    reason: 'Selector "${selector}" is defined multiple times.',
    fix: 'Consolidate rules or remove the duplicate.'
  }
} satisfies Record<string, Template>;
/* eslint-enable @typescript-eslint/naming-convention */

export type JessErrorCode = keyof typeof TEMPLATES;

export function isJessErrorCode(code: string): code is JessErrorCode {
  return Object.hasOwn(TEMPLATES, code);
}

/**
 * Replaces `${key}` with values from `meta`. Unset keys render as `<key>`.
 */
function interpolate(s: string, meta: Record<string, unknown>): string {
  return s.replace(/\$\{(\w+)\}/g, (_: string, k: string) => String(meta[k] ?? `<${k}>`));
}

/* =========================
 * OSC-8 hyperlinks
 * ========================= */

function osc8(uri: string, label: string): string {
  return `\x1b]8;;${uri}\x1b\\${label}\x1b]8;;\x1b\\`;
}

function supportsLinks(): boolean {
  const tty = process.stderr.isTTY && process.env.TERM !== 'dumb';
  if (!tty) {
    return false;
  }
  return Boolean(
    process.env.TERM_PROGRAM === 'vscode'
    || process.env.ITERM_SESSION_ID
    || process.env.WT_SESSION
  );
}

function linkFor(abs: string, line: number, col: number, label: string): string {
  const uri = `vscode://file/${abs}:${line}:${col}`;
  return supportsLinks() ? osc8(uri, label) : label;
}

/* =========================
 * Path labeling (human-short)
 * ========================= */

function trail(p: string, n: number): string {
  const parts = p.split(path.sep).filter(Boolean);
  return (parts.length <= n ? parts : ['…', ...parts.slice(parts.length - n)]).join(path.sep);
}

function prettyLabel(abs: string, line: number, col: number): string {
  const rel = path.relative(process.cwd(), abs);
  const shown = (!rel.startsWith('..') && !path.isAbsolute(rel)) ? rel : trail(abs, 3);
  return `${shown}:${line}:${col}`;
}

/* =========================
 * Code-frame utilities
 * ========================= */

function buildLineStarts(src: string): Uint32Array {
  const starts: number[] = [0];
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 10) {
      starts.push(i + 1);
    } else if (ch === 13) {
      if (src.charCodeAt(i + 1) === 10) {
        i++;
      }
      starts.push(i + 1);
    }
  }
  return Uint32Array.from(starts);
}

/**
 * Extracts relevant source lines for code frame display.
 * Returns an object with line numbers as keys (1-indexed) and line content as values.
 * Includes the target line and context lines (before/after).
 * @param source - Full source code
 * @param line - Target line number (1-indexed)
 * @param contextLines - Number of context lines before/after (default: 1)
 * @returns Object with line numbers as keys, e.g. { 55: 'before', 56: 'error', 57: 'after' }
 */
export function extractRelevantLines(
  source: string | undefined,
  line: number,
  contextLines: number = 1
): Record<number, string> | undefined {
  if (!source) {
    return undefined;
  }

  // Split source into lines once
  const lines = source.split(/\r?\n/);
  const totalLines = lines.length;
  const targetLine = Math.max(1, Math.min(line, totalLines));

  // Calculate line range (1-indexed)
  const startLine = Math.max(1, targetLine - contextLines);
  const endLine = Math.min(totalLines, targetLine + contextLines);

  // Extract relevant lines
  const result: Record<number, string> = {};
  for (let i = startLine; i <= endLine; i++) {
    result[i] = lines[i - 1]!; // Convert to 0-indexed for array access
  }

  return result;
}

function ensureLineStarts(file: JessFile): Uint32Array | undefined {
  if (!file?.source) {
    return undefined;
  }
  // Your file type may already have `lines`; if not, store it there.
  if (!file.lines) {
    file.lines = buildLineStarts(file.source);
  }

  return file.lines as Uint32Array;
}

function getLine(file: JessFile, line: number): string {
  const src = file?.source;
  const idx = ensureLineStarts(file);
  if (!src || !idx || line < 1 || line > idx.length) {
    return '';
  }
  const start = idx[line - 1];
  const end = line < idx.length ? idx[line]! - 1 : src.length;
  const last = src.charCodeAt(end - 1);
  const realEnd = last === 13 ? end - 1 : end; // trim trailing \r
  return src.slice(start, realEnd);
}

function codeFrameFromFile(file: JessFile, line = 1, col = 1): string {
  if (!file?.source) {
    return '';
  }

  ensureLineStarts(file);

  const width = String(line).length;
  const num = (n: number) => String(n).padStart(width, ' ');
  const caret = ' '.repeat(Math.max(0, col - 1)) + '^';

  const prev = getLine(file, line - 1);
  const curr = getLine(file, line);
  const next = getLine(file, line + 1);

  let out = '';
  if (prev) {
    out += chalk.gray(`${num(line - 1)} | ${prev}\n`);
  }
  out += chalk.bold(`${num(line)} | ${curr}\n`);
  out += chalk.gray(` ${' '.repeat(width)} | `) + chalk.red(caret) + '\n';
  if (next) {
    out += chalk.gray(`${num(line + 1)} | ${next}\n`);
  }
  return out;
}

/* =========================
 * Diagnostic (error or warn)
 * ========================= */

export class JessError extends Error {
  severity: Severity = 'error';
  code: keyof typeof TEMPLATES = 'parse/syntax-error';
  phase: Phase = 'parse';

  // Resolved source context (fileObj preferred; filePath is legacy)
  fileObj?: JessFile;
  filePath?: string;
  line = 1;
  column = 1;
  source?: string;
  node?: LocNode; // Store node to extract endLine/endColumn

  reason = '';
  fix = '';
  note?: string;

  errors?: IRecognitionException[];
  lexerErrors?: ILexingResult['errors'];

  constructor(init: JessErrorInit) {
    // Resolve context from ctx/node first, else from explicit fields.
    const fileObj = init.ctx?.file;
    const abs = fileObj?.fullPath ?? init.filePath;
    const line = init.node?.location?.[1] ?? init.line ?? 1;
    const column = init.node?.location?.[2] ?? init.column ?? 1;
    const source = fileObj?.source ?? init.source;

    const code = isJessErrorCode(init.code) ? init.code : 'parse/syntax-error';
    const meta = init.meta ?? {};
    const t = TEMPLATES[code];

    const summary = init.summary ?? interpolate(t.summary, meta);
    const reason = init.reason ?? interpolate(t.reason, meta);
    const fix = init.fix ?? interpolate(t.fix, meta);

    super(summary);

    this.name = 'JessError';
    this.severity = init.severity ?? 'error';
    this.code = code;
    this.phase = init.phase;

    this.fileObj = fileObj;
    this.filePath = abs;
    this.line = line;
    this.column = column;
    this.source = source;
    this.node = init.node; // Store node for endLine/endColumn extraction

    this.reason = reason;
    this.fix = fix;
    this.note = init.note;

    this.errors = init.errors;
    this.lexerErrors = init.lexerErrors;
  }

  /** Lightweight JSON for serializers (e.g. Vitest). Strips heavy Chevrotain token trees and full source. */
  toJSON() {
    return {
      severity: this.severity,
      code: this.code,
      phase: this.phase,
      fileObj: this.fileObj
        ? { name: this.fileObj.name, path: this.fileObj.path, fullPath: this.fileObj.fullPath }
        : undefined,
      filePath: this.filePath,
      reason: this.reason,
      fix: this.fix,
      note: this.note,
      errors: this.errors?.map(e => ({ message: e.message, stack: e.stack })),
      lexerErrors: this.lexerErrors?.map(e => ({ message: e.message, line: e.line, column: e.column }))
    };
  }

  /** Pretty, clickable string for terminal/Problems panel. */
  override toString(): string {
    const abs = this.fileObj?.fullPath ?? this.filePath;
    const l = this.line ?? 1;
    const c = this.column ?? 1;
    const label = abs ? prettyLabel(abs, l, c) : '(unknown)';
    const clickable = abs ? linkFor(abs, l, c, label) : label;

    const color = this.severity === 'warn' ? chalk.yellow : chalk.red;

    const header =
      `${color(this.severity)} ${color(this.code)} `
      + `${chalk.gray(`[${this.phase}]`)} ${chalk.cyan(clickable)} `
      + `${chalk.white('— ' + this.message)}`;

    let frame = '';
    if (this.fileObj?.source) {
      frame = codeFrameFromFile(this.fileObj, l, c);
    } else if (this.source) {
      // Legacy, slower fallback
      const lines = this.source.split(/\r?\n/);
      const prev = lines[l - 2];
      const curr = lines[l - 1] ?? '';
      const next = lines[l];
      const width = String(l).length;
      const num = (n: number) => String(n).padStart(width, ' ');
      const caret = ' '.repeat(Math.max(0, c - 1)) + '^';
      if (prev) {
        frame += chalk.gray(`${num(l - 1)} | ${prev}\n`);
      }
      frame += chalk.bold(`${num(l)} | ${curr}\n`);
      frame += chalk.gray(` ${' '.repeat(width)} | `) + chalk.red(caret) + '\n';
      if (next) {
        frame += chalk.gray(`${num(l + 1)} | ${next}\n`);
      }
    }

    const out = [
      header,
      frame && frame.trimEnd(),
      '',
      `Reason: ${this.reason}`,
      `Fix: ${this.fix}`,
      this.note ? `Note: ${this.note}` : undefined,
      (!supportsLinks() && abs) ? chalk.dim(`Path: ${abs}:${l}:${c}`) : undefined
    ]
      .filter(Boolean)
      .join('\n');

    return out;
  }
}

/* =========================
 * Printing helpers
 * ========================= */

// eslint-disable-next-line @typescript-eslint/naming-convention
const _seen = new Set<string>();

/**
 * Emits a diagnostic to stderr (or a custom stream).
 * Set `dedupe: true` to suppress repeats from the same location/message.
 */
export function emit(diag: JessError, opts?: { stream?: NodeJS.WriteStream; dedupe?: boolean }): void {
  const stream = opts?.stream ?? process.stderr;
  if (opts?.dedupe) {
    const abs = diag.fileObj?.fullPath ?? diag.filePath ?? '';
    const key = `${diag.severity}|${diag.code}|${abs}|${diag.line}|${diag.column}|${diag.message}`;
    if (_seen.has(key)) {
      return;
    }
    _seen.add(key);
  }
  stream.write(String(diag) + '\n');
}

/** Clears the in-process de-duplication set. Useful for tests. */
export function resetDedupe(): void {
  _seen.clear();
}

/* =========================
 * Factories / Public API
 * ========================= */

export function makeJessError(init: JessErrorInit): JessError {
  return new JessError(init);
}

type Common = {
  ctx?: TreeContextLike;
  node?: LocNode;

  filePath?: string;
  source?: string;
  line?: number;
  column?: number;

  note?: string;
  summary?: string;
  reason?: string;
  fix?: string;
  severity?: Severity;

  meta?: Record<string, unknown>;
};

/**
 * Primary **error** helpers.
 * Each function returns a `JessError` ready to be thrown or emitted.
 */
export const ERR = {
  // Parse/Lex
  unexpectedToken(args: Common & { meta: { token: string } }) {
    return makeJessError({ code: 'parse/unexpected-token', phase: 'parse', ...args });
  },

  unterminatedString(args: Common = {}) {
    return makeJessError({ code: 'parse/unterminated-string', phase: 'parse', ...args });
  },

  // Resolve/Import
  nameNotFound(args: Common & { meta: { symbol: string } }) {
    return makeJessError({ code: 'resolve/name-not-found', phase: 'resolve', ...args });
  },

  circularCompose(args: Common & { meta: { chain: string } }) {
    return makeJessError({ code: 'import/circular-compose', phase: 'import', ...args });
  },

  // Eval
  arity(args: Common & { meta: { callee: string; expectedCount: number; gotCount: number } }) {
    return makeJessError({ code: 'eval/bad-call-arity', phase: 'eval', ...args });
  },

  typeMismatch(args: Common & { meta: { callee: string; expected: string; got: string } }) {
    return makeJessError({ code: 'eval/type-mismatch', phase: 'eval', ...args });
  },

  // Extend
  extendBoundary(args: Common & { meta: { target: string } }) {
    return makeJessError({ code: 'extend/protected-boundary', phase: 'extend', ...args });
  },

  extendNotFound(args: Common & { meta: { target: string } }) {
    return makeJessError({ code: 'extend/not-found', phase: 'extend', ...args });
  },

  extendNotAccessible(args: Common & { meta: { target: string } }) {
    return makeJessError({ code: 'extend/not-accessible', phase: 'extend', ...args });
  },

  // Plugin
  pluginUnsupported(args: Common & { meta: { plugin: string; feature: string } }) {
    return makeJessError({ code: 'plugin/unsupported-feature', phase: 'plugin', ...args });
  }
};

/**
 * Primary **warning** helpers.
 * Same API shape as `ERR`, but default `severity: 'warn'`.
 * Call `emit(WARN.*(...))` to log without throwing.
 */
export const WARN = {
  deprecated(args: Common & { meta: { what: string; use: string; deprecation?: Deprecation } }) {
    return makeJessError({ severity: 'warn', code: 'eval/deprecated', phase: 'eval', ...args });
  },

  unusedVar(args: Common & { meta: { symbol: string } }) {
    return makeJessError({ severity: 'warn', code: 'resolve/unused-variable', phase: 'resolve', ...args });
  },

  duplicateSelector(args: Common & { meta: { selector: string } }) {
    return makeJessError({ severity: 'warn', code: 'selector/duplicate', phase: 'extend', ...args });
  },

  extendNotFound(args: Common & { meta: { target: string } }) {
    return makeJessError({ severity: 'warn', code: 'extend/not-found', phase: 'extend', ...args });
  },

  extendNotAccessible(args: Common & { meta: { target: string } }) {
    return makeJessError({ severity: 'warn', code: 'extend/not-accessible', phase: 'extend', ...args });
  }
};

/* =========================
 * Chevrotain adapter
 * ========================= */

/**
 * Converts a Chevrotain parser/lexer error into a friendly diagnostic.
 * If you pass `ctx`, the error will be clickable and include a code-frame.
 *
 * @param errors Chevrotain recognition errors
 * @param lexerResult Chevrotain lexing result
 * @param filePath Absolute path to the file (legacy fallback)
 * @param source File contents (legacy fallback)
 * @param ctx Optional TreeContext to auto-fill file/line/col/source
 */
export function getErrorFromParser(
  errors: IRecognitionException[],
  lexerErrors: ILexingResult['errors'] | undefined,
  filePath: string,
  source: string,
  ctx?: TreeContextLike
): JessError {
  const error = lexerErrors?.[0] ?? errors[0];
  if (!error) {
    return new JessError({ code: 'parse/syntax-error', phase: 'parse', filePath, source, ctx });
  }

  const isLex = !('token' in error);

  const line =
    'token' in error
      ? error.token?.startLine
      : error.line;

  const column =
    'token' in error
      ? error.token?.startColumn
      : error.column;

  const message = error.message || '';

  let code: keyof typeof TEMPLATES = 'parse/syntax-error';
  let meta: Record<string, unknown> = {};

  if (isLex) {
    code = 'parse/unexpected-token';
    meta = { token: ('char' in error ? String(error.char) : undefined) ?? '/' };
  } else if (/unterminated|string not closed/i.test(message)) {
    code = 'parse/unterminated-string';
  } else if (/expecting/i.test(message)) {
    code = 'parse/unexpected-syntax';
    const m = message.match(/expecting\s+([^,]+).*?but found\s+'?([^']+)'?/i);
    meta = m ? { expected: m[1], got: m[2] } : { expected: 'token', got: 'other' };
  }

  return new JessError({
    code,
    phase: 'parse',
    meta,
    ctx,
    filePath,
    source,
    line: line ?? 1,
    column: column ?? 1,
    errors,
    lexerErrors
  });
}

/**
 * Converts a JessError to a normalized ErrorDiagnostic or WarningDiagnostic.
 * Extracts relevant source lines for code frame display.
 */
export function toDiagnostic(error: JessError): ErrorDiagnostic | WarningDiagnostic {
  // Extract relevant lines from source (error line + context)
  const lines = extractRelevantLines(error.source ?? error.fileObj?.source, error.line);

  // Extract endLine/endColumn from node location if available
  // Location format: [startOffset, startLine, startColumn, endOffset, endLine, endColumn]
  const nodeLocation = error.node?.location;
  const endLine = nodeLocation && nodeLocation.length >= 6
    ? nodeLocation[4]
    : undefined;
  const endColumn = nodeLocation && nodeLocation.length >= 6
    ? nodeLocation[5]
    : undefined;

  // Create file object without source (we only use 'lines' for code frames)
  const file = error.fileObj
    ? {
        name: error.fileObj.name,
        path: error.fileObj.path,
        fullPath: error.fileObj.fullPath
        // Explicitly exclude source - we use 'lines' property instead
      }
    : undefined;

  const base = {
    code: error.code,
    phase: error.phase,
    message: error.message,
    reason: error.reason,
    fix: error.fix,
    note: error.note,
    file,
    filePath: error.filePath,
    line: error.line,
    column: error.column,
    endLine,
    endColumn,
    lines
  };

  if (error.severity === 'error') {
    return {
      ...base,
      errors: error.errors,
      lexerErrors: error.lexerErrors
    } as ErrorDiagnostic;
  } else {
    return base as WarningDiagnostic;
  }
}
