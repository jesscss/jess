/**
 * @jesscss/parser-runtime — Hand-written recursive-descent parser
 *
 * The DSL method names (CONSUME, OR, MANY, OPTION, AT_LEAST_ONE, etc.)
 * and the overall production-rule structure were inspired by Chevrotain
 * (https://chevrotain.io). The implementation is entirely hand-coded for
 * greater performance: no grammar self-analysis phase (RECORDING_PHASE),
 * no numbered DSL variants, no GAST construction, and zero-allocation
 * token matching via tryConsume().
 */
import {
  type LocationInfo,
  type IToken,
  type TokenType,
  type OrAlternative,
  type ManyOptions,
  type ManySepOptions,
  type ParserConfig,
  type ErrorMessageProvider,
  tokenMatches,
  ParseError,
  MismatchedTokenError,
  NoViableAltError,
  EOF_TOKEN_TYPE,
  createEOFToken,
  createVirtualToken,
  type ContentAssistSuggestion,
  ContentAssistComplete
} from './types.js';

/** Label applied to tokens that should be filtered from the parse stream */
export const SKIPPED_LABEL = 'Skipped';
/** Token name for whitespace */
export const WS_NAME = 'WS';

/**
 * Hand-written recursive-descent parser runtime.
 *
 * Provides the same DSL methods as Chevrotain's EmbeddedActionsParser
 * (consume, or, many, option, atLeastOne, manySep, atLeastOneSep)
 * but without the RECORDING_PHASE, self-analysis, numbered variants,
 * or GAST infrastructure.
 *
 * PERFORMANCE NOTE: The DSL methods (many, option, manySep) do NOT use
 * try-catch for flow control. Instead, `consume()` throws only for
 * genuine parse failures, and loop/optional methods use `check()` or
 * position-comparison to decide whether to continue. This avoids
 * creating thousands of throwaway Error objects (V8 captures stack
 * traces on every `new Error()`).
 */
export class RecursiveDescentParser {
  // ── Token stream ─────────────────────────────────────────────────

  /** The filtered token stream (no skipped tokens) */
  protected tokens: IToken[] = [];
  /** Current position in the token stream */
  protected pos: number = 0;
  /** Sentinel EOF token appended to the stream */
  protected eofToken!: IToken;

  /** Maps token startOffset → preceding skipped tokens (WS/comments) */
  preSkippedTokenMap: Map<number, IToken[]> = new Map();
  /** Maps previous token endOffset → following skipped tokens */
  postSkippedTokenMap: Map<number, IToken[]> = new Map();
  /** Tracks which skipped token arrays have been consumed by wrap() */
  usedSkippedTokens: Set<IToken[]> = new Set();
  /** Full original token stream including skipped tokens */
  originalInput: IToken[] = [];

  // ── Parse state ──────────────────────────────────────────────────

  /** Accumulated parse errors */
  errors: ParseError[] = [];
  /** Rule name stack for error messages and content assist */
  protected ruleStack: string[] = [];
  /** Location stack for startRule/endRule */
  locationStack: LocationInfo[] = [];

  // ── Configuration ────────────────────────────────────────────────

  recoveryEnabled: boolean;
  protected errorMessageProvider?: ErrorMessageProvider;

  // ── Tree context ─────────────────────────────────────────────────
  // TreeContext is defined in @jesscss/core. The parser runtime uses
  // `any` here to avoid the dependency; concrete parser subclasses
  // (CssActionsParser, etc.) will narrow the type.

  protected _context: any;

  get context(): any {
    return this._context;
  }

  set context(c: any) {
    this._context = c;
  }

  // ── Content assist state ─────────────────────────────────────────

  /** When true, the parser is in content-assist mode */
  protected assistMode: boolean = false;
  /** The offset at which to collect suggestions */
  protected assistOffset: number = -1;

  // ── Constructor ──────────────────────────────────────────────────

  constructor(config: ParserConfig = {}) {
    this.recoveryEnabled = config.recoveryEnabled ?? false;
    this.errorMessageProvider = config.errorMessageProvider;
  }

