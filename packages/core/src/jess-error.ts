// errors.ts
import path from 'node:path';
import chalk from 'chalk';
import { type IRecognitionException, type ILexingError } from 'chevrotain';
import type { TreeContext } from './context';
import type { LocationInfo } from './tree/node';

type JessFile = TreeContext['file'];

/** Minimal shape for passing context and a node to helpers. */
export type TreeContextLike = { file: JessFile };

/** Node type carrying a `location` tuple. */
export type LocNode = { location?: LocationInfo };

type Phase = 'parse' | 'resolve' | 'import' | 'eval' | 'extend' | 'plugin';
type Severity = 'error' | 'warn';

/**
 * Initialization bag for a diagnostic.
 * Prefer passing `ctx` + `node` so file/line/column/source are auto-wired.
 * If those aren’t available, provide `filePath`/`source`/`line`/`column` directly.
 */
export type JessErrorInit = {
  severity?: Severity;
  code: keyof typeof TEMPLATES;
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
};

/* =========================
 * Template registry
 * ========================= */

/**
 * Template record for codes.
 * Keep these short and actionable. Use `${placeholders}` for meta fields.
 */
type Template = { summary: string; reason: string; fix: string };

const TEMPLATES = {
  // Parse/Lex
  JESS1001: {
    summary: 'Unexpected token',
    reason: 'Token "${token}" is not valid here.',
    fix: 'Check for a missing quote/comma or wrong operator.'
  },
  JESS1002: {
    summary: 'Unterminated string',
    reason: 'Missing closing quote.',
    fix: 'Close the string, e.g. url("hero.jpg").'
  },
  JESS1003: {
    summary: 'Unexpected syntax',
    reason: 'Expected ${expected}, got ${got}.',
    fix: 'Add the expected token or remove the unexpected one.'
  },
  JESS1000: {
    summary: 'Syntax error',
    reason: '${message}',
    fix: 'Check surrounding tokens near this location.'
  },

  // Resolve/Import
  JESS2101: {
    summary: 'Name not found',
    reason: 'Symbol "${symbol}" is undefined in this scope.',
    fix: 'Define "${symbol}" or import a file that provides it.'
  },
  JESS2202: {
    summary: 'Circular @-compose detected',
    reason: '${chain}',
    fix: 'Break the cycle (extract shared bits and compose that).'
  },

  // Eval
  JESS3103: {
    summary: 'Bad call: wrong arity',
    reason: '${callee} expects ${expectedCount} args, got ${gotCount}.',
    fix: 'Add/remove arguments to match the signature.'
  },
  JESS3104: {
    summary: 'Type mismatch',
    reason: '${callee} expects ${expected}, got ${got}.',
    fix: 'Pass a ${expected}; convert or choose a compatible value.'
  },

  // Extend
  JESS3201: {
    summary: 'Extend blocked by protected boundary',
    reason: '"${target}" is defined behind a protected compose boundary.',
    fix: 'Move "${target}" to a shared file or create a local shim.'
  },

  // Plugin
  JESS5102: {
    summary: 'Unsupported feature',
    reason: 'Plugin "${plugin}" does not implement ${feature}.',
    fix: 'Use a supported alternative or enable a fallback.'
  },

  // ---------- Warnings (examples you can expand) ----------
  JESS4101: {
    summary: 'Deprecated feature',
    reason: '"${what}" is deprecated.',
    fix: 'Use "${use}" instead.'
  },
  JESS4201: {
    summary: 'Unused variable',
    reason: '"${symbol}" is declared but its value is never used.',
    fix: 'Remove it or prefix with "_" to silence.'
  },
  JESS4202: {
    summary: 'Duplicate selector',
    reason: 'Selector "${selector}" is defined multiple times.',
    fix: 'Consolidate rules or remove the duplicate.'
  }
} satisfies Record<string, Template>;

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
  code: keyof typeof TEMPLATES = 'JESS1000';
  phase: Phase = 'parse';

  // Resolved source context (fileObj preferred; filePath is legacy)
  fileObj?: JessFile;
  filePath?: string;
  line = 1;
  column = 1;
  source?: string;

  reason = '';
  fix = '';
  note?: string;

  constructor(init: JessErrorInit) {
    // Resolve context from ctx/node first, else from explicit fields.
    const fileObj = init.ctx?.file;
    const abs = fileObj?.fullPath ?? init.filePath;
    const line = init.node?.location?.[1] ?? init.line ?? 1;
    const column = init.node?.location?.[2] ?? init.column ?? 1;
    const source = fileObj?.source ?? init.source;

    const meta = init.meta ?? {};
    const t = TEMPLATES[init.code] ?? TEMPLATES.JESS1000;

    const summary = init.summary ?? interpolate(t.summary, meta);
    const reason = init.reason ?? interpolate(t.reason, meta);
    const fix = init.fix ?? interpolate(t.fix, meta);

    super(summary);

    this.name = 'JessError';
    this.severity = init.severity ?? 'error';
    this.code = init.code;
    this.phase = init.phase;

    this.fileObj = fileObj;
    this.filePath = abs;
    this.line = line;
    this.column = column;
    this.source = source;

    this.reason = reason;
    this.fix = fix;
    this.note = init.note;
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
    return makeJessError({ code: 'JESS1001', phase: 'parse', ...args });
  },

  unterminatedString(args: Common = {}) {
    return makeJessError({ code: 'JESS1002', phase: 'parse', ...args });
  },

  // Resolve/Import
  nameNotFound(args: Common & { meta: { symbol: string } }) {
    return makeJessError({ code: 'JESS2101', phase: 'resolve', ...args });
  },

  circularCompose(args: Common & { meta: { chain: string } }) {
    return makeJessError({ code: 'JESS2202', phase: 'import', ...args });
  },

  // Eval
  arity(args: Common & { meta: { callee: string; expectedCount: number; gotCount: number } }) {
    return makeJessError({ code: 'JESS3103', phase: 'eval', ...args });
  },

  typeMismatch(args: Common & { meta: { callee: string; expected: string; got: string } }) {
    return makeJessError({ code: 'JESS3104', phase: 'eval', ...args });
  },

  // Extend
  extendBoundary(args: Common & { meta: { target: string } }) {
    return makeJessError({ code: 'JESS3201', phase: 'extend', ...args });
  },

  // Plugin
  pluginUnsupported(args: Common & { meta: { plugin: string; feature: string } }) {
    return makeJessError({ code: 'JESS5102', phase: 'plugin', ...args });
  }
};

