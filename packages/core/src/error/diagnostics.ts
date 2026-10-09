import type { Deprecation } from '../deprecation.js';
import { type ParseErrorCode, type Phase, isJessErrorCode, isParseErrorCode } from './codes.js';
import { INJECTED_TEXT_NOTE, authoredLineCol, lineColAt, extractRelevantLines, type SourceOwner } from './code-frame.js';
import {
  JessError,
  inlineSpanEnd,
  type JessErrorInit,
  type LocNode,
  type TreeContextLike
} from './jess-error.js';

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

    /** Where the authored file sits in a host-prepared `source` (see {@link SourceOwner}). */
    sourceOffset?: number;
    sourceEnd?: number;
  };
  filePath?: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;

  /**
   * Relevant source lines for code frame display, keyed by 1-indexed line number
   * (error line + before/after context), e.g. `{ 55: 'before', 56: 'err', 57: 'after' }`.
   */
  lines?: Record<number, string>;
}

/**
 * The fact shape exposed by a direct parser when Parseman cannot produce the
 * requested document. `offset` stays an internal recognition fact: the public
 * diagnostic boundary derives the user-facing line, column, and code frame
 * from the source that the plugin already owns.
 */
export interface ParserFailure {
  readonly code?: ParseErrorCode;
  readonly offset: number;
  readonly endOffset?: number;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly expected?: readonly string[];
  readonly reason?: string;
  readonly fix?: string;
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
  const endOffset =
    'endOffset' in error
    && typeof error.endOffset === 'number'
    && Number.isFinite(error.endOffset)
      ? error.endOffset
      : undefined;
  const line =
    'line' in error && typeof error.line === 'number' && Number.isFinite(error.line)
      ? error.line
      : undefined;
  const column =
    'column' in error && typeof error.column === 'number' && Number.isFinite(error.column)
      ? error.column
      : undefined;
  const endLine =
    'endLine' in error && typeof error.endLine === 'number' && Number.isFinite(error.endLine)
      ? error.endLine
      : undefined;
  const endColumn =
    'endColumn' in error && typeof error.endColumn === 'number' && Number.isFinite(error.endColumn)
      ? error.endColumn
      : undefined;
  const expected =
    'expected' in error && Array.isArray(error.expected)
      ? Array.from(new Set(error.expected.filter(
          (value): value is string => typeof value === 'string'
        )))
      : undefined;
  const code =
    'code' in error && typeof error.code === 'string' && isParseErrorCode(error.code)
      ? error.code
      : undefined;
  const reason =
    'reason' in error && typeof error.reason === 'string'
      ? error.reason
      : undefined;
  const fix =
    'fix' in error && typeof error.fix === 'string' ? error.fix : undefined;
  return { code, offset, endOffset, line, column, endLine, endColumn, expected, reason, fix };
}

type ParserExpectedSummary = {
  readonly code:
    | 'parse/invalid-value'
    | 'parse/syntax-error'
    | 'parse/unterminated-string';
  readonly message: string;
  readonly reason: string;
  readonly fix: string;
};

type ParserSourceSummary = ParserExpectedSummary & {
  readonly offset: number;
};

const SINGLE_QUOTE = '\u0027';

function hasExpected(expected: ReadonlySet<string>, value: string): boolean {
  return expected.has(value);
}

function expectedValueSummary(
  dialect: string,
  expected: readonly string[] | undefined
): ParserExpectedSummary | undefined {
  if (expected === undefined || expected.length === 0) {
    return undefined;
  }
  const expectedSet = new Set(expected);
  const looksLikeValueProduction =
    hasExpected(expectedSet, 'NumberToken')
    && hasExpected(expectedSet, 'DimensionUnit')
    && hasExpected(expectedSet, 'not(regex)')
    && (
      hasExpected(expectedSet, 'LessSyntaxKeyword')
      || hasExpected(expectedSet, 'HexColor')
    );
  if (!looksLikeValueProduction) {
    return undefined;
  }
  return {
    code: 'parse/invalid-value',
    message: 'Invalid value.',
    reason: `${dialect} expected a value here, but this token cannot start one.`,
    fix: 'Rewrite this position as a valid value or move the syntax into a statement position.'
  };
}

