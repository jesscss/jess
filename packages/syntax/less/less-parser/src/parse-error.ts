function expectedIncludes(expected: ReadonlySet<string>, value: string): boolean {
  return expected.has(value);
}

function expectedMessage(expected: readonly string[]): string {
  if (expected.length === 0) {
    return 'Unexpected Less syntax.';
  }
  const expectedSet = new Set(expected);
  /*
   * The one at-rule-specific atom in this file. The `@charset` prelude is a
   * `<string>` and nothing else (css-syntax-3 §3.2), so a refusal there has a
   * real answer to give and must not read as the generic fallback. Emitted by
   * the css grammar's `CHARSET_PRELUDE_EXPECTED`; the spelling is duplicated
   * here for the same reason `'")"'` is — this module holds no grammar import.
   */
  if (expectedIncludes(expectedSet, '@charset quoted string')) {
    return 'An @charset prelude must be a quoted string, as in @charset "utf-8";.';
  }
  if (expectedIncludes(expectedSet, '")"')) {
    return 'Missing closing parenthesis.';
  }
  if (expectedSet.size === 1) {
    if (expectedIncludes(expectedSet, '"]"')) {
      return 'Missing closing bracket.';
    }
    if (expectedIncludes(expectedSet, '"}"')) {
      return 'Missing closing brace.';
    }
  }
  const hasValueCore =
    expectedIncludes(expectedSet, 'NumberToken')
    && expectedIncludes(expectedSet, 'DimensionUnit')
    && expectedIncludes(expectedSet, 'not(regex)');
  const looksLikeValueProduction =
    hasValueCore
    && (
      expectedIncludes(expectedSet, 'ValueIdentifier')
      || expectedIncludes(expectedSet, 'HexColor')
    );
  if (looksLikeValueProduction) {
    return 'Unexpected Less syntax. Expected a Less value.';
  }
  if (expectedIncludes(expectedSet, '";"')) {
    return 'Missing semicolon.';
  }
  return 'Unexpected Less syntax. Expected valid Less syntax here.';
}

/** Structured failure from the public direct Less parser. */
export class LessParseError extends SyntaxError {
  readonly code = 'parse/syntax-error' as const;
  readonly offset: number;
  readonly expected: readonly string[];
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly reason?: string;
  readonly fix?: string;

  constructor(
    offset: number,
    expected: readonly string[],
    options: {
      message?: string;
      reason?: string;
      fix?: string;
      line?: number;
      column?: number;
      endLine?: number;
      endColumn?: number;
    } = {}
  ) {
    super(options.message ?? expectedMessage(expected));
    this.name = 'LessParseError';
    this.offset = offset;
    this.expected = expected;
    this.line = options.line;
    this.column = options.column;
    this.endLine = options.endLine;
    this.endColumn = options.endColumn;
    this.reason = options.reason;
    this.fix = options.fix;
  }
}

/** Interpolation is rejected inside the CSS @charset token. */
export class LessDynamicCharsetError extends SyntaxError {
  readonly code = 'parse/dynamic-charset' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'Interpolation is not valid inside the CSS @charset token.';
  readonly fix = 'Use a static declaration such as @charset "UTF-8";';