/**
 * Primary **warning** helpers.
 * Same API shape as `ERR`, but default `severity: 'warn'`.
 * Call `emit(WARN.*(...))` to log without throwing.
 */
export const WARN = {
  deprecated(args: Common & { meta: { what: string; use: string } }) {
    return makeJessError({ severity: 'warn', code: 'JESS4101', phase: 'eval', ...args });
  },

  unusedVar(args: Common & { meta: { symbol: string } }) {
    return makeJessError({ severity: 'warn', code: 'JESS4201', phase: 'resolve', ...args });
  },

  duplicateSelector(args: Common & { meta: { selector: string } }) {
    return makeJessError({ severity: 'warn', code: 'JESS4202', phase: 'extend', ...args });
  }
};

/* =========================
 * Chevrotain adapter
 * ========================= */

/**
 * Converts a Chevrotain parser/lexer error into a friendly diagnostic.
 * If you pass `ctx`, the error will be clickable and include a code-frame.
 *
 * @param error Chevrotain recognition or lexing error
 * @param filePath Absolute path to the file (legacy fallback)
 * @param source File contents (legacy fallback)
 * @param ctx Optional TreeContext to auto-fill file/line/col/source
 */
export function getErrorFromParser(
  error: IRecognitionException | ILexingError,
  filePath: string,
  source: string,
  ctx?: TreeContextLike
): JessError {
  const isLex =
    (error as any).name === 'LexerError'
    || ('token' in error && (error as any).lexer);

  const line =
    'token' in error
      ? error.token?.startLine ?? (error as any).line
      : (error as any).line;

  const column =
    'token' in error
      ? error.token?.startColumn ?? (error as any).column
      : (error as any).column;

  const message = (error as any).message || '';

  let code: keyof typeof TEMPLATES = 'JESS1000';
  let meta: Record<string, unknown> = {};

  if (isLex) {
    code = 'JESS1001';
    meta = { token: (error as any).char ?? '/' };
  } else if (/unterminated|string not closed/i.test(message)) {
    code = 'JESS1002';
  } else if (/expecting/i.test(message)) {
    code = 'JESS1003';
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
    column: column ?? 1
  });
}