function expectedClosingDelimiterSummary(
  dialect: string,
  expected: readonly string[] | undefined
): ParserExpectedSummary | undefined {
  if (expected?.length !== 1) {
    return undefined;
  }
  switch (expected[0]) {
    case '")"':
      return {
        code: 'parse/syntax-error',
        message: 'Missing closing parenthesis.',
        reason: `${dialect} expected ')' to close the open construct before this token.`,
        fix: 'Add the missing \')\' or remove the unmatched \'(\'.'
      };
    case '"]"':
      return {
        code: 'parse/syntax-error',
        message: 'Missing closing bracket.',
        reason: `${dialect} expected ']' to close the open construct before this token.`,
        fix: 'Add the missing \']\' or remove the unmatched \'[\'.'
      };
    case '"}"':
      return {
        code: 'parse/syntax-error',
        message: 'Missing closing brace.',
        reason: `${dialect} expected '}' to close the open construct before this token.`,
        fix: 'Add the missing \'}\' or remove the unmatched \'{\'.'
      };
    default:
      return undefined;
  }
}

function expectedSemicolonSummary(
  dialect: string,
  expected: readonly string[] | undefined
): ParserExpectedSummary | undefined {
  if (expected?.length !== 1 || expected[0] !== '";"') {
    return undefined;
  }
  return {
    code: 'parse/syntax-error',
    message: 'Missing semicolon.',
    reason: `${dialect} expected ';' before this token.`,
    fix: 'Add the missing \';\' or rewrite the statement.'
  };
}

/**
 * Parseman surfaces the class/id selector matcher as a regex literal whose
 * source begins with the `[.#]` character class. Recognizing it by that prefix
 * lets the classifier name a selector frame without ever printing the regex.
 */
function isClassOrIdSelectorToken(token: string): boolean {
  return token.startsWith('/[.#]');
}

/**
 * The deepest frame at a rule/selector position: the parser could continue with
 * a block (`{`), a combinator (`>`), another class/id selector, or a mixin call
 * (`(`), and the token here starts none of them. Under the 0.46.0 OP_CHOICE
 * union bug this set was widened into the value-atom signature and mislabeled
 * "Invalid value."; 0.48.1's honest narrowing exposes the true frame, so it gets
 * its own clean summary rather than falling through to a regex-leaking fallback.
 */
function expectedSelectorContextSummary(
  dialect: string,
  expected: readonly string[] | undefined
): ParserExpectedSummary | undefined {
  if (expected === undefined || expected.length === 0) {
    return undefined;
  }
  const expectedSet = new Set(expected);
  const canOpenBlock = hasExpected(expectedSet, '"{"');
  const canCallMixin = hasExpected(expectedSet, '"("');
  const canContinueSelector =
    hasExpected(expectedSet, '/>/') || expected.some(isClassOrIdSelectorToken);
  if (!(canOpenBlock && canCallMixin && canContinueSelector)) {
    return undefined;
  }
  return {
    code: 'parse/syntax-error',
    message: 'Expected a selector, mixin call, or block.',
    reason: `${dialect} expected a selector, mixin call, or block to continue here, but this token starts none of them.`,
    fix: 'Continue the selector, call a mixin, or open a block with \'{\'.'
  };
}

function expectedSyntaxSummary(
  dialect: string,
  expected: readonly string[] | undefined
): ParserExpectedSummary | undefined {
  return (
    expectedValueSummary(dialect, expected)
    ?? expectedClosingDelimiterSummary(dialect, expected)
    ?? expectedSemicolonSummary(dialect, expected)
    ?? expectedSelectorContextSummary(dialect, expected)
  );
}

/**
 * Which expected tokens are safe to print verbatim in the generic fallback
 * reason. Only quoted character/string literals (e.g. `";"`, `"{"`) name a
 * concrete character the author can act on; regex literals and lexer
 * token-class names are parser internals and must never reach the user. This is
 * defense in depth: every specific frame gets a summary above, but a frame no
 * summary recognizes still cannot dump a regex source string.
 */
function surfaceableExpectedTokens(expected: readonly string[]): string[] {
  return expected.filter(token => /^".*"$/.test(token));
}

function matchingCloser(opener: string): string | undefined {
  switch (opener) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    default:
      return undefined;
  }
}

function isOpeningDelimiter(value: string): boolean {
  return value === '(' || value === '[' || value === '{';
}

