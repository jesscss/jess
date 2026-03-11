/**
 * @jesscss/parser-runtime — Type definitions
 *
 * Token and error types are inspired by Chevrotain's interfaces but
 * simplified for a hand-coded recursive-descent parser. The category
 * matching in tokenMatches() is limited to two levels of nesting
 * (sufficient for CSS/Less/SCSS grammars) to avoid the overhead of
 * Chevrotain's full category resolution.
 */

// ── Location info ────────────────────────────────────────────────────
// Mirrors @jesscss/core's LocationInfo. Defined locally so the runtime
// package has zero required external dependencies.

export type LocationInfo = [
  startOffset: number,
  startLine: number,
  startColumn: number,
  endOffset: number,
  endLine: number,
  endColumn: number
];

// ── Token types ──────────────────────────────────────────────────────
// Simplified from Chevrotain's token system. We keep compatibility with
// Chevrotain's IToken shape so we can reuse the existing lexer during
// the transition, but our TokenType is much simpler.

/**
 * A token type definition. Unlike Chevrotain's `createToken`, this is
 * just a plain object with a name and optional metadata.
 */
export interface TokenType {
  name: string;
  /** Human-readable label for error messages and content assist */
  LABEL?: string;
  /**
   * Parent categories this token belongs to.
   * E.g. `Gt` belongs to `['CompareOperator', 'Combinator']`.
   * Enables `tokenMatches(tok, T.CompareOperator)` to match `Gt`.
   */
  CATEGORIES?: TokenType[];
  /** Pattern (kept for lexer compatibility, not used by parser) */
  PATTERN?: RegExp | string;
  /** Chevrotain compat: tokens labeled 'Skipped' are filtered out */
  tokenTypeIdx?: number;
}

/**
 * A concrete token from the lexer.
 * Compatible with Chevrotain's IToken interface.
 */
export interface IToken {
  image: string;
  startOffset: number;
  startLine?: number;
  startColumn?: number;
  endOffset?: number;
  endLine?: number;
  endColumn?: number;
  tokenType: TokenType;
  tokenTypeIdx?: number;
  payload?: any;
}

/**
 * Check if a token matches a given token type, respecting categories.
 */
export function tokenMatches(token: IToken, expected: TokenType): boolean {
  if (token.tokenType === expected) {
    return true;
  }
  const cats = token.tokenType.CATEGORIES;
  if (cats) {
    for (let i = 0; i < cats.length; i++) {
      if (cats[i] === expected) {
        return true;
      }
      // Check one level of category nesting (categories of categories)
      const parentCats = cats[i]!.CATEGORIES;
      if (parentCats) {
        for (let j = 0; j < parentCats.length; j++) {
          if (parentCats[j] === expected) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// ── DSL types ────────────────────────────────────────────────────────

export interface OrAlternative<T = any> {
  /** Predicate: if present, this alternative is only tried when GATE returns true */
  GATE?: () => boolean;
  /** The alternative's parse action */
  ALT: () => T;
}

export interface ManyOptions {
  /** Predicate: loop continues only while GATE returns true */
  GATE?: () => boolean;
  DEF: () => void;
}

export interface ManySepOptions<T = void> {
  SEP: TokenType;
  DEF: () => T;
}

// ── Error types ──────────────────────────────────────────────────────

/**
 * Lightweight parse error — does NOT extend Error to avoid
 * V8's expensive `Error.captureStackTrace()` on every construction.
 * Parse errors use `ruleStack` for context instead of JS stack traces.
 *
 * Can still be caught with `catch(e)` and checked with `instanceof ParseError`.
 */
export class ParseError {
  name: string = 'ParseError';
  message: string;
  token: IToken;
  expected?: TokenType;
  previousToken?: IToken;
  ruleStack: string[];

  constructor(message: string, token: IToken, init?: {
    expected?: TokenType;
    previousToken?: IToken;
    ruleStack?: string[];
  }) {
    this.message = message;
    this.token = token;
    this.expected = init?.expected;
    this.previousToken = init?.previousToken;
    this.ruleStack = init?.ruleStack ?? [];
  }
}

export class MismatchedTokenError extends ParseError {
  constructor(token: IToken, expected: TokenType, ruleStack: string[]) {
    const label = expected.LABEL ?? expected.name;
    super(
      `Expecting token of type '${label}' but found '${token.image}'`,
      token,
      { expected, ruleStack }
    );
    this.name = 'MismatchedTokenError';
  }
}

export class NoViableAltError extends ParseError {
  constructor(token: IToken, ruleStack: string[]) {
    super(
      `Expecting one of the following alternatives but found '${token.image}'`,
      token,
      { ruleStack }
    );
    this.name = 'NoViableAltError';
  }
}

export class ContentAssistComplete {
  suggestions: ContentAssistSuggestion[];
  constructor(suggestions: ContentAssistSuggestion[]) {
    this.suggestions = suggestions;
  }
}

// ── Content assist types ─────────────────────────────────────────────

export interface ContentAssistSuggestion {
  nextTokenType: TokenType;
  nextTokenLabel?: string;
  ruleStack: string[];
}

// ── Parser config ────────────────────────────────────────────────────

export interface ParserConfig {
  /** Enable error recovery (for language services / linting) */
  recoveryEnabled?: boolean;
  /** Custom error message provider */
  errorMessageProvider?: ErrorMessageProvider;
}

export interface ErrorMessageProvider {
  buildMismatchTokenMessage?(options: {
    expected: TokenType;
    actual: IToken;
    ruleName: string;
  }): string;
  buildNoViableAltMessage?(options: {
    expectedPathsPerAlt: TokenType[][];
    actual: IToken[];
    ruleName: string;
  }): string;
}

// ── Sentinel ─────────────────────────────────────────────────────────

/** Sentinel token type for EOF */
export const EOF_TOKEN_TYPE: TokenType = {
  name: 'EOF',
  LABEL: 'end of input'
};

/** Create a virtual EOF token at the end of input */
export function createEOFToken(lastToken?: IToken): IToken {
  const offset = lastToken ? (lastToken.endOffset ?? lastToken.startOffset) + 1 : 0;
  const line = lastToken?.endLine ?? 1;
  const col = lastToken ? (lastToken.endColumn ?? 0) + 1 : 0;
  return {
    image: '',
    startOffset: offset,
    startLine: line,
    startColumn: col,
    endOffset: offset,
    endLine: line,
    endColumn: col,
    tokenType: EOF_TOKEN_TYPE
  };
}

/** Create a virtual token (for single-token insertion recovery) */
export function createVirtualToken(tokenType: TokenType, atToken: IToken): IToken {
  return {
    image: '',
    startOffset: atToken.startOffset,
    startLine: atToken.startLine,
    startColumn: atToken.startColumn,
    endOffset: atToken.startOffset,
    endLine: atToken.startLine,
    endColumn: atToken.startColumn,
    tokenType
  };
}