  // ── Input ────────────────────────────────────────────────────────

  /**
   * Set the token stream. Separates skipped tokens (WS, comments)
   * into pre/post maps, just like AdvancedActionsParser does.
   */
  set input(value: IToken[]) {
    const preSkippedTokenMap = this.preSkippedTokenMap = new Map();
    const postSkippedTokenMap = this.postSkippedTokenMap = new Map();
    const inputTokens: IToken[] = [];
    const len = value.length;
    let prevToken: IToken | undefined;

    for (let i = 0; i < len; i++) {
      const token = value[i]!;
      // Find next non-skipped token
      let nextToken: IToken | undefined;
      for (let j = i + 1; j < len; j++) {
        const candidate = value[j]!;
        if (!isSkippedToken(candidate)) {
          nextToken = candidate;
          break;
        }
      }

      if (isSkippedToken(token)) {
        const beforeIndex = nextToken?.startOffset ?? Infinity;
        let tokens = preSkippedTokenMap.get(beforeIndex);
        if (tokens) {
          tokens.push(token);
        } else {
          tokens = [token];
          preSkippedTokenMap.set(beforeIndex, tokens);
        }
        if (prevToken) {
          postSkippedTokenMap.set(prevToken.endOffset!, tokens);
        }
      } else {
        prevToken = token;
        inputTokens.push(token);
      }
    }

    this.usedSkippedTokens = new Set();
    this.originalInput = value;
    this.tokens = inputTokens;
    this.pos = 0;
    this.errors = [];
    this.ruleStack = [];
    this.locationStack = [];

    // Append EOF sentinel
    this.eofToken = createEOFToken(inputTokens[inputTokens.length - 1]);
  }

  get input(): IToken[] {
    return this.tokens;
  }

  // ── Lookahead ────────────────────────────────────────────────────

  /**
   * Look ahead `offset` tokens from current position.
   * `la(1)` = next token, `la(0)` = last consumed token.
   */
  la(offset: number): IToken {
    if (offset === 0) {
      // Last consumed token
      return this.pos > 0 ? this.tokens[this.pos - 1]! : this.eofToken;
    }
    const idx = this.pos + offset - 1;
    if (idx >= this.tokens.length) {
      return this.eofToken;
    }
    return this.tokens[idx]!;
  }

  /** Alias for la() — compatibility with Chevrotain's LA() */
  LA(offset: number): IToken {
    return this.la(offset);
  }

  /** Check if the next token matches the given type */
  check(tokenType: TokenType): boolean {
    return tokenMatches(this.la(1), tokenType);
  }

  /** Check if token at lookahead offset matches the given type */
  checkAt(offset: number, tokenType: TokenType): boolean {
    return tokenMatches(this.la(offset), tokenType);
  }

  // ── DSL: consume ─────────────────────────────────────────────────

  /**
   * Match and consume a token of the expected type.
   * If the token doesn't match and recovery is enabled, attempts
   * single-token insertion or deletion.
   *
   * THROWS on mismatch (when not in recovery mode). This is the only
   * DSL method that throws for expected parse flow — and only when
   * no recovery is possible.
   */
  consume(expected: TokenType): IToken {
    const tok = this.la(1);

    // Content assist: if we've reached the assist offset, report this
    // expected token and keep parsing
    if (this.assistMode && tok.startOffset >= this.assistOffset) {
      this.collectAssistSuggestion(expected);
    }

    if (tokenMatches(tok, expected)) {
      this.pos++;
      return tok;
    }

    if (this.recoveryEnabled) {
      return this.recoverConsume(expected, tok);
    }

    throw new MismatchedTokenError(tok, expected, [...this.ruleStack]);
  }

  /**
   * Try to consume a token. Returns the token on match, or undefined
   * on mismatch. NEVER throws — no Error object allocation.
   *
   * Used internally by many(), option(), manySep() to avoid
   * creating thousands of throwaway ParseError objects.
   */
  tryConsume(expected: TokenType): IToken | undefined {
    const tok = this.la(1);
    if (tokenMatches(tok, expected)) {
      this.pos++;
      return tok;
    }
    return undefined;
  }

