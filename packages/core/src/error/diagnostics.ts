import { type IRecognitionException, type ILexingError, type ILexingResult } from 'chevrotain';
import type { Deprecation } from '../deprecation.js';
import { type JessErrorCode, type Phase, isJessErrorCode } from './codes.js';
import { lineColAt, extractRelevantLines } from './code-frame.js';
import { JessError, inlineSpanEnd, type JessErrorInit, type LocNode, type TreeContextLike } from './jess-error.js';

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
   * Relevant source lines for code frame display, keyed by 1-indexed line number
   * (error line + before/after context), e.g. `{ 55: 'before', 56: 'err', 57: 'after' }`.
   */
  lines?: Record<number, string>;

  // Raw error data (for parser/lexer errors)
  errors?: ReadonlyArray<IRecognitionException | JessError>;
  lexerErrors?: ILexingResult['errors'];
}

/**
 * The fact shape exposed by a direct parser when Parseman cannot produce the
 * requested document. `offset` stays an internal recognition fact: the public
 * diagnostic boundary derives the user-facing line, column, and code frame
 * from the source that the plugin already owns.
 */
export interface ParserFailure {
  readonly code?: 'parse/syntax-error' | 'parse/dynamic-charset';
  readonly offset: number;
  readonly expected?: readonly string[];
}

export type ParserDiagnosticOptions = {
  dialect: string;
  error: unknown;
  filePath: string;
  source: string;
};

function parserFailureFrom(error: unknown): ParserFailure | undefined {
  if (typeof error !== 'object' || error === null || !('offset' in error)) {
    return undefined;
  }
  const offset = error.offset;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) {
    return undefined;
  }
  const expected =
    'expected' in error && Array.isArray(error.expected)
      ? error.expected.filter((value): value is string => typeof value === 'string')
      : undefined;
  const code = 'code' in error && (
    error.code === 'parse/syntax-error' || error.code === 'parse/dynamic-charset'
  )
    ? error.code
    : undefined;
  return { code, offset, expected };
}

/**
 * Convert a direct-parser failure into the compiler's source-backed diagnostic
 * contract. Parser packages expose recognition facts only; plugins call this
 * once with their source so every public parse diagnostic has a 1-based site
 * and a code frame.
 */
export function parserDiagnostic({ dialect, error, filePath, source }: ParserDiagnosticOptions): ErrorDiagnostic {
  const failure = parserFailureFrom(error);
  const offset = Math.max(0, Math.min(source.length, failure?.offset ?? 0));
  const { line, column } = lineColAt(source, offset);
  const message = error instanceof Error ? error.message : `${dialect} parser error.`;
  const expected = failure?.expected;
  return {
    code: failure?.code ?? 'parse/syntax-error',
    phase: 'parse',
    message,
    reason: expected && expected.length > 0
      ? `The parser expected ${expected.join(', ')}.`
      : 'The parser could not continue at this source location.',
    fix: `Check the ${dialect} source against the supported grammar.`,
    file: { name: filePath, path: filePath, fullPath: filePath, source },
    filePath,
    line,
    column,
    lines: extractRelevantLines(source, line)
  };
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
  /** Relevant source lines for code frame display (see `ErrorDiagnostic.lines`). */
  lines?: Record<number, string>;
}

/* =========================
 * Factories
 * ========================= */

export function makeJessError(init: JessErrorInit): JessError {
  return new JessError(init);
}

export function makeJessErrorFromDiagnostic(diagnostic: ErrorDiagnostic): JessError {
  const code = isJessErrorCode(diagnostic.code) ? diagnostic.code : 'parse/syntax-error';
  return new JessError({
    code,
    phase: diagnostic.phase,
    severity: 'error',
    summary: diagnostic.message,
    ctx: diagnostic.file ? { file: diagnostic.file } : undefined,
    filePath: diagnostic.filePath,
    source: diagnostic.file?.source,
    line: diagnostic.line,
    column: diagnostic.column,
    reason: diagnostic.reason,
    fix: diagnostic.fix,
    note: diagnostic.note,
    errors: diagnostic.errors,
    lexerErrors: diagnostic.lexerErrors
  });
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
  severity?: JessErrorInit['severity'];

  meta?: Record<string, unknown>;
};

/**
 * Primary **error** helpers. Each returns a `JessError` ready to throw or emit.
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
  invalidFunction(args: Common & { meta: { name: string; reason: string } }) {
    return makeJessError({ code: 'eval/invalid-function', phase: 'eval', ...args });
  },
  invalidStatement(args: Common & { meta: { what: string } }) {
    return makeJessError({ code: 'eval/invalid-statement', phase: 'eval', ...args });
  },
  ambiguousDefault(args: Common & { meta: { callee: string } }) {
    return makeJessError({ code: 'eval/ambiguous-default', phase: 'eval', ...args });
  },
  propertyInRoot(args: Common & { meta: { what: string } }) {
    return makeJessError({ code: 'eval/property-in-root', phase: 'eval', ...args });
  },
  rulesetOnProperty(args: Common & { meta: { what: string } }) {
    return makeJessError({ code: 'eval/ruleset-on-property', phase: 'eval', ...args });
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
  commaListInterpolation(args: Common & { meta: { selector: string } }) {
    return makeJessError({ code: 'selector/comma-list-interpolation', phase: 'eval', ...args });
  },

  // Plugin
  pluginUnsupported(args: Common & { meta: { plugin: string; feature: string } }) {
    return makeJessError({ code: 'plugin/unsupported-feature', phase: 'plugin', ...args });
  },
  /** A `@plugin`/`@use` function raised — user code failed, not a value mismatch. */
  pluginFunctionThrew(args: Common & { meta: { name: string; reason: string } }) {
    return makeJessError({ code: 'plugin/function-threw', phase: 'plugin', ...args });
  },
  /**
   * A `@plugin` could not be loaded — the path did not resolve, or the script
   * threw while installing. The phase is `eval` because the load happens while
   * the enclosing body evaluates, at the `@plugin` statement's position.
   */
  pluginLoadFailed(args: Common & { meta: { specifier: string; reason: string } }) {
    return makeJessError({ code: 'plugin/load-failed', phase: 'eval', ...args });
  }
};

