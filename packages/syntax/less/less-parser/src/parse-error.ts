/** Structured failure from the public direct Less parser. */
export class LessParseError extends SyntaxError {
  readonly code = "parse/syntax-error" as const;
  readonly offset: number;
  readonly expected: readonly string[];
  readonly reason?: string;
  readonly fix?: string;

  constructor(
    offset: number,
    expected: readonly string[],
    options: { message?: string; reason?: string; fix?: string } = {}
  ) {
    const detail =
      expected.length > 0 ? ` Expected: ${expected.join(", ")}.` : "";
    super(options.message ?? `Unexpected Less syntax.${detail}`);
    this.name = "LessParseError";
    this.offset = offset;
    this.expected = expected;
    this.reason = options.reason;
    this.fix = options.fix;
  }
}

/** Interpolation is rejected inside the CSS @charset token. */
export class LessDynamicCharsetError extends SyntaxError {
  readonly code = "parse/dynamic-charset" as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = "Interpolation is not valid inside the CSS @charset token.";
  readonly fix = 'Use a static declaration such as @charset "UTF-8";.';

  constructor(offset: number, endOffset: number) {
    super("Interpolation is not valid in @charset.");
    this.name = "LessDynamicCharsetError";
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/** Executable inline backtick JavaScript is recognized so diagnostics can be precise. */
export class LessInlineJavaScriptError extends SyntaxError {
  readonly code = "parse/unsupported-inline-javascript" as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason = "Backtick JavaScript expressions are not evaluated.";
  readonly fix =
    "Move the expression into an explicit @from/@-from script import or a plugin function.";

  constructor(offset: number, endOffset: number) {
    super("Inline backtick JavaScript is not supported.");
    this.name = "LessInlineJavaScriptError";
    this.offset = offset;
    this.endOffset = endOffset;
  }
}

/** Syntax/prelude slots require explicit @{name} interpolation. */
export class LessBareVariableInterpolationError extends SyntaxError {
  readonly code = "parse/unsupported-bare-variable-interpolation" as const;
  readonly offset: number;
  readonly endOffset: number;
  readonly reason: string;
  readonly fix: string;

  constructor(offset: number, endOffset: number, name: string) {
    super("Bare @variable interpolation is not valid here.");
    this.name = "LessBareVariableInterpolationError";
    this.offset = offset;
    this.endOffset = endOffset;
    this.reason =
      "Bare @variable references are values; syntax and prelude interpolation must use @{variable}.";
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