  constructor(offset: number, endOffset: number) {
    super('Interpolation is not valid in @charset.');
    this.name = 'LessDynamicCharsetError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/** Executable inline backtick JavaScript is recognized so diagnostics can be precise. */
export class LessInlineJavaScriptError extends SyntaxError {
  readonly code = 'parse/unsupported-inline-javascript' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'Backtick JavaScript expressions cannot be enabled or evaluated.';
  readonly fix =
    'Move it to a module loaded with @use.';

  constructor(offset: number, endOffset: number) {
    super(
      'Inline JavaScript was removed in Less v5. Move it to a module loaded with @use.'
    );
    this.name = 'LessInlineJavaScriptError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/** Syntax/prelude slots require explicit @{name} interpolation. */
export class LessBareVariableInterpolationError extends SyntaxError {
  readonly code = 'parse/unsupported-bare-variable-interpolation' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason: string;
  readonly fix: string;

  constructor(offset: number, endOffset: number, name: string) {
    super('Bare @variable interpolation is not valid here.');
    this.name = 'LessBareVariableInterpolationError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.reason =
      'Bare @variable references are values; syntax and prelude interpolation must use @{variable}.';
    this.fix = `Use @{${name}} instead of @${name}.`;
  }
}

/** Legacy Less variable names are recognized so diagnostics can be precise. */
export class LessUnsupportedVariableNameError extends SyntaxError {
  readonly code = 'parse/unsupported-variable-name' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'Less variable names must not be numeric-leading or dash-only.';
  readonly fix: string;

  constructor(offset: number, endOffset: number, name: string) {
    super('This Less variable name is not supported.');
    this.name = 'LessUnsupportedVariableNameError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.fix = `Rename @${name} to a descriptive variable name and update its references.`;
  }
}

/** Legacy dash-only mixin names are recognized so diagnostics can be precise. */
export class LessUnsupportedMixinNameError extends SyntaxError {
  readonly code = 'parse/unsupported-mixin-name' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'Dash-only Less mixin names are not supported.';
  readonly fix = 'Rename the mixin to a descriptive selector-like name, for example .mixin().';

  constructor(offset: number, endOffset: number) {
    super('This Less mixin name is not supported.');
    this.name = 'LessUnsupportedMixinNameError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/**
 * A value led by `/` or `*` (ledger P33) is recognized so the diagnostic can sit
 * on that token; the parse carries on (P45).
 */
export class LessLeadingSeparatorValueError extends SyntaxError {
  readonly code = 'parse/leading-separator-value' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason: string;
  readonly fix: string;

  /** The value the parse kept for it; a report whose value is not in the accepted tree is dropped. */
  readonly recoveredValue: object;

  constructor(offset: number, endOffset: number, operator: string, recoveredValue: object) {
    super(`A Less value cannot start with "${operator}".`);
    this.name = 'LessLeadingSeparatorValueError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.reason = operator === '/'
      ? 'A slash separates two values, so it needs a value before it. A path is a value only inside url() or a string.'
      : 'A `*` multiplies two values, so it needs a value before it.';
    this.fix = operator === '/'
      ? 'Write the path as url(/path) or as an escaped string such as ~"/path".'
      : 'Write the value it multiplies before it, or remove it.';
    this.recoveredValue = recoveredValue;
  }
}

/** A mixin reference in a value that is neither called nor looked up. */
export class LessUncalledMixinReferenceError extends SyntaxError {
  readonly code = 'parse/uncalled-mixin-reference' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'In a value, a mixin reference must be called or looked up; on its own it has no value.';
  readonly fix: string;

  constructor(offset: number, endOffset: number, name: string) {
    super('A mixin reference is not a value.');
    this.name = 'LessUncalledMixinReferenceError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.fix = `Call it as ${name}() to use its result, or write ~"${name}" to keep it as text.`;
  }
}

/**
 * `!important` after a mixin reference that is a variable's whole value
 * (ledger P33): parsed, then an error at the `!important` (P45).
 */
export class LessImportantMixinReferenceError extends SyntaxError {
  readonly code = 'parse/important-on-mixin-reference' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'A mixin reference names a mixin without calling it, so it has no declarations for !important to mark.';
  readonly fix = 'Remove !important, or call the mixin: .mixin() !important.';

  /** The declaration the parse kept for it; a report whose declaration is not in the accepted tree is dropped. */
  readonly recoveredValue: object;

  constructor(offset: number, endOffset: number, recoveredValue: object) {
    super('A mixin reference cannot carry !important.');
    this.name = 'LessImportantMixinReferenceError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.recoveredValue = recoveredValue;
  }
}

/** Ungrouped Less mixin guards are recognized so diagnostics can point at the guard. */
export class LessUnparenthesizedMixinGuardError extends SyntaxError {
  readonly code = 'parse/unparenthesized-mixin-guard' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'Top-level Less mixin guards require each condition after when to be wrapped in parentheses.';
  readonly fix = 'Wrap the guard condition, for example: when (default()).';

  constructor(offset: number, endOffset: number) {
    super('Less mixin guard conditions must be parenthesized.');
    this.name = 'LessUnparenthesizedMixinGuardError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/**
 * What is wrong with one item of a mixin argument or parameter list. `named` and
 * `rest` exist only because the list holds a `;` (ledger P46): every `,` then
 * belongs to a comma-list value, which a name or a spread cannot be part of.
 */
export type LessMixinArgumentProblem = 'named' | 'rest' | 'anonymousRest' | 'value' | 'spreadPattern';

const MIXIN_ARGUMENT_PROBLEMS: Record<LessMixinArgumentProblem, { message: string; reason: string; fix: string }> = {
  named: {
    message: 'A named argument must start its ;-separated argument.',
    reason: 'This list uses ";", so ";" separates its arguments and every "," belongs to a comma-list value. A name can only begin an argument.',
    fix: 'Put a ";" before the named argument.'
  },
  rest: {
    message: 'A spread or rest argument cannot be part of a comma list.',
    reason: 'This list uses ";", so ";" separates its arguments and every "," belongs to a comma-list value. A spread or rest is not a value.',
    fix: 'Separate it from the comma list with ";".'
  },
  anonymousRest: {
    message: 'A mixin call cannot pass "..." on its own.',
    reason: 'A bare "..." declares a rest parameter in a mixin definition. A call spreads a value.',
    fix: 'Spread a variable, for example @rest..., or remove the "...".'
  },
  value: {
    message: 'A mixin call is not a value here.',
    reason: 'A parameter default, a pattern parameter and an item of a comma-list argument must be values.',
    fix: 'Replace the mixin call with a value, or pass it as an argument of its own.'
  },
  spreadPattern: {
    message: 'A pattern parameter cannot be spread.',
    reason: 'In a mixin definition "..." follows a parameter name (@rest...) or stands alone. A value pattern matches one argument.',
    fix: 'Name a rest parameter, for example @rest..., or remove the "...".'
  }
};

/** One argument or parameter of a mixin list, located at that item. */
export class LessMixinArgumentError extends SyntaxError {
  readonly code = 'parse/invalid-mixin-argument' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason: string;
  readonly fix: string;

  constructor(offset: number, endOffset: number, problem: LessMixinArgumentProblem) {
    const text = MIXIN_ARGUMENT_PROBLEMS[problem];
    super(text.message);
    this.name = 'LessMixinArgumentError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.reason = text.reason;
    this.fix = text.fix;
  }
}

/**
 * `not` before a bare operand a comparison follows (`not 1 > 2`): it does not
 * say whether `not` negates the operand or the comparison. Located at the
 * comparison operator.
 */
export class LessAmbiguousNotError extends SyntaxError {
  readonly code = 'parse/ambiguous-not' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = '`not` negates the condition or the group written right after it. After a bare operand, a comparison leaves open whether `not` negates the operand or the comparison; it is read as negating the comparison.';
  readonly fix = 'Group what `not` negates, for example: not (1 > 2).';

  constructor(offset: number, endOffset: number) {
    super('`not` before a compared operand does not say what it negates.');
    this.name = 'LessAmbiguousNotError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/**
 * A Less condition keyword in another case than lowercase (`AND`, `Not`): a
 * mixin guard, `if()` and `boolean()` read lowercase `and`, `or` and `not`
 * (owner 2026-10-13: "B: CSS any case, Less lowercase"). Located at the
 * keyword; the parse reads it as the keyword and carries on.
 */
export class LessConditionKeywordCaseError extends SyntaxError {
  readonly code = 'parse/condition-keyword-case' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'A Less condition reads lowercase `and`, `or` and `not`; a CSS condition (`@media`, `@supports`, `@container`) reads them in any case.';
  readonly fix: string;

  constructor(offset: number, endOffset: number, keyword: string) {
    const lower = keyword.toLowerCase();
    super(`Write \`${lower}\` in lowercase: a Less condition reads lowercase \`and\`, \`or\` and \`not\`.`);
    this.name = 'LessConditionKeywordCaseError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.fix = `Write \`${lower}\`.`;
  }
}

/**
 * A value-position `selector(…)` whose argument is not a selector list
 * (`selector()`, `selector(1px)`, `selector(@x)`): it captures a selector list,
 * the argument `:is()` takes (owner 2026-10-16, ledger P49). Located at the
 * argument; the parse reads the rest of it as opaque text and carries on (P45).
 */
export class LessSelectorCaptureArgumentError extends SyntaxError {
  readonly code = 'parse/selector-capture-argument' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = 'In a value, selector() captures a selector list, the argument :is() takes, and this argument is not one.';
  readonly fix = 'Write a selector list, for example selector(.a, .b > .c).';

  /** The value the parse kept for it; a report whose value is not in the accepted tree is dropped. */
  readonly recoveredValue: object;

  constructor(offset: number, endOffset: number, recoveredValue: object) {
    super('selector() takes a selector list.');
    this.name = 'LessSelectorCaptureArgumentError';
    this.offset = offset;
    this.endOffset = endOffset;
    this.recoveredValue = recoveredValue;
  }
}

/**
 * A problem the grammar recovered from: a located error diagnostic the parse
 * carries on past (ledger P45).
 */
export type LessRecoveredError = LessMixinArgumentError | LessAmbiguousNotError | LessConditionKeywordCaseError
  | LessSelectorCaptureArgumentError | LessLeadingSeparatorValueError | LessImportantMixinReferenceError;

/**
 * Fired when a COMPILE-TIME (resolved) import carries a postlude that has no
 * wrapping desugaring. The discriminant is real-CSS-vs-compile-time, NOT a
 * dialect split (owner 2026-09-02; DESIGN-DECISIONS.md A10, §12.3b amendment):
 * a RUNTIME / real CSS `@import` (one that stays in output as a CSS at-rule)
 * carries its media/layer/supports postlude VERBATIM in every dialect — it is an
 * `AtRuleStatement`, not a compile-time import, and never reaches this error.
 *
 * Once the parser has decided an `@import` is compile-time — it carries options,
 * or its target is a loadable (non-`.css`) path — the loaded rules are spliced
 * into this document, so the resolved content cannot carry a verbatim `@import`
 * postlude. A MEDIA query is instead DESUGARED into a `@media <query>` wrapper
 * (restoring Less 4.x; less grammar `ImportStatement`), so it does not throw.
 * This error therefore fires only for a `layer`/`supports(...)` condition
 * (deferred as non-trivial, owner-accepted 2026-09-02) and every non-`@import`
 * compile-time form (`@-compose`); the author rewrites those as an explicit
 * `@media`/`@layer`/`@supports` block.
 */
/**
 * `@-import` is the dashed spelling of a Less import. Unlike bare `@import`, it
 * never detects a CSS import, so it rejects a media, `supports(...)` or `layer`
 * postlude. The `(css)` option is the one explicit request for a CSS import;
 * with it, the postlude parses and emits as a plain CSS `@import`.
 */
export class LessSourceImportSyntaxError extends SyntaxError {
  readonly code = 'parse/source-import-css-syntax' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason =
    '@-import has Less import semantics, so a CSS import condition needs the (css) option.';

  readonly fix =
    'Remove the media, supports or layer condition, or add (css) to emit a CSS @import.';

  constructor(offset: number, endOffset: number) {
    super('@-import cannot carry a media, supports or layer condition without (css).');
    this.name = 'LessSourceImportSyntaxError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

export class LessImportPostludeError extends SyntaxError {
  readonly code = 'parse/import-postlude-on-compile-time-import' as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason =
    'A layer or supports condition on a compile-time @import is not supported; a media query desugars to a @media wrapper, and a real CSS @import keeps all three verbatim.';

  readonly fix =
    'Wrap the import in an explicit @media/@layer/@supports block.';

  constructor(offset: number, endOffset: number) {
    super('A compile-time @import cannot carry a layer or supports condition.');
    this.name = 'LessImportPostludeError';
    this.offset = offset;
    this.endOffset = endOffset;
  }
}