/**
 * Primary **warning** helpers. Same API shape as `ERR`, but default `severity: 'warn'`.
 * Pass `WARN.*(...)` to `context.warn(...)` to surface without throwing.
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
  parentlessAmpersand(args: Common & { meta: { selector: string } }) {
    return makeJessError({ severity: 'warn', code: 'selector/parentless-ampersand', phase: 'eval', ...args });
  },
  unresolvedFunction(args: Common & { meta: { name: string; reason: string } }) {
    return makeJessError({ severity: 'warn', code: 'function/unresolved', phase: 'eval', ...args });
  },
  unitConversion(args: Common & { meta: { value: string } }) {
    return makeJessError({ severity: 'warn', code: 'eval/unit-conversion', phase: 'eval', ...args });
  },
  extendNotFound(args: Common & { meta: { target: string } }) {
    return makeJessError({ severity: 'warn', code: 'extend/not-found', phase: 'extend', ...args });
  },
  extendNotAccessible(args: Common & { meta: { target: string } }) {
    return makeJessError({ severity: 'warn', code: 'extend/not-accessible', phase: 'extend', ...args });
  },
  /**
   * A `@plugin`/`@use` function raised and the render continued. The call is
   * preserved verbatim, but never silently: this names the function, the throw,
   * and the call site.
   */
  pluginFunctionThrew(args: Common & { meta: { name: string; reason: string } }) {
    return makeJessError({ severity: 'warn', code: 'plugin/function-threw', phase: 'plugin', ...args });
  },
  /** A record a plugin emitted through `less.logger`, attributed to its call site. */
  pluginLog(args: Common & { meta: { name: string; level: string; message: string } }) {
    return makeJessError({ severity: 'warn', code: 'plugin/log', phase: 'plugin', ...args });
  }
};

/* =========================
 * Chevrotain adapter
 * ========================= */

function hasObjectShape(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isLexerError(error: IRecognitionException | ILexingError | JessError): error is ILexingError {
  return !('token' in error);
}

function lexerTokenText(error: ILexingError): string {
  const match = error.message.match(/unexpected character:\s*->([^<-]+)<-/i);
  return match?.[1] ?? '/';
}

/**
 * Converts a Chevrotain parser/lexer error into a friendly diagnostic.
 * If you pass `ctx`, the error will be clickable and include a code-frame.
 *
 * @param errors Chevrotain recognition errors
 * @param lexerErrors Chevrotain lexing result errors
 * @param filePath Absolute path to the file (legacy fallback)
 * @param source File contents (legacy fallback)
 * @param ctx Optional TreeContext to auto-fill file/line/col/source
 */
export function getErrorFromParser(
  errors: ReadonlyArray<IRecognitionException | JessError>,
  lexerErrors: ILexingResult['errors'] | undefined,
  filePath: string,
  source: string,
  ctx?: TreeContextLike
): JessError {
  const error = lexerErrors?.[0] ?? errors[0];
  if (!error) {
    return new JessError({ code: 'parse/syntax-error', phase: 'parse', filePath, source, ctx });
  }

  const record: Record<string, unknown> = hasObjectShape(error) ? error : {};
  const token = 'token' in error ? error.token : undefined;
  const line = finiteNumber(token?.startLine) ?? finiteNumber(record.line);
  const column = finiteNumber(token?.startColumn) ?? finiteNumber(record.column);
  const message = typeof record.message === 'string' ? record.message : '';

  let code: JessErrorCode = 'parse/syntax-error';
  let meta: Record<string, unknown> = {};

  if (isLexerError(error)) {
    code = 'parse/unexpected-token';
    meta = { token: lexerTokenText(error) };
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
 * Converts a JessError to a normalized ErrorDiagnostic or WarningDiagnostic,
 * extracting the source lines around the site for code-frame display.
 */
export function toDiagnostic(error: JessError): ErrorDiagnostic | WarningDiagnostic {
  const source = error.source ?? error.fileObj?.source;
  const lines = extractRelevantLines(source, error.line);

  // Derive endLine/endColumn from the node's end offset + source (not stored on nodes).
  const endOffset = inlineSpanEnd(error.node);
  const endLc = endOffset !== undefined && source !== undefined
    ? lineColAt(source, endOffset)
    : undefined;

  // File object without source (we only use 'lines' for code frames).
  const file = error.fileObj
    ? { name: error.fileObj.name, path: error.fileObj.path, fullPath: error.fileObj.fullPath }
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
    endLine: endLc?.line,
    endColumn: endLc?.column,
    lines
  };

  if (error.severity === 'error') {
    return { ...base, errors: error.errors, lexerErrors: error.lexerErrors } as ErrorDiagnostic;
  }
  return base as WarningDiagnostic;
}
