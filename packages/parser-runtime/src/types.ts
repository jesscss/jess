/**
 * @jesscss/parser-runtime — Type definitions
 *
 * Token and error types are inspired by Chevrotain's interfaces but
 * simplified for a hand-coded recursive-descent parser. Category
 * matching in tokenMatches() uses O(1) MATCH_SET lookups when
 * buildTokenMatchBitsets() has been called during parser initialization.
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
/** Token type with optional precomputed match set for O(1) lookups */
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
  /**
   * Precomputed set of all types this token matches (self + categories transitively).
   * Populated by buildTokenMatchSets() for O(1) tokenMatches() lookups.
   */
  MATCH_SET?: Set<TokenType>;
  /** Pattern (kept for lexer compatibility, not used by parser) */
  PATTERN?: RegExp | string;
  /** Chevrotain compat: tokens labeled 'Skipped' are filtered out */
  tokenTypeIdx?: number;
}

/** Helper: get categories from token type (Chevrotain uses lowercase `categories`) */
function getCategories(tt: TokenType): TokenType[] | undefined {
  const t = tt as TokenType & { categories?: TokenType[] };
  return t.CATEGORIES ?? t.categories;
}
type TokenTypeWithBits = TokenType & {
  TOKEN_ID?: number;
  MATCH_BITS?: Uint32Array;
};

export function buildTokenMatchBitsets(tokenTypes: TokenType[]): void {
  const types = tokenTypes as TokenTypeWithBits[];
  const wordCount = Math.ceil(types.length / 32);
  const visiting = new Set<TokenTypeWithBits>();

  for (let i = 0; i < types.length; i++) {
    types[i]!.TOKEN_ID = i;
  }

  function setBit(bits: Uint32Array, tokenType: TokenTypeWithBits): void {
    const id = tokenType.TOKEN_ID;
    if (id == null) {
      throw new Error('Token type missing TOKEN_ID during bitset construction.');
    }
    bits[id >>> 5]! |= 1 << (id & 31);
  }

  function orBits(target: Uint32Array, source: Uint32Array): void {
    for (let i = 0; i < target.length; i++) {
      target[i]! |= source[i]!;
    }
  }

  function computeMatchBits(tokenType: TokenTypeWithBits): Uint32Array {
    if (tokenType.MATCH_BITS) {
      return tokenType.MATCH_BITS;
    }

    if (visiting.has(tokenType)) {
      const partial = new Uint32Array(wordCount);
      setBit(partial, tokenType);
      return partial;
    }

    visiting.add(tokenType);

    const bits = new Uint32Array(wordCount);
    setBit(bits, tokenType);

    for (const category of (getCategories(tokenType) ?? []) as TokenTypeWithBits[]) {
      setBit(bits, category);
      orBits(bits, computeMatchBits(category));
    }

    visiting.delete(tokenType);
    tokenType.MATCH_BITS = bits;
    return bits;
  }

  for (const tokenType of types) {
    computeMatchBits(tokenType);
  }
}

export function buildTokenTypeSet(tokenTypes: TokenType[]): Uint32Array {
  const types = tokenTypes as TokenTypeWithBits[];

  if (types.length === 0) {
    throw new Error('Cannot build token set from an empty token list.');
  }

  const wordCount = types[0]!.MATCH_BITS?.length;
  if (wordCount == null) {
    throw new Error(
      'Token types not initialized. Call buildTokenMatchBitsets(...) first.'
    );
  }

  const bits = new Uint32Array(wordCount);

  for (const tokenType of types) {
    const id = tokenType.TOKEN_ID;
    if (id == null) {
      throw new Error('Token type missing TOKEN_ID during token-set construction.');
    }
    bits[id >>> 5]! |= 1 << (id & 31);
  }

  return bits;
}

export function tokenTypeInSet(tokenType: TokenType, setBits: Uint32Array): boolean {
  const tt = tokenType as TokenTypeWithBits;
  const id = tt.TOKEN_ID;
  if (id == null) {
    throw new Error('Token type missing TOKEN_ID during token-set lookup.');
  }
  return (setBits[id >>> 5]! & (1 << (id & 31))) !== 0;
}

export function tokenMatches(token: IToken, expected: TokenType): boolean {
  const tt = token.tokenType as TokenTypeWithBits;
  if (tt === expected) {
    return true;
  }

  const bits = tt.MATCH_BITS;
  if (!bits) {
    throw new Error(
      'Token types not initialized. Call buildTokenMatchBitsets(Object.values(T)) before parsing.'
    );
  }

  const expectedId = (expected as TokenTypeWithBits).TOKEN_ID;
  if (expectedId == null) {
    throw new Error(
      'Expected token type missing TOKEN_ID. Make sure buildTokenMatchBitsets() was called with the full token list.'
    );
  }

  return (bits[expectedId >>> 5]! & (1 << (expectedId & 31))) !== 0;
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

// ── Speculative failure sentinel ──────────────────────────────────────
//
// When or() tries a non-last alternative speculatively, consume() throws
// this frozen singleton instead of creating an Error object. Because it's
// a plain frozen object (not an Error), V8 does NOT capture a stack trace,
// making the throw+catch nearly free. or() catches it by reference
// equality (===), restores parser state, and tries the next alternative.
//
// This is the key mechanism that makes backtracking zero-cost:
// - No Error object allocation
// - No stack trace capture
// - No message string formatting
// - Caught by === check, not instanceof
//
export const SPEC_FAIL: unique symbol = Symbol('SPEC_FAIL');

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
