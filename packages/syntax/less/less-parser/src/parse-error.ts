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
