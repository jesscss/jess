/**
 * @jesscss/parser-runtime — Hand-written recursive-descent parser
 *
 * ## Architecture overview
 *
 * This module provides a recursive-descent parser base class with a
 * Chevrotain-compatible DSL (consume, or, many, option, atLeastOne,
 * manySep). The implementation is entirely hand-coded for performance:
 * no grammar self-analysis phase (RECORDING_PHASE), no numbered DSL
 * variants, no GAST construction, and zero-allocation token matching
 * via tryConsume().
 *
 * ## Zero-cost speculative backtracking
 *
 * The key performance feature is the SPEC_FAIL sentinel mechanism for
 * backtracking in `or()`. When trying non-last, non-GATE alternatives:
 *
 * 1. `or()` sets `this.speculating = true`
 * 2. `consume()` checks `this.speculating` — on mismatch, it throws the
 *    SPEC_FAIL symbol instead of creating an Error object
 * 3. SPEC_FAIL is a frozen Symbol, not an Error — V8 does NOT capture a
 *    stack trace, making the throw+catch nearly free (~zero allocation)
 * 4. `or()` catches SPEC_FAIL by `===` reference check, restores parser
 *    state (pos, locationStack, ruleStack, errors), and tries the next alt
 *
 * This means production rules need NO special syntax — plain `consume()`
 * calls work everywhere. No GATEs are required for alt selection (though
 * GATEs can still be used for performance when the lookahead is known).
 *
 * ### Speculating flag propagation
 *
 * The `speculating` flag propagates through the entire call stack:
 *
 * - **Speculative alts** (`or()` non-last, no GATE): sets `speculating = true`
 * - **Committed alts** (`or()` GATE-match or last alt): inherits the outer
 *   `speculating` state. "Committed" means "don't try sibling alts", NOT
 *   "produce real errors". If an outer context is speculating, inner
 *   committed paths still use SPEC_FAIL on consume() mismatch.
 * - **Top-level** (non-speculative): consume() throws ParseError or uses
 *   recovery, producing real error messages for user-facing diagnostics.
 *
 * This design prevents a critical bug: if committed alts forced
 * `speculating = false`, recovery mode could insert virtual tokens inside
 * a speculative context, causing infinite recursion (the virtual token
 * doesn't advance pos, so the parser re-enters the same production).
 *
 * ### Catch behavior in DSL methods
 *
 * `OPTION()`, `MANY()`, `AT_LEAST_ONE()`, and `MANY_SEP()` all catch both
 * `ParseError` (from committed sub-paths) and `SPEC_FAIL` (from direct
 * speculative consume mismatches). This ensures these constructs work
 * correctly regardless of whether they're inside a speculative context.
 *
 * ## Recovery mode
 *
 * When `recoveryEnabled = true` (for language services / linting):
 * - `CONSUME()` inserts virtual tokens on mismatch (single-token insertion)
 * - `recoverConsume()` also tries single-token deletion
 * - `resyncTo()` provides grammar-aware re-synchronization
 * - Virtual tokens don't advance `pos`, which loop-based DSL methods
 *   (MANY, OPTION) detect via position-comparison to avoid infinite loops
 *
 * Recovery only activates in non-speculative contexts. During speculation,
 * CONSUME() throws SPEC_FAIL immediately — no recovery, no Error objects.
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
  SPEC_FAIL,
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

type ParserSavepoint = {
  pos: number;
  errorsLength: number;
  locationStack: LocationInfo[];
  ruleStack: string[];
  usedSkippedMark: number;
};

/**
 * Recursive-descent parser base class.
 *
 * Subclass this and define production rules as methods that call the DSL
 * methods: `CONSUME()`, `OR()`, `MANY()`, `OPTION()`, `AT_LEAST_ONE()`,
 * `MANY_SEP()`, `AT_LEAST_ONE_SEP()`. See the module-level JSDoc for the
 * full architecture overview including zero-cost speculative backtracking.
 *
 * ### Performance characteristics (vs Chevrotain ALL(*))
 * - ~15x faster parsing (no lookahead computation, no GAST)
 * - ~14x less memory (no Error objects during speculation)
 * - Zero-allocation token matching via `tryConsume()`
 * - Speculative backtracking via SPEC_FAIL symbol (no stack traces)
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
  /**
   * Tracks which skipped token arrays have been consumed by wrap().
   *
   * Public shape stays the same for downstream compatibility, but speculative
   * rollback no longer clones the whole Set. Instead, additions are recorded in
   * `usedSkippedTokensLog`, and speculative code restores by deleting only the
   * entries added since a saved mark.
   */
  usedSkippedTokens: Set<IToken[]> = new Set();

  /**
   * Append-only log of arrays added to `usedSkippedTokens`.
   *
   * This enables cheap rollback during speculative parsing:
   * - save a mark = current log length
   * - if speculation fails, delete only additions after that mark
   *
   * Duplicates are allowed in the log. Rollback checks `Set.delete()` and ignores
   * entries that were already removed by an inner rollback.
   */
  protected usedSkippedTokensLog: IToken[][] = [];
  /** Full original token stream including skipped tokens */
  originalInput: IToken[] = [];

  /**
   * Fast-path metadata indexed by filtered token position.
   *
   * These arrays preserve the same downstream behavior as the legacy
   * pre/post skipped-token maps, but they let hot parser paths answer
   * whitespace/separator questions in O(1) without a Map lookup or
   * per-call array scan.
   *
   * - hasWSBeforeByPos[i] => there is a WS token before `tokens[i]`
   * - hasSepBeforeByPos[i] => there is any skipped token before `tokens[i]`
   * - skippedBeforeByPos[i] => the skipped-token run before `tokens[i]`
   * - skippedAfterByPos[i] => the skipped-token run after `tokens[i]`
   */
  protected hasWSBeforeByPos: Uint8Array = new Uint8Array(0);
  protected hasSepBeforeByPos: Uint8Array = new Uint8Array(0);
  protected skippedBeforeByPos: Array<IToken[] | undefined> = [];
  protected skippedAfterByPos: Array<IToken[] | undefined> = [];

  // ── Parse state ──────────────────────────────────────────────────

  /** Accumulated parse errors */
  errors: ParseError[] = [];
  /** Accumulated parse warnings */
  warnings: ParseError[] = [];
  /** Rule name stack for error messages and content assist */
  ruleStack: string[] = [];
  /** Location stack for startRule/endRule */
  locationStack: LocationInfo[] = [];
  /**
   * When true, consume() throws the SPEC_FAIL symbol on mismatch
   * instead of creating an Error object or invoking recovery.
   *
   * Set by `or()` when trying non-last, non-GATE alternatives.
   * Propagates through committed alts (GATE/last) so that nested
   * consume() calls within a speculative context stay speculative.
   *
   * The throw+catch of a Symbol is nearly free in V8: no Error
   * allocation, no stack trace capture, no message formatting.
   *
   * @see SPEC_FAIL in types.ts for the sentinel definition
   */
  protected speculating: boolean = false;

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
   * Set the token stream.
   *
   * We still expose the same filtered parser view as before:
   * - `this.tokens` contains only non-skipped tokens
   * - `preSkippedTokenMap` / `postSkippedTokenMap` preserve trivia runs
   *
   * Internally, however, we also build parallel metadata arrays indexed
   * by filtered-token position. This avoids the old O(n²) "scan forward
   * to find the next non-skipped token" behavior and makes whitespace
   * checks (`hasWS()` / `noSep()`) O(1) array reads.
   */
  set input(value: IToken[]) {
    const preSkippedTokenMap = this.preSkippedTokenMap = new Map<number, IToken[]>();
    const postSkippedTokenMap = this.postSkippedTokenMap = new Map<number, IToken[]>();
    const inputTokens: IToken[] = [];

    const skippedBeforeByPos: Array<IToken[] | undefined> = [];
    const skippedAfterByPos: Array<IToken[] | undefined> = [];
    const hasWSBeforeByPos: number[] = [];
    const hasSepBeforeByPos: number[] = [];

    // Accumulate the current trivia run until we hit the next
    // non-skipped token, then attach that same array instance to the
    // pre/post maps and the fast-path metadata arrays.
    let pendingSkipped: IToken[] | undefined;
    let pendingHasWS = false;
    let prevFilteredIndex = -1;

    for (let i = 0; i < value.length; i++) {
      const token = value[i]!;
      if (isSkippedToken(token)) {
        if (pendingSkipped) {
          pendingSkipped.push(token);
        } else {
          pendingSkipped = [token];
        }
        if (token.tokenType.name === WS_NAME) {
          pendingHasWS = true;
        }
        continue;
      }

      const filteredIndex = inputTokens.length;
      inputTokens.push(token);

      if (pendingSkipped) {
        skippedBeforeByPos[filteredIndex] = pendingSkipped;
        hasWSBeforeByPos[filteredIndex] = pendingHasWS ? 1 : 0;
        hasSepBeforeByPos[filteredIndex] = 1;

        preSkippedTokenMap.set(token.startOffset, pendingSkipped);

        if (prevFilteredIndex >= 0) {
          skippedAfterByPos[prevFilteredIndex] = pendingSkipped;
          const prevToken = inputTokens[prevFilteredIndex]!;
          postSkippedTokenMap.set(prevToken.endOffset!, pendingSkipped);
        }

        pendingSkipped = undefined;
        pendingHasWS = false;
      } else {
        skippedBeforeByPos[filteredIndex] = undefined;
        hasWSBeforeByPos[filteredIndex] = 0;
        hasSepBeforeByPos[filteredIndex] = 0;
      }

      prevFilteredIndex = filteredIndex;
    }

    // Preserve the legacy trailing-trivia behavior:
    // - postSkippedTokenMap[lastToken.endOffset] => trailing skipped tokens
    // - preSkippedTokenMap[Infinity] => skipped tokens after the final real token
    if (pendingSkipped) {
      if (prevFilteredIndex >= 0) {
        skippedAfterByPos[prevFilteredIndex] = pendingSkipped;
        const prevToken = inputTokens[prevFilteredIndex]!;
        postSkippedTokenMap.set(prevToken.endOffset!, pendingSkipped);
      }
      preSkippedTokenMap.set(Infinity, pendingSkipped);
    }

    this.usedSkippedTokens = new Set();
    this.usedSkippedTokensLog = [];
    this.originalInput = value;
    this.tokens = inputTokens;
    this.skippedBeforeByPos = skippedBeforeByPos;
    this.skippedAfterByPos = skippedAfterByPos;
    this.hasWSBeforeByPos = Uint8Array.from(hasWSBeforeByPos);
    this.hasSepBeforeByPos = Uint8Array.from(hasSepBeforeByPos);
    this.pos = 0;
    this.errors = [];
    this.warnings = [];
    this.ruleStack = [];
    this.locationStack = [];

    // Append EOF sentinel
    this.eofToken = createEOFToken(inputTokens[inputTokens.length - 1]);
  }

  get input(): IToken[] {
    return this.tokens;
  }

  /**
   * Mark the current speculative "transaction" point for skipped-token usage.
   *
   * Any skipped-token arrays consumed after this mark can be rolled back with
   * `rollbackUsedSkippedTokens(mark)`.
   */
  protected markUsedSkippedTokens(): number {
    return this.usedSkippedTokensLog.length;
  }

  /**
   * Record that a skipped-token array has been consumed.
   *
   * This must be used instead of calling `this.usedSkippedTokens.add(tokens)`
   * directly anywhere in the parser runtime, otherwise speculative rollback
   * will miss the mutation.
   */
  protected addUsedSkippedTokens(tokens: IToken[] | undefined): void {
    if (!tokens) {
      return;
    }
    if (this.usedSkippedTokens.has(tokens)) {
      return;
    }
    this.usedSkippedTokens.add(tokens);
    this.usedSkippedTokensLog.push(tokens);
  }

  /**
   * Roll back skipped-token consumption to a previous mark.
   *
   * Deletes only arrays added after the mark, rather than cloning/restoring the
   * entire Set. This is significantly cheaper in speculative hot paths.
   */
  protected rollbackUsedSkippedTokens(mark: number): void {
    for (let i = this.usedSkippedTokensLog.length - 1; i >= mark; i--) {
      const tokens = this.usedSkippedTokensLog[i]!;
      this.usedSkippedTokens.delete(tokens);
    }
    this.usedSkippedTokensLog.length = mark;
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
    const idx = this.pos;
    const tok = idx < this.tokens.length ? this.tokens[idx]! : this.eofToken;
    return tokenMatches(tok, tokenType);
  }

  /** Check if token at lookahead offset matches the given type */
  checkAt(offset: number, tokenType: TokenType): boolean {
    if (offset === 0) {
      const tok = this.pos > 0 ? this.tokens[this.pos - 1]! : this.eofToken;
      return tokenMatches(tok, tokenType);
    }
    const idx = this.pos + offset - 1;
    const tok = idx < this.tokens.length ? this.tokens[idx]! : this.eofToken;
    return tokenMatches(tok, tokenType);
  }

  // ── Error / warning API ──────────────────────────────────────────

  /** Push a custom parse error from a production rule */
  pushError(message: string, token?: IToken): void {
    const tok = token ?? this.la(1);
    this.errors.push(new ParseError(message, tok, {
      ruleStack: [...this.ruleStack]
    }));
  }

  /** Push a custom parse warning from a production rule */
  pushWarning(message: string, token?: IToken): void {
    const tok = token ?? this.la(1);
    this.warnings.push(new ParseError(message, tok, {
      ruleStack: [...this.ruleStack]
    }));
  }

  // ── DSL: consume ─────────────────────────────────────────────────

  /**
   * Match and consume a token of the expected type.
   *
   * Behavior on mismatch depends on context:
   * 1. **Speculating** (`this.speculating = true`): throws SPEC_FAIL
   *    symbol — zero-cost, no Error object, no stack trace.
   * 2. **Recovery enabled** (`this.recoveryEnabled = true`): attempts
   *    single-token insertion/deletion via recoverConsume().
   * 3. **Neither**: throws MismatchedTokenError with full diagnostics.
   *
   * This three-tier behavior is what makes speculative backtracking
   * transparent to production rules — they just call `consume()` and
   * the parser runtime decides the cheapest failure path.
   */
  /**
   * Try to consume a token. Returns the token on match, or undefined
   * on mismatch. NEVER throws — no Error object allocation.
   *
   * Used internally by MANY(), OPTION(), MANY_SEP() to avoid
   * creating thousands of throwaway ParseError objects.
   */
  tryConsume(expected: TokenType): IToken | undefined {
    const idx = this.pos;
    const tok = idx < this.tokens.length ? this.tokens[idx]! : this.eofToken;
    if (tokenMatches(tok, expected)) {
      this.pos = idx + 1;
      return tok;
    }
    return undefined;
  }

  CONSUME(expected: TokenType): IToken {
    const idx = this.pos;
    const tok = idx < this.tokens.length ? this.tokens[idx]! : this.eofToken;

    // Content assist: if we've reached the assist offset, report this
    // expected token and keep parsing
    if (this.assistMode && tok.startOffset >= this.assistOffset) {
      this.collectAssistSuggestion(expected);
    }

    if (tokenMatches(tok, expected)) {
      this.pos = idx + 1;
      return tok;
    }

    // Speculative mode: throw the SPEC_FAIL sentinel symbol.
    // This is nearly free: no Error object, no stack trace capture,
    // no message formatting. OR() catches it by === check.
    if (this.speculating) {
      throw SPEC_FAIL;
    }

    if (this.recoveryEnabled) {
      return this.recoverConsume(expected, tok);
    }

    throw new MismatchedTokenError(tok, expected, [...this.ruleStack]);
  }

  // ── DSL: OR ───────────────────────────────────────────────────────

  /**
   * Try alternatives in order using zero-cost speculative backtracking.
   *
   * ### Alt selection strategy
   *
   * For each alternative, in order:
   * 1. If the alt has a GATE and it returns false → skip to next alt
   * 2. If the alt has a GATE that passed, or it's the last alt → **commit**
   *    (run ALT directly, inheriting the outer speculating state)
   * 3. Otherwise → **speculate** (set `speculating = true`, try ALT,
   *    catch SPEC_FAIL or ParseError on failure, restore state, try next)
   *
   * ### Why no GATEs are required
   *
   * Production rules can use plain `CONSUME()` calls without GATEs.
   * When `OR()` speculatively tries an alt and `CONSUME()` encounters
   * a wrong token, it throws SPEC_FAIL (a frozen Symbol — no Error
   * object, no stack trace). `or()` catches it by `===` check, restores
   * parser state, and tries the next alt. This is ~15x faster than
   * Chevrotain's ALL(*) lookahead computation.
   *
   * GATEs are still supported as an optimization: when you know the
   * lookahead token determines the alt, a GATE avoids even entering
   * the ALT function. But they're optional — the speculative mechanism
   * handles any grammar that Chevrotain's ALL(*) can handle.
   *
   * ### No numbered variants needed
   *
   * Unlike Chevrotain, you can call `OR()` as many times as you like
   * in the same rule without OR1/OR2/OR3 suffixes.
   */
  OR<T>(alternatives: OrAlternative<T>[]): T {
    // Content assist: at cursor, collect first tokens of all alternatives
    if (this.assistMode) {
      const tok = this.la(1);
      if (tok.startOffset >= this.assistOffset) {
        this.collectOrAssistSuggestions(alternatives);
      }
    }

    const lastIdx = alternatives.length - 1;

    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i]!;
      if (alt.GATE && !alt.GATE()) {
        continue;
      }
      if (i === lastIdx) {
        // Last alt — commit (no more siblings to try).
        return alt.ALT();
      }
      // In recovery mode, a passing GATE means we should commit to this
      // alt rather than speculating — recovery will handle any errors
      // inside, giving better error locations than falling through to
      // a wrong alt (e.g. qualifiedRule for @media input).
      if (alt.GATE && this.recoveryEnabled && !this.speculating) {
        return alt.ALT();
      }
      // Non-last alt without GATE: speculative execution via SPEC_FAIL.
      // CONSUME() throws the SPEC_FAIL symbol on mismatch — no Error
      // object, no stack trace. We catch it by === check and restore.
      const saved = this.saveState();
      const wasSpeculating = this.speculating;
      this.speculating = true;
      try {
        const result = alt.ALT();
        this.speculating = wasSpeculating;
        return result;
      } catch (e) {
        this.speculating = wasSpeculating;
        if (e === SPEC_FAIL || e instanceof ParseError) {
          // Speculative failure — restore and try next alt.
          // We catch both SPEC_FAIL (from direct CONSUME() mismatches
          // in speculative mode) and ParseError (from committed sub-paths
          // that threw a real error). From the outer speculative
          // perspective, either way the alt failed.
          this.restoreState(saved);
          continue;
        }
        // Non-parse errors bubble up
        throw e;
      }
    }

    // No alternative matched (all skipped by GATE, or all speculative failed)
    if (this.recoveryEnabled) {
      const tok = this.la(1);
      this.errors.push(new NoViableAltError(tok, [...this.ruleStack]));
      if (this.pos < this.tokens.length) {
        this.pos++;
      }
      return undefined as T;
    }
    if (this.speculating) {
      // Nested or() inside a speculative alt — bubble up
      throw SPEC_FAIL;
    }
    throw new NoViableAltError(this.la(1), [...this.ruleStack]);
  }

  // ── DSL: MANY ────────────────────────────────────────────────────

  /**
   * Zero or more repetitions. Accepts either a callback or an options
   * object with GATE + DEF (for conditional looping).
   *
   * Loop termination uses two mechanisms:
   * 1. **Position check**: if DEF doesn't advance `pos`, the loop exits.
   *    This catches recovery-mode virtual tokens (which don't advance pos).
   * 2. **Error catch**: if DEF throws ParseError or SPEC_FAIL, the loop
   *    restores state and exits. This handles both speculative and
   *    committed failure paths cleanly.
   */
  MANY(defOrOpts: (() => void) | ManyOptions): void {
    const gate = typeof defOrOpts === 'function' ? undefined : defOrOpts.GATE;
    const def = typeof defOrOpts === 'function' ? defOrOpts : defOrOpts.DEF;

    while (true) {
      if (gate && !gate()) {
        break;
      }
      const saved = this.saveState();
      try {
        def();
      } catch (e) {
        if (e instanceof ParseError || e === SPEC_FAIL) {
          this.restoreState(saved);
          break;
        }
        throw e;
      }
      // No progress means DEF didn't match (possibly only inserted
      // virtual tokens via recovery). Undo any recovery errors and stop.
      if (this.pos === saved.pos) {
        this.restoreState(saved);
        break;
      }
    }
  }

  // ── DSL: AT_LEAST_ONE ────────────────────────────────────────────

  /**
   * One or more repetitions. Same as `many()` but requires at least
   * one successful iteration. The first call to DEF may throw on
   * mismatch — that's a genuine error, not flow control.
   */
  AT_LEAST_ONE(defOrOpts: (() => void) | ManyOptions): void {
    const gate = typeof defOrOpts === 'function' ? undefined : defOrOpts.GATE;
    const def = typeof defOrOpts === 'function' ? defOrOpts : defOrOpts.DEF;

    // First iteration is mandatory — let it throw/recover normally
    def();

    // Subsequent iterations are speculative — use pos-check
    while (true) {
      if (gate && !gate()) {
        break;
      }
      const saved = this.saveState();
      try {
        def();
      } catch (e) {
        if (e instanceof ParseError || e === SPEC_FAIL) {
          this.restoreState(saved);
          break;
        }
        throw e;
      }
      if (this.pos === saved.pos) {
        this.restoreState(saved);
        break;
      }
    }
  }

  // ── DSL: OPTION ──────────────────────────────────────────────────

  /**
   * Optionally execute the callback. Returns the callback's result
   * or undefined if the callback fails to match.
   *
   * Catches both ParseError and SPEC_FAIL — works correctly whether
   * called inside or outside a speculative context. Also uses
   * position-comparison to detect recovery-mode virtual tokens.
   */
  OPTION<T>(def: () => T): T | undefined {
    const saved = this.saveState();
    try {
      const result = def();
      // OPTION() is speculative: if DEF didn't advance pos, or if
      // recovery added errors (the optional content wasn't really there),
      // undo everything.
      if (this.pos === saved.pos || this.errors.length > saved.errorsLength) {
        this.restoreState(saved);
        return undefined;
      }
      return result;
    } catch (e) {
      if (e instanceof ParseError || e === SPEC_FAIL) {
        this.restoreState(saved);
        return undefined;
      }
      throw e;
    }
  }

  // ── DSL: separated lists ─────────────────────────────────────────

  /**
   * Zero or more occurrences separated by a token.
   * Parses: (DEF (SEP DEF)*)?
   *
   * Uses tryConsume() for the separator check — zero allocation
   * on the non-matching path.
   */
  MANY_SEP<T>(opts: ManySepOptions<T>): void {
    const { SEP, DEF } = opts;
    // Try the first element — if it fails, nothing to parse
    if (!this.couldStartSep(opts)) {
      return;
    }
    const saved = this.saveState();
    try {
      DEF();
    } catch (e) {
      if (e instanceof ParseError || e === SPEC_FAIL) {
        this.restoreState(saved);
        return;
      }
      throw e;
    }
    // First element didn't advance — undo recovery artifacts and exit
    if (this.pos === saved.pos) {
      this.restoreState(saved);
      return;
    }
    // Continue with separator + element. After consuming a separator,
    // the DEF() call is committed — recovery stays enabled.
    while (this.tryConsume(SEP)) {
      DEF();
    }
  }

  /**
   * One or more occurrences separated by a token.
   * Parses: DEF (SEP DEF)*
   */
  AT_LEAST_ONE_SEP<T>(opts: ManySepOptions<T>): void {
    const { SEP, DEF } = opts;
    // First element is mandatory — let it throw if it fails
    DEF();
    // Continue with separator + element (zero-cost separator check)
    while (this.tryConsume(SEP)) {
      DEF();
    }
  }

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

  // ── Savepoint helpers ────────────────────────────────────────────

  /**
   * Take a full parser savepoint.
   *
   * This is still a full snapshot of the mutable stacks, because speculative
   * parser code may push and pop within the same ALT/loop body. But we now
   * centralize that work and pair it with transactional rollback for skipped
   * trivia consumption instead of cloning the entire usedSkippedTokens Set.
   */
  protected saveState(): ParserSavepoint {
    return {
      pos: this.pos,
      errorsLength: this.errors.length,
      locationStack: this.locationStack.slice(),
      ruleStack: this.ruleStack.slice(),
      usedSkippedMark: this.markUsedSkippedTokens()
    };
  }

  /**
   * Restore parser state from a prior savepoint.
   */
  protected restoreState(saved: ParserSavepoint): void {
    this.pos = saved.pos;
    this.errors.length = saved.errorsLength;
    this.restoreStack(this.locationStack, saved.locationStack);
    this.restoreStack(this.ruleStack, saved.ruleStack);
    this.rollbackUsedSkippedTokens(saved.usedSkippedMark);
  }

  // ── Stack restore helper ─────────────────────────────────────────

  /**
   * Restore an array to a previous snapshot.
   *
   * We write elements back manually instead of using push(...saved) so the
   * restore path stays predictable and avoids spread-call overhead.
   */
  private restoreStack<T>(arr: T[], saved: T[]): void {
    arr.length = saved.length;
    for (let i = 0; i < saved.length; i++) {
      arr[i] = saved[i]!;
    }
  }

  // ── Backtracking ─────────────────────────────────────────────────

  /**
   * Try a rule speculatively. Returns true if the rule succeeds
   * without consuming input (position is always restored).
   *
   * Use for Strategy B disambiguation (rare, ~2-3 CSS productions).
   */
  backtrack(rule: (...args: any[]) => any, ...args: any[]): boolean {
    const saved = this.saveState();
    try {
      rule.call(this, ...args);
      return true;
    } catch {
      return false;
    } finally {
      this.restoreState(saved);
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
      if (!item) {
        continue;
      }
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

    if (!found) {
      return undefined;
    }
    return [startOffset, startLine, startColumn, endOffset, endLine, endColumn];
  }

  // ── Whitespace helpers ───────────────────────────────────────────

  /**
   * Check if there is whitespace before the next token.
   * Used in GATE predicates for whitespace-sensitive productions.
   *
   * Fast path: this is an indexed lookup by filtered-token position, not
   * a Map lookup plus skipped-token scan.
   */
  hasWS(): boolean {
    if (this.pos >= this.tokens.length) {
      return false;
    }
    return this.hasWSBeforeByPos[this.pos] === 1;
  }

  /**
   * Check that there is NO whitespace or comments before the next token.
   * Used in GATE predicates (e.g., no space between function name and `(`).
   *
   * Fast path: this is an indexed lookup by filtered-token position.
   */
  noSep(offset: number = 0): boolean {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return true;
    }
    return this.hasSepBeforeByPos[idx] === 0;
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
      const idx = this.pos;
      const tok = idx < this.tokens.length ? this.tokens[idx]! : this.eofToken;
      if (tok.tokenType.name === 'LCurly') {
        depth++;
      } else if (tok.tokenType.name === 'RCurly') {
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (depth === 0) {
        let matched = false;
        for (let i = 0; i < syncTokens.length; i++) {
          if (tokenMatches(tok, syncTokens[i]!)) {
            matched = true;
            break;
          }
        }
        if (matched) {
          break;
        }
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
  protected collectAssistSuggestion(_expected: TokenType): void {
    // Don't throw — just record and keep parsing so we collect
    // suggestions from multiple call sites in sequence
    // (this is a no-op for now; suggestions are collected in or())
  }

  /** Collect suggestions from all alternatives in an or() call site */
  protected collectOrAssistSuggestions<T>(alternatives: OrAlternative<T>[]): void {
    const suggestions: ContentAssistSuggestion[] = [];
    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i]!;
      if (alt.GATE && !alt.GATE()) {
        continue;
      }
      // Try each alternative in a mini-backtrack to find its first consume()
      const saved = this.saveState();
      const savedAssist = this.assistMode;
      this.assistMode = false; // prevent recursion
      try {
        alt.ALT();
      } catch {
        // Expected — we just want the first consume()
      }
      this.restoreState(saved);
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