  /** Alias — Chevrotain compatibility */
  CONSUME(expected: TokenType): IToken { return this.consume(expected); }

  // ── DSL: or ──────────────────────────────────────────────────────

  /**
   * Try alternatives in order. Each alternative can have a GATE
   * predicate; if present, the alternative is only tried when
   * the GATE returns true.
   *
   * No numbered variants needed — call `or()` as many times as
   * you like in the same rule.
   */
  or<T>(alternatives: OrAlternative<T>[]): T {
    // Content assist: at cursor, collect first tokens of all alternatives
    if (this.assistMode) {
      const tok = this.la(1);
      if (tok.startOffset >= this.assistOffset) {
        this.collectOrAssistSuggestions(alternatives);
      }
    }

    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i]!;
      if (alt.GATE && !alt.GATE()) {
        continue;
      }
      // If no GATE, this alternative is the default fallback.
      // With a GATE, the GATE already confirmed we should enter.
      // Either way, try it.
      if (alt.GATE || i === alternatives.length - 1) {
        return alt.ALT();
      }
      // No GATE and not last: need a way to decide. If the alternative
      // has no GATE and there are more alternatives, it acts as default.
      // But typically, all non-last alternatives should have a GATE.
      return alt.ALT();
    }

    // No alternative matched
    const tok = this.la(1);
    if (this.recoveryEnabled) {
      this.errors.push(new NoViableAltError(tok, [...this.ruleStack]));
      return undefined as T;
    }
    throw new NoViableAltError(tok, [...this.ruleStack]);
  }

  /** Alias — Chevrotain compatibility */
  OR<T>(alternatives: OrAlternative<T>[]): T { return this.or(alternatives); }

  // ── DSL: many ────────────────────────────────────────────────────

  /**
   * Zero or more repetitions. Accepts either a callback or an options
   * object with GATE + DEF (for conditional looping).
   *
   * IMPORTANT: Does NOT use try-catch for flow control. The DEF
   * callback must either consume tokens (advancing pos) or throw.
   * If pos doesn't advance, the loop exits. If DEF throws a
   * ParseError, the loop exits and restores position (but does NOT
   * allocate a new Error object — the thrown one is caught and
   * discarded, not created speculatively).
   */
  many(defOrOpts: (() => void) | ManyOptions): void {
    const gate = typeof defOrOpts === 'function' ? undefined : defOrOpts.GATE;
    const def = typeof defOrOpts === 'function' ? defOrOpts : defOrOpts.DEF;

    while (true) {
      if (gate && !gate()) {
        break;
      }
      const prevPos = this.pos;
      try {
        def();
      } catch (e) {
        if (e instanceof ParseError) {
          // DEF's consume() threw because it couldn't match.
          // That error object was created by consume() — we didn't create
          // it speculatively. Restore position and exit loop.
          this.pos = prevPos;
          break;
        }
        throw e;
      }
      // Infinite loop detection: if DEF didn't advance, stop
      if (this.pos === prevPos) {
        break;
      }
    }
  }

  /** Alias — Chevrotain compatibility */
  MANY(defOrOpts: (() => void) | ManyOptions): void { this.many(defOrOpts); }

  // ── DSL: atLeastOne ──────────────────────────────────────────────

  /**
   * One or more repetitions. Same as `many()` but requires at least
   * one successful iteration. The first call to DEF may throw on
   * mismatch — that's a genuine error, not flow control.
   */
  atLeastOne(defOrOpts: (() => void) | ManyOptions): void {
    const gate = typeof defOrOpts === 'function' ? undefined : defOrOpts.GATE;
    const def = typeof defOrOpts === 'function' ? defOrOpts : defOrOpts.DEF;

    // First iteration is mandatory — let it throw if it fails
    def();

    while (true) {
      if (gate && !gate()) {
        break;
      }
      const prevPos = this.pos;
      try {
        def();
      } catch (e) {
        if (e instanceof ParseError) {
          this.pos = prevPos;
          break;
        }
        throw e;
      }
      if (this.pos === prevPos) {
        break;
      }
    }
  }

  /** Alias — Chevrotain compatibility */
  AT_LEAST_ONE(defOrOpts: (() => void) | ManyOptions): void { this.atLeastOne(defOrOpts); }

  // ── DSL: option ──────────────────────────────────────────────────

  /**
   * Optionally execute the callback. Returns the callback's result
   * or undefined if the callback fails to match.
   *
   * Uses try-catch but only catches ParseErrors that consume()
   * already created — no speculative Error allocation here.
   */
  option<T>(def: () => T): T | undefined {
    const prevPos = this.pos;
    try {
      return def();
    } catch (e) {
      if (e instanceof ParseError) {
        this.pos = prevPos;
        return undefined;
      }
      throw e;
    }
  }

  /** Alias — Chevrotain compatibility */
  OPTION<T>(def: () => T): T | undefined { return this.option(def); }

  // ── DSL: separated lists ─────────────────────────────────────────

  /**
   * Zero or more occurrences separated by a token.
   * Parses: (DEF (SEP DEF)*)?
   *
   * Uses tryConsume() for the separator check — zero allocation
   * on the non-matching path.
   */
  manySep<T>(opts: ManySepOptions<T>): void {
    const { SEP, DEF } = opts;
    // Try the first element — if it fails, nothing to parse
    if (!this.couldStartSep(opts)) {
      return;
    }
    const prevPos = this.pos;
    try {
      DEF();
    } catch (e) {
      if (e instanceof ParseError) {
        this.pos = prevPos;
        return;
      }
      throw e;
    }
    // Continue with separator + element (separator check is zero-cost)
    while (this.tryConsume(SEP)) {
      DEF();
    }
  }

  /** Alias — Chevrotain compatibility */
  MANY_SEP<T>(opts: ManySepOptions<T>): void { this.manySep(opts); }

  /**
   * One or more occurrences separated by a token.
   * Parses: DEF (SEP DEF)*
   */
  atLeastOneSep<T>(opts: ManySepOptions<T>): void {
    const { SEP, DEF } = opts;
    // First element is mandatory — let it throw if it fails
    DEF();
    // Continue with separator + element (zero-cost separator check)
    while (this.tryConsume(SEP)) {
      DEF();
    }
  }

  /** Alias — Chevrotain compatibility */
  AT_LEAST_ONE_SEP<T>(opts: ManySepOptions<T>): void { this.atLeastOneSep(opts); }

  /**
   * Override point: can the next token start a separated list element?
   * Default returns true (try and see). Subclasses can override for
   * specific token checks to avoid entering DEF at all.
   */
  protected couldStartSep<T>(_opts: ManySepOptions<T>): boolean {
    return true;
  }

  // ── DSL: subrule ─────────────────────────────────────────────────

  /**
   * Call a sub-rule. Tracks the rule name on the stack for error
   * messages, and validates locationStack integrity.
   */
  subrule<T>(rule: (...args: any[]) => T, ...args: any[]): T {
    const ruleName = rule.name || '(anonymous)';
    const preStackLen = this.locationStack.length;
    this.ruleStack.push(ruleName);

    let result: T;
    try {
      result = rule.call(this, ...args);
    } catch (e) {
      // Unwind location stack if rule threw before endRule()
      if (this.recoveryEnabled) {
        while (this.locationStack.length > preStackLen) {
          this.locationStack.pop();
        }
      }
      this.ruleStack.pop();
      throw e;
    }

    // Validate locationStack integrity in non-recovery mode
    if (!this.recoveryEnabled && this.locationStack.length !== preStackLen) {
      const msg = `Rule ${ruleName} did not call endRule()`;
      this.ruleStack.pop();
      throw new Error(msg);
    }
    // Unwind if recovery-enabled and stack is off
    while (this.locationStack.length > preStackLen) {
      this.locationStack.pop();
    }

    this.ruleStack.pop();
    return result;
  }

  // ── Backtracking ─────────────────────────────────────────────────

  /**
   * Try a rule speculatively. Returns true if the rule succeeds
   * without consuming input (position is always restored).
   *
   * Use for Strategy B disambiguation (rare, ~2-3 CSS productions).
   */
  backtrack(rule: (...args: any[]) => any, ...args: any[]): boolean {
    const savedPos = this.pos;
    const savedErrors = this.errors.length;
    try {
      rule.call(this, ...args);
      return true;
    } catch {
      return false;
    } finally {
      this.pos = savedPos;
      this.errors.length = savedErrors;
    }
  }

  // ── Location tracking ────────────────────────────────────────────

  /**
   * Mark the start of a rule. Pushes a location tuple onto the stack.
   * Call endRule() to complete it.
   */
  startRule(): LocationInfo {
    const tok = this.la(1);
    const location: LocationInfo = [
      tok.startOffset,
      tok.startLine ?? NaN,
      tok.startColumn ?? NaN,
      NaN, NaN, NaN
    ];
    this.locationStack.push(location);
    return location;
  }

  /**
   * Mark the end of a rule. Pops the location tuple and fills in
   * end coordinates from the last consumed token.
   */
  endRule(): LocationInfo {
    const tok = this.la(0);
    const location = this.locationStack.pop()!;
    location[3] = tok.endOffset ?? tok.startOffset;
    location[4] = tok.endLine ?? tok.startLine ?? NaN;
    location[5] = tok.endColumn ?? tok.startColumn ?? NaN;
    return location;
  }

  /** Convert a token to a LocationInfo tuple */
  getLocationInfo(tok: IToken): LocationInfo {
    if (tok.tokenType === EOF_TOKEN_TYPE) {
      return [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
    }
    return [
      tok.startOffset,
      tok.startLine!,
      tok.startColumn!,
      tok.endOffset!,
      tok.endLine!,
      tok.endColumn!
    ];
  }

  /** Build LocationInfo spanning a list of tokens and/or nodes */
  getLocationFromNodes(nodes: Array<IToken | { location?: LocationInfo | [] }>): LocationInfo | undefined {
    let startOffset = Infinity;
    let startLine = Infinity;
    let startColumn = Infinity;
    let endOffset = -Infinity;
    let endLine = -Infinity;
    let endColumn = -Infinity;
    let found = false;

    for (const item of nodes) {
      if (!item) continue;
      if ('tokenType' in item) {
        // IToken
        if (item.startOffset < startOffset) {
          startOffset = item.startOffset;
          startLine = item.startLine!;
          startColumn = item.startColumn!;
        }
        if ((item.endOffset ?? -Infinity) > endOffset) {
          endOffset = item.endOffset!;
          endLine = item.endLine!;
          endColumn = item.endColumn!;
        }
        found = true;
      } else if (item.location && item.location.length === 6) {
        // Node with LocationInfo
        const loc = item.location as LocationInfo;
        if (loc[0] < startOffset) {
          startOffset = loc[0];
          startLine = loc[1];
          startColumn = loc[2];
        }
        if (loc[3] > endOffset) {
          endOffset = loc[3];
          endLine = loc[4];
          endColumn = loc[5];
        }
        found = true;
      }
    }

    if (!found) return undefined;
    return [startOffset, startLine, startColumn, endOffset, endLine, endColumn];
  }

  // ── Whitespace helpers ───────────────────────────────────────────

  /**
   * Check if there is whitespace before the next token.
   * Used in GATE predicates for whitespace-sensitive productions.
   */
  hasWS(): boolean {
    const startOffset = this.la(1).startOffset;
    const skipped = this.preSkippedTokenMap.get(startOffset);
    if (!skipped) return false;
    return skipped.some(t => t.tokenType.name === WS_NAME);
  }

  /**
   * Check that there is NO whitespace or comments before the next token.
   * Used in GATE predicates (e.g., no space between function name and `(`).
   */
  noSep(offset: number = 0): boolean {
    const startOffset = this.la(1 + offset).startOffset;
    return !this.preSkippedTokenMap.get(startOffset);
  }

  // ── Type guard ───────────────────────────────────────────────────

  isToken(node: any): node is IToken {
    return Boolean(node && 'tokenType' in node);
  }

  // ── Error recovery ───────────────────────────────────────────────

  /**
   * Attempt to recover from a mismatched token.
   *
   * Tier 1: Single-token deletion — if LA(2) matches, skip the bad token.
   * Tier 1: Single-token insertion — if the expected token is in the
   *         follow context, insert a virtual token.
   *
   * Falls back to reporting the error and returning a virtual token
   * so parsing can continue.
   */
  protected recoverConsume(expected: TokenType, actual: IToken): IToken {
    // Try single-token deletion: skip current token, check if next matches
    const la2 = this.la(2);
    if (tokenMatches(la2, expected)) {
      this.errors.push(new MismatchedTokenError(actual, expected, [...this.ruleStack]));
      this.pos++; // skip bad token
      this.pos++; // consume the good one
      return la2;
    }

    // Default: report error and insert virtual token so parsing continues
    this.errors.push(new MismatchedTokenError(actual, expected, [...this.ruleStack]));
    return createVirtualToken(expected, actual);
  }

  /**
   * Grammar-aware re-synchronization (Tier 2).
   * Skips tokens until finding one of the given sync token types,
   * respecting curly-brace nesting depth.
   */
  resyncTo(...syncTokens: TokenType[]): void {
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const tok = this.la(1);
      if (tok.tokenType.name === 'LCurly') {
        depth++;
      } else if (tok.tokenType.name === 'RCurly') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && syncTokens.some(t => tokenMatches(tok, t))) {
        break;
      }
      this.pos++;
    }
  }

  // ── Content assist ───────────────────────────────────────────────

  /**
   * Run the parser in content-assist mode. Parses the token stream
   * up to `offset`, then collects valid next tokens.
   *
   * Uses the "assist-mode parsing" approach: parse normally until
   * hitting the cursor, then collect suggestions from consume() and
   * or() call sites.
   */
  suggest(
    tokens: IToken[],
    offset: number,
    startRule: (this: this) => any
  ): ContentAssistSuggestion[] {
    this.input = tokens;
    this.assistMode = true;
    this.assistOffset = offset;

    const suggestions: ContentAssistSuggestion[] = [];

    try {
      startRule.call(this);
    } catch (e) {
      if (e instanceof ContentAssistComplete) {
        suggestions.push(...e.suggestions);
      }
      // Other errors are expected — we may be parsing incomplete input
    }

    this.assistMode = false;
    this.assistOffset = -1;
    return suggestions;
  }

  /** Collect a suggestion from a consume() call site */
  protected collectAssistSuggestion(expected: TokenType): void {
    // Don't throw — just record and keep parsing so we collect
    // suggestions from multiple call sites in sequence
    // (this is a no-op for now; suggestions are collected in or())
  }

  /** Collect suggestions from all alternatives in an or() call site */
  protected collectOrAssistSuggestions<T>(alternatives: OrAlternative<T>[]): void {
    const suggestions: ContentAssistSuggestion[] = [];
    for (const alt of alternatives) {
      if (alt.GATE && !alt.GATE()) continue;
      // Try each alternative in a mini-backtrack to find its first consume()
      const savedPos = this.pos;
      const savedAssist = this.assistMode;
      this.assistMode = false; // prevent recursion
      try {
        alt.ALT();
      } catch {
        // Expected — we just want the first consume()
      }
      this.pos = savedPos;
      this.assistMode = savedAssist;
    }
    if (suggestions.length > 0) {
      throw new ContentAssistComplete(suggestions);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function isSkippedToken(t: IToken): boolean {
  const name = t.tokenType.name;
  return t.tokenType.LABEL === SKIPPED_LABEL || name === WS_NAME || /Comment/i.test(name);
}