function isClosingDelimiter(value: string): boolean {
  return value === ')' || value === ']' || value === '}';
}

/**
 * Does the `{` at `index` open a block that follows a parenthesized head — the
 * `)` `{` signature of a Less mixin body, guard, or detached-ruleset argument
 * such as `each(list, #(k) { … })`? Its `{` sits inside the still-open `(` of
 * `each(`, which the naive scan would otherwise read as an unclosed paren. The
 * `(` is legitimately closed later, so a `{` whose previous non-space character
 * is a closing delimiter is a real block, not a missing `)`. A genuinely
 * unclosed prelude like `@media (foo {` has an identifier there, not a closer,
 * and still reports.
 */
function followsClosingDelimiter(source: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = source[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      continue;
    }
    return isClosingDelimiter(ch);
  }
  return false;
}

function delimiterConflictSummary(
  dialect: string,
  source: string
): ParserSourceSummary | undefined {
  const stack: string[] = [];
  let quote: string | undefined;
  let quoteOffset = -1;
  let inBlockComment = false;
  let inLineComment = false;

  for (let i = 0; i < source.length; i++) {
    const current = source[i]!;
    const next = source[i + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote !== undefined) {
      if (current === '\\') {
        i++;
        continue;
      }
      if (current === quote) {
        quote = undefined;
        quoteOffset = -1;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (current === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (current === '"' || current === SINGLE_QUOTE) {
      quote = current;
      quoteOffset = i;
      continue;
    }
    if (isOpeningDelimiter(current)) {
      const closer = matchingCloser(current);
      if (closer === undefined) {
        continue;
      }
      const top = stack[stack.length - 1];
      const insideBlock = stack.includes('}');
      if (
        top !== undefined
        && top !== '}'
        && current === '{'
        && !insideBlock
        && !followsClosingDelimiter(source, i)
      ) {
        const summary = expectedClosingDelimiterSummary(dialect, [`"${top}"`]);
        return summary === undefined ? undefined : { ...summary, offset: i };
      }
      stack.push(closer);
      continue;
    }
    if (isClosingDelimiter(current)) {
      const top = stack[stack.length - 1];
      if (top === undefined) {
        continue;
      }
      if (top !== current) {
        const summary = expectedClosingDelimiterSummary(dialect, [`"${top}"`]);
        return summary === undefined ? undefined : { ...summary, offset: i };
      }
      stack.pop();
    }
  }

  if (quote !== undefined) {
    return {
      code: 'parse/unterminated-string',
      message: 'Unterminated string.',
      reason: `${dialect} expected the quoted string to be closed before the end of the source.`,
      fix: 'Add the missing closing quote.',
      offset: quoteOffset
    };
  }

  const top = stack[stack.length - 1];
  if (top === undefined) {
    return undefined;
  }
  const summary = expectedClosingDelimiterSummary(dialect, [`"${top}"`]);
  return summary === undefined ? undefined : { ...summary, offset: source.length };
}

function sourceSyntaxSummary(
  dialect: string,
  source: string,
  failure: ParserFailure | undefined
): ParserSourceSummary | undefined {
  if (
    failure === undefined
    || (failure.code !== undefined && failure.code !== 'parse/syntax-error')
  ) {
    return undefined;
  }
  if (expectedSyntaxSummary(dialect, failure.expected) !== undefined) {
    return undefined;
  }
  return delimiterConflictSummary(dialect, source);
}

/**
 * Convert a direct-parser failure into the compiler's source-backed diagnostic
 * contract. Parser packages expose recognition facts only; plugins call this
 * once with their source so every public parse diagnostic has a 1-based site
 * and a code frame.
 */
export function parserDiagnostic({
  dialect,
  error,
  filePath,
  source
}: ParserDiagnosticOptions): ErrorDiagnostic {
  const failure = parserFailureFrom(error);
  const sourceSummary = sourceSyntaxSummary(dialect, source, failure);
  const offset = Math.max(
    0,
    Math.min(source.length, sourceSummary?.offset ?? failure?.offset ?? 0)
  );
  const endOffset =
    failure?.endOffset === undefined
      ? undefined
      : Math.max(offset, Math.min(source.length, failure.endOffset));

  /*
   * The failure's own line/column describe `failure.offset`. A source summary
   * re-localises to a better offset, and taking the position from one and the
   * offset from the other would point the caret and the reported line at two
   * different places, so the summary's offset wins the position too.
   */
  const startLoc =
    sourceSummary === undefined && failure?.line !== undefined && failure.column !== undefined
      ? { line: failure.line, column: failure.column }
      : lineColAt(source, offset);
  const endLoc =
    failure?.endLine !== undefined && failure.endColumn !== undefined
      ? { line: failure.endLine, column: failure.endColumn }
      : endOffset === undefined ? undefined : lineColAt(source, endOffset);
  const message = error instanceof JessError
    ? error.message
    : error instanceof Error
      ? error.message
      : `${dialect} parser error.`;
  const expected = failure?.expected;
  const expectedSummary =
    failure?.code === undefined || failure.code === 'parse/syntax-error'
      ? expectedSyntaxSummary(dialect, expected)
      : undefined;
  const syntaxSummary = expectedSummary ?? sourceSummary;
  return {
    code: syntaxSummary?.code ?? failure?.code ?? 'parse/syntax-error',
    phase: 'parse',
    message: syntaxSummary?.message ?? message,
    reason:
      sourceSummary?.reason
      ?? failure?.reason
      ?? expectedSummary?.reason
      ?? ((): string => {
        const surfaceable = expected ? surfaceableExpectedTokens(expected) : [];
        return surfaceable.length > 0
          ? `The parser expected ${surfaceable.join(', ')}.`
          : 'The parser could not continue at this source location.';
      })(),
    fix:
      sourceSummary?.fix
      ?? failure?.fix
      ?? expectedSummary?.fix
      ?? `Check the ${dialect} source against the supported grammar.`,
    file: { name: filePath, path: filePath, fullPath: filePath, source },
    filePath,
    line: startLoc.line,
    column: startLoc.column,
    endLine: endLoc?.line,
    endColumn: endLoc?.column,
    lines: extractRelevantLines(source, startLoc.line)
  };
}

/**
 * A diagnostic a parser reported against host-prepared text (Less `banner` /
 * `globalVars` written ahead of the file), re-positioned in the file as authored
 * (ledger O16): its line, column and code frame count from where the file
 * starts, and its file carries that start so a later frame does too. One in the
 * injected text keeps the prepared text's lines and says where it is
 * ({@link fileAt}).
 */
export function inAuthoredFile<T extends ErrorDiagnostic | WarningDiagnostic>(
  diagnostic: T,
  source: string,
  owner: SourceOwner
): T {
  const start = authoredLineCol(source, diagnostic.line, diagnostic.column, owner);
  if (start === undefined) {
    return { ...diagnostic, note: diagnostic.note ?? INJECTED_TEXT_NOTE };
  }
  const end = diagnostic.endLine === undefined || diagnostic.endColumn === undefined
    ? undefined
    : authoredLineCol(source, diagnostic.endLine, diagnostic.endColumn, owner);
  return {
    ...diagnostic,
    file: diagnostic.file === undefined ? undefined : { ...diagnostic.file, ...owner },
    line: start.line,
    column: start.column,
    endLine: end?.line,
    endColumn: end?.column,
    lines: diagnostic.lines === undefined ? undefined : extractRelevantLines(source, start.line, 1, owner)
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

const NO_VISITORS = 'Less v5 has no visitor API: remove the plugin, or port what it does to a function plugin or to a step that runs on the compiled CSS.';
const NO_PRE_PROCESSORS = 'Less v5 does not run source pre-processors: transform the source before it reaches the compiler.';
const NO_POST_PROCESSORS = 'Less v5 does not run CSS post-processors: for minification (less-plugin-clean-css) set output.compress (`compress` in less.render / lessc); otherwise run the tool, e.g. PostCSS with autoprefixer, on the compiled CSS.';
const NO_FILE_MANAGERS = 'Less v5 has no custom file managers: for npm imports (less-plugin-npm-import) use @jesscss/plugin-node-modules; other import resolution belongs in a Jess plugin\'s resolve/locate hooks.';
const VALUES_ONLY = 'A Less v5 function plugin returns a value (a dimension, color, string, keyword, list or declaration list): write the rest in the stylesheet.';

/*
 * Less 4 tree nodes beyond the function-plugin value surface, each with the
 * reason it is not provided. Both plugin runtimes refuse `tree.<Name>` and its
 * 4.x factory `less.<name>()` (A12).
 */
const UNSUPPORTED_TREE_NODE_REASONS: ReadonlyArray<readonly [string, string]> = [
  ['AtRule', `At-rules are statements, not values. ${VALUES_ONLY}`],
  ['Attribute', `Attribute selectors are selector structure. ${VALUES_ONLY}`],
  ['Combinator', `Combinators are selector structure. ${VALUES_ONLY}`],
  ['Condition', `Guard conditions are evaluated by the compiler. ${VALUES_ONLY}`],
  ['Element', `Selector elements are selector structure. ${VALUES_ONLY}`],
  ['Extend', `:extend is resolved by the compiler. ${VALUES_ONLY}`],
  ['Import', `@import is resolved while documents load, before plugin functions run. ${VALUES_ONLY}`],
  ['JavaScript', 'Inline JavaScript evaluation was removed: write the expression as a function plugin.'],
  ['Media', `@media is a statement, not a value. ${VALUES_ONLY}`],
  ['MixinCall', `Mixin calls are dispatched by the compiler. ${VALUES_ONLY}`],
  ['MixinDefinition', `Mixin definitions are statements, not values. ${VALUES_ONLY}`],
  ['NamespaceValue', `Namespace lookups are resolved by the compiler. ${VALUES_ONLY}`],
  ['Selector', `Selectors are statement structure. ${VALUES_ONLY}`],
  ['VariableCall', `Detached-ruleset calls are dispatched by the compiler. ${VALUES_ONLY}`]
];

/** The Less 4 `tree` constructors a Less v5 plugin runtime refuses (A12). */
export const UNSUPPORTED_LESS_TREE_NODES: readonly string[] = UNSUPPORTED_TREE_NODE_REASONS.map(([name]) => name);

/**
 * The Less 4 plugin-manager API that Less v5 deliberately does not run, keyed
 * by the member a plugin reaches for, with the replacement its refusal names.
 * One table for both Less plugin runtimes: the in-process bridge of
 * `@jesscss/plugin-less-compat`, and the `@plugin` sandbox of
 * `@jesscss/plugin-js`, whose worker reports only the member it refused.
 * Every other 4.x `PluginManager` member (`addPlugin`, `addPlugins`, `get`,
 * `less`, `installedPlugins`, `pluginCache`) works in both runtimes.
 */
const UNSUPPORTED_PLUGIN_API_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ['pluginManager.addVisitor()', NO_VISITORS],
  ['pluginManager.getVisitors()', NO_VISITORS],
  ['pluginManager.visitor()', NO_VISITORS],
  ['pluginManager.visitors', NO_VISITORS],
  ['pluginManager.iterator', NO_VISITORS],
  ['pluginManager.addPreProcessor()', NO_PRE_PROCESSORS],
  ['pluginManager.getPreProcessors()', NO_PRE_PROCESSORS],
  ['pluginManager.preProcessors', NO_PRE_PROCESSORS],
  ['pluginManager.addPostProcessor()', NO_POST_PROCESSORS],
  ['pluginManager.getPostProcessors()', NO_POST_PROCESSORS],
  ['pluginManager.postProcessors', NO_POST_PROCESSORS],
  ['pluginManager.addFileManager()', NO_FILE_MANAGERS],
  ['pluginManager.getFileManagers()', NO_FILE_MANAGERS],
  ['pluginManager.fileManagers', NO_FILE_MANAGERS],
  ['pluginManager.Loader', 'Less v5 loads plugins only from @plugin and the plugins option: declare the plugin there, or install it from this one with pluginManager.addPlugin().'],

  /* 4.x plugins reach these before the hook call (`new less.visitors.Visitor(this)`). */
  ['less.visitors', NO_VISITORS],
  ['less.FileManager', NO_FILE_MANAGERS],
  ['less.environment', NO_FILE_MANAGERS],
  ...UNSUPPORTED_TREE_NODE_REASONS.map(([name, reason]): [string, string] => [`tree.${name}`, reason]),
  ['tree.Ruleset with selectors', `Only an anonymous declaration list crosses the plugin value boundary. ${VALUES_ONLY}`]
]);

export function makeJessErrorFromDiagnostic(
  diagnostic: ErrorDiagnostic
): JessError {
  const code = isJessErrorCode(diagnostic.code)
    ? diagnostic.code
    : 'parse/syntax-error';
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
    endLine: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    reason: diagnostic.reason,
    fix: diagnostic.fix,
    note: diagnostic.note
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
    return makeJessError({
      code: 'parse/unexpected-token',
      phase: 'parse',
      ...args
    });
  },
  unterminatedString(args: Common = {}) {
    return makeJessError({
      code: 'parse/unterminated-string',
      phase: 'parse',
      ...args
    });
  },

  // Resolve/Import
  nameNotFound(args: Common & { meta: { symbol: string } }) {
    return makeJessError({
      code: 'resolve/name-not-found',
      phase: 'resolve',
      ...args
    });
  },
  circularCompose(args: Common & { meta: { chain: string } }) {
    return makeJessError({
      code: 'import/circular-compose',
      phase: 'import',
      ...args
    });
  },
  importCycle(args: Common & { meta: { specifier: string } }) {
    return makeJessError({
      code: 'import/cycle',
      phase: 'import',
      ...args
    });
  },
  importNotFound(args: Common & { meta: { specifier: string; from: string } }) {
    return makeJessError({
      code: 'import/not-found',
      phase: 'import',
      ...args
    });
  },
  importLoadFailed(args: Common & { meta: { specifier: string; reason: string } }) {
    return makeJessError({
      code: 'import/load-failed',
      phase: 'import',
      ...args
    });
  },

  // Eval
  arity(
    args: Common & {
      meta: { callee: string; expectedCount: number; gotCount: number };
    }
  ) {
    return makeJessError({
      code: 'eval/bad-call-arity',
      phase: 'eval',
      ...args
    });
  },
  typeMismatch(
    args: Common & { meta: { callee: string; expected: string; got: string } }
  ) {
    return makeJessError({
      code: 'eval/type-mismatch',
      phase: 'eval',
      ...args
    });
  },
  invalidFunction(args: Common & { meta: { name: string; reason: string } }) {
    return makeJessError({
      code: 'eval/invalid-function',
      phase: 'eval',
      ...args
    });
  },
  invalidStatement(args: Common & { meta: { what: string } }) {
    return makeJessError({
      code: 'eval/invalid-statement',
      phase: 'eval',
      ...args
    });
  },
  ambiguousDefault(args: Common & { meta: { callee: string } }) {
    return makeJessError({
      code: 'eval/ambiguous-default',
      phase: 'eval',
      ...args
    });
  },
  propertyInRoot(args: Common & { meta: { what: string } }) {
    return makeJessError({
      code: 'eval/property-in-root',
      phase: 'eval',
      ...args
    });
  },
  rulesetArgumentWithRules(args: Common & { meta: { what: string } }) {
    return makeJessError({
      code: 'eval/ruleset-argument-with-rules',
      phase: 'eval',
      ...args
    });
  },
  guardedSelectorList(args: Common & { meta: { count: number } }) {
    return makeJessError({
      code: 'eval/guarded-selector-list',
      phase: 'eval',
      ...args
    });
  },
  rulesetOnProperty(args: Common & { meta: { what: string } }) {
    return makeJessError({
      code: 'eval/ruleset-on-property',
      phase: 'eval',
      ...args
    });
  },
  recursiveReference(
    args: Common & { meta: { kind: 'Variable' | 'Property'; symbol: string } }
  ) {
    return makeJessError({
      code: 'eval/recursive-reference',
      phase: 'eval',
      ...args
    });
  },

  /**
   * A `$while` whose condition never settled false. The limit is a TERMINATION
   * guarantee, not a tuning knob: without it a loop whose body never moves the
   * condition hangs the compiler with no output and no message.
   */
  loopIterationLimit(args: Common & { meta: { limit: number } }) {
    return makeJessError({
      code: 'eval/loop-iteration-limit',
      phase: 'eval',
      ...args
    });
  },

  /**
   * A division the author asked for — `math: always`, a paren group, `$( … )` —
   * whose divisor is zero. There is no quotient to print, and printing the
   * operation verbatim would hide the mistake, so it is an error in every
   * `unitMode` (DESIGN-DECISIONS P35).
   */
  divisionByZero(args: Common & { meta: { expr: string } }) {
    return makeJessError({
      code: 'eval/division-by-zero',
      phase: 'eval',
      ...args
    });
  },
  invalidUnitArithmetic(args: Common & { meta: { reason: string } }) {
    return makeJessError({
      code: 'eval/invalid-unit-arithmetic',
      phase: 'eval',
      ...args
    });
  },

  /**
   * A Sass `@error` directive — the author asked the compile to halt with this
   * message. The evaluated message IS the summary; there is nothing to add.
   */
  scssError(args: Common & { meta: { message: string } }) {
    return makeJessError({
      code: 'eval/scss-error',
      phase: 'eval',
      ...args
    });
  },

  /**
   * A RELATIONAL comparison whose operands share no common ground (`1px > red`).
   * Relational is trichotomous over every grounded pair, so the alternative is
   * answering `false` to both `a > b` and `b > a` — which is what the author
   * cannot distinguish from a genuine "not greater".
   */
  emptyOperand(args: Common & { meta: { reason: string } }) {
    return makeJessError({
      code: 'eval/empty-operand',
      phase: 'eval',
      ...args
    });
  },
  incomparableOperands(args: Common & { meta: { reason: string } }) {
    return makeJessError({
      code: 'eval/incomparable-operands',
      phase: 'eval',
      ...args
    });
  },

  /**
   * A value resolved asynchronously in one of the few positions still confined
   * to the synchronous lane. A real limitation, not a wrong answer: it names the
   * position and the site rather than silently picking a branch.
   */
  asyncInSyncPosition(args: Common & { meta: { where: string } }) {
    return makeJessError({
      code: 'eval/async-in-sync-position',
      phase: 'eval',
      ...args
    });
  },

  // Extend
  extendBoundary(args: Common & { meta: { target: string } }) {
    return makeJessError({
      code: 'extend/protected-boundary',
      phase: 'extend',
      ...args
    });
  },
  extendNotFound(args: Common & { meta: { target: string } }) {
    return makeJessError({
      code: 'extend/not-found',
      phase: 'extend',
      ...args
    });
  },
  extendNotAccessible(args: Common & { meta: { target: string } }) {
    return makeJessError({
      code: 'extend/not-accessible',
      phase: 'extend',
      ...args
    });
  },
  commaListInterpolation(args: Common & { meta: { selector: string } }) {
    return makeJessError({
      code: 'selector/comma-list-interpolation',
      phase: 'eval',
      ...args
    });
  },

  // Plugin
  /**
   * A plugin reached for an API this compiler deliberately does not provide
   * (e.g. a Less 4 plugin-manager hook). The fix names the native replacement
   * from {@link UNSUPPORTED_PLUGIN_API_REPLACEMENTS}.
   */
  pluginUnsupported(
    args: Common & { meta: { plugin: string; feature: string } }
  ) {
    return makeJessError({
      code: 'plugin/unsupported-feature',
      phase: 'plugin',
      ...args,
      meta: {
        ...args.meta,
        replacement: UNSUPPORTED_PLUGIN_API_REPLACEMENTS.get(args.meta.feature)
          ?? 'Remove the plugin, or replace what it does with a supported plugin API.'
      }
    });
  },

  /**
   * A plugin option is set to a value outside its documented set. Options are
   * not a stylesheet, so the diagnostic names the option, and `filePath` is the
   * config file when one sets the value; a value passed in code has no file.
   */
  pluginInvalidOption(
    args: Common & { meta: { plugin: string; option: string; value: string; allowed: string } }
  ) {
    return makeJessError({
      code: 'plugin/invalid-option',
      phase: 'plugin',
      ...args
    });
  },

  /** A `@plugin`/`@use` function raised — user code failed, not a value mismatch. */
  pluginFunctionThrew(
    args: Common & { meta: { name: string; reason: string } }
  ) {
    return makeJessError({
      code: 'plugin/function-threw',
      phase: 'plugin',
      ...args
    });
  },

  /**
   * A `@plugin` could not be loaded — the path did not resolve, or the script
   * threw while installing. The phase is `eval` because the load happens while
   * the enclosing body evaluates, at the `@plugin` statement's position.
   */
  pluginLoadFailed(
    args: Common & { meta: { specifier: string; reason: string } }
  ) {
    return makeJessError({
      code: 'plugin/load-failed',
      phase: 'eval',
      ...args
    });
  }
};

/**
 * Primary **warning** helpers. Same API shape as `ERR`, but default `severity: 'warn'`.
 * Pass `WARN.*(...)` to `context.warn(...)` to surface without throwing.
 */
export const WARN = {
  deprecated(
    args: Common & {
      meta: { what: string; use: string; deprecation?: Deprecation };
    }
  ) {
    return makeJessError({
      severity: 'warn',
      code: 'eval/deprecated',
      phase: 'eval',
      ...args
    });
  },
  unusedVar(args: Common & { meta: { symbol: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'resolve/unused-variable',
      phase: 'resolve',
      ...args
    });
  },
  duplicateSelector(args: Common & { meta: { selector: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'selector/duplicate',
      phase: 'extend',
      ...args
    });
  },
  parentlessAmpersand(args: Common & { meta: { selector: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'selector/parentless-ampersand',
      phase: 'eval',
      ...args
    });
  },

  /**
   * §4.7 — a value whose composed unit CSS cannot express. Raised on the
   * `loose` and `preserve` rungs of the `unitMode` ladder, which both PRODUCE a
   * value: `loose` folds to Less 4.x's dimensionally false answer and
   * `preserve` says the authored expression back as `calc(…)`. Neither is
   * silent, because a plausible-looking wrong answer is worse than a
   * diagnostic. Only `strict`, which refuses the value outright, reports
   * through `ERR` instead.
   */
  unexpressibleUnit(args: Common & { meta: { expr: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'eval/unexpressible-unit',
      phase: 'eval',
      ...args
    });
  },
  unitConversion(args: Common & { meta: { value: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'eval/unit-conversion',
      phase: 'eval',
      ...args
    });
  },
  extendNotFound(args: Common & { meta: { target: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'extend/not-found',
      phase: 'extend',
      ...args
    });
  },
  extendNotAccessible(args: Common & { meta: { target: string } }) {
    return makeJessError({
      severity: 'warn',
      code: 'extend/not-accessible',
      phase: 'extend',
      ...args
    });
  },

  /**
   * A `@plugin`/`@use` function raised and the render continued. The call is
   * preserved verbatim, but never silently: this names the function, the throw,
   * and the call site.
   */
  pluginFunctionThrew(
    args: Common & { meta: { name: string; reason: string } }
  ) {
    return makeJessError({
      severity: 'warn',
      code: 'plugin/function-threw',
      phase: 'plugin',
      ...args
    });
  },

  /** A record a plugin emitted through `less.logger`, attributed to its call site. */
  pluginLog(
    args: Common & { meta: { name: string; level: string; message: string } }
  ) {
    return makeJessError({
      severity: 'warn',
      code: 'plugin/log',
      phase: 'plugin',
      ...args
    });
  }
};

/**
 * Converts a JessError to a normalized ErrorDiagnostic or WarningDiagnostic,
 * extracting the source lines around the site for code-frame display.
 *
 * Both shapes are the same object; the diagnostic does not record which one it
 * is. A caller routing it to an errors or warnings list decides by
 * `error.severity`, never by inspecting the result's keys.
 */
export function toDiagnostic(
  error: JessError,
  options?: { includeLines?: boolean }
): ErrorDiagnostic | WarningDiagnostic {
  const source = error.source ?? error.fileObj?.source;
  const lines = options?.includeLines === false
    ? undefined
    : extractRelevantLines(source, error.line, 1, error.fileObj);

  // Prefer explicit parser-provided end ranges, then derive from a node span.
  const endOffset = inlineSpanEnd(error.node);
  const endLc =
    error.endLine === undefined
    && error.endColumn === undefined
    && endOffset !== undefined
    && source !== undefined
      ? lineColAt(source, endOffset, error.fileObj)
      : undefined;

  // File object without source (we only use 'lines' for code frames).
  const file = error.fileObj
    ? {
        name: error.fileObj.name,
        path: error.fileObj.path,
        fullPath: error.fileObj.fullPath
      }
    : undefined;

  return {
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
    endLine: error.endLine ?? endLc?.line,
    endColumn: error.endColumn ?? endLc?.column,
    lines
  };
}
