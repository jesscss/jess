// @ts-nocheck — Retired Chevrotain parser. Uses the legacy 6-tuple `.location`
// shape removed from Node in the provenance-side-table refactor; the functional
// Parséman grammar (grammar.ts + builders.ts) is the maintained parser. Kept only
// for the content-assist/error-recovery paths not yet ported. Not type-checked.
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
/**
 * CssRecursiveParser — Chevrotain EmbeddedActionsParser-based CSS parser
 *
 * Extends Chevrotain's EmbeddedActionsParser with Jess-specific infrastructure:
 * - Filtered input (skipped tokens removed) with a file-context trivia map
 * - AST building helpers (getLocationInfo, startRule, endRule)
 * - Token category matching via categoryMatchesMap for gate predicates
 */
import { EmbeddedActionsParser, EOF, tokenMatcher } from 'chevrotain';
import type { IToken, TokenType, ParserMethod } from 'chevrotain';

export type Rule<F extends (...args: any[]) => void = (ctx?: RuleContext) => void> = ParserMethod<Parameters<F>, any>;

import type { IParseResult, LocationInfo } from '@jesscss/core';

import {
  TreeContext,
  Node,
  Color,
  ColorFormat,
  createTriviaMap,
  makeTrivia,
  type Trivia,
  Dimension,
  Num,
  Rules,
  Any,
  Comment
} from '@jesscss/core';

import colors from 'color-name';

import { type CssTokenType, SKIPPED_LABEL } from './cssTokens.js';

export { tokenMatcher };

export type TokenMap = Record<CssTokenType, TokenType>;

// ── Import production rule implementations ──────────────────────────
import * as productions from './productions/index.js';

function isSkippedToken(t: IToken): boolean {
  return (t.tokenType as { LABEL?: string }).LABEL === SKIPPED_LABEL;
}

/**
 * The legacy parser's internal trivia index over token-array runs. Distinct from
 * the core `TriviaMap` (which is source-range based); converted at the boundary.
 */
interface LegacyTriviaMap {
  lookup(offset: number | undefined, direction: 'before' | 'after'): IToken[] | undefined;
  entries(direction: 'before' | 'after'): IterableIterator<[number, IToken[]]>;
  has(offset: number | undefined, direction: 'before' | 'after'): boolean;
}

function createLegacyTriviaMap(
  before: Map<number, IToken[]>,
  after: Map<number, IToken[]>
): LegacyTriviaMap {
  return {
    lookup: (offset, direction) =>
      offset === undefined ? undefined : (direction === 'before' ? before.get(offset) : after.get(offset)),
    entries: direction => (direction === 'before' ? before : after).entries(),
    has: (offset, direction) =>
      offset === undefined ? false : (direction === 'before' ? before : after).has(offset)
  };
}

// ── Types ────────────────────────────────────────────────────────────

export type RuleContext = {
  /** Inside a declaration list */
  inner?: boolean;
  /** Determine if this is the first selector in the list */
  firstSelector?: boolean;
  /** If downstream selector rules are part of a qualified rule */
  qualifiedRule?: boolean;
  /** Inside a custom property value */
  inCustomPropertyValue?: boolean;
  /** Is root stylesheet */
  isRoot?: boolean;

  [k: string]: object | boolean | string | object[] | number | undefined;
};

export interface CssRecursiveParserConfig {
  /** Things like star property hacks and IE filters */
  legacyMode?: boolean;
  /** Enable error recovery (for language services) */
  recoveryEnabled?: boolean;
  /** Temporary escape hatch for grammars still being migrated to strict self-analysis. */
  skipValidations?: boolean;
}

// ── Parser ───────────────────────────────────────────────────────────

/**
 * @deprecated LEGACY — Chevrotain-based CSS parser engine. Superseded by the
 * functional macro grammar (`parseCssFn` / `CssParser` builders in ./grammar.ts +
 * ./builders.ts). Kept only for benchmarking; TO BE DELETED once the functional
 * parser fully lands.
 */
export class CssRecursiveParser extends EmbeddedActionsParser {
  /** Chevrotain uses RECORDING_PHASE during performSelfAnalysis */
  declare RECORDING_PHASE: boolean;

  /** Chevrotain internals — not in public type defs */
  declare tokVector: IToken[];
  declare tokVectorLength: number;
  declare currIdx: number;

  T: TokenMap;
  legacyMode: boolean;
  ruleIndex = 0;

  /**
   * Internal token-run trivia index for this (legacy Chevrotain) parser. Kept on
   * `IToken[]` runs because the descendant-combinator claim and standalone-comment
   * collection mutate runs at the token level. Converted to the shared, lean
   * `Trivia` (source-range) map only at the `trivia` getter boundary.
   */
  triviaMap: LegacyTriviaMap = createLegacyTriviaMap(new Map(), new Map());
  private _triviaBefore = new Map<number, IToken[]>();
  private _triviaAfter = new Map<number, IToken[]>();
  originalInput: IToken[] = [];
  /** Source text, set before `input` so the `trivia` getter can slice run text. */
  sourceText = '';

  locationStack: LocationInfo[] = [];

  protected _context!: TreeContext;

  constructor(
    T: TokenMap,
    config: CssRecursiveParserConfig = {}
  ) {
    super([...Object.values(T), EOF], {
      recoveryEnabled: config.recoveryEnabled ?? false,
      maxLookahead: 1,
      // TODO: Remove once all parsers are fully migrated for upstream Chevrotain validation.
      skipValidations: config.skipValidations ?? false
    });
    this.T = T;
    this.legacyMode = config.legacyMode ?? true;

    for (const [name, factory] of Object.entries(productions)) {
      if (typeof factory === 'function') {
        const rule = (factory as Function).call(this, T);
        this.RULE(name, rule);
      }
    }

    /** Disable self-analysis. Our current Chevrotain fork allows us to immediately parse. */
    if (this.constructor === CssRecursiveParser) {
      this.performSelfAnalysis();
    }
  }

  get context(): TreeContext {
    return (this._context ??= new TreeContext());
  }

  set context(c: TreeContext) {
    this._context = c;
  }

  override set input(value: IToken[]) {
    this.ruleIndex = 0;
    const beforeIndex = new Map<number, IToken[]>();
    const afterIndex = new Map<number, IToken[]>();
    const inputTokens: IToken[] = [];

    let pendingSkipped: IToken[] | undefined;
    let prevFilteredIndex = -1;

    for (let i = 0; i < value.length; i++) {
      const token = value[i]!;
      if (isSkippedToken(token)) {
        if (pendingSkipped) {
          pendingSkipped.push(token);
        } else {
          pendingSkipped = [token];
        }
        continue;
      }

      const filteredIndex = inputTokens.length;
      inputTokens.push(token);

      if (pendingSkipped) {
        beforeIndex.set(token.startOffset, pendingSkipped);
        if (prevFilteredIndex >= 0) {
          const prevToken = inputTokens[prevFilteredIndex]!;
          afterIndex.set(prevToken.endOffset!, pendingSkipped);
        }
        pendingSkipped = undefined;
      }
      prevFilteredIndex = filteredIndex;
    }

    if (pendingSkipped) {
      if (prevFilteredIndex >= 0) {
        const prevToken = inputTokens[prevFilteredIndex]!;
        afterIndex.set(prevToken.endOffset!, pendingSkipped);
      }
      beforeIndex.set(Infinity, pendingSkipped);
    }

    this._triviaBefore = beforeIndex;
    this._triviaAfter = afterIndex;
    this.triviaMap = createLegacyTriviaMap(beforeIndex, afterIndex);
    this.originalInput = value;
    this.locationStack = [];

    this.tokVector = inputTokens;
    this.tokVectorLength = inputTokens.length;
    this.reset();
  }

  override get input(): IToken[] {
    return this.tokVector;
  }

  get trivia(): IParseResult['trivia'] {
    // Convert the internal token-run index to the shared source-range Trivia map
    // consumed by the serializer. A run reachable from both its before (runEnd)
    // and after (runStart) keys must map to the SAME Trivia object — the
    // serializer emits each run once by object identity, so a single token run
    // must not become two Trivia objects (that would emit its comment twice).
    const src = this.sourceText;
    const cache = new Map<IToken[], Trivia>();
    const toTrivia = (run: IToken[]): Trivia => {
      let trivia = cache.get(run);
      if (!trivia) {
        trivia = makeTrivia(src, run[0]!.startOffset, run[run.length - 1]!.endOffset! + 1);
        cache.set(run, trivia);
      }
      return trivia;
    };
    const toShared = (m: Map<number, IToken[]>): Map<number, Trivia> => {
      const out = new Map<number, Trivia>();
      for (const [offset, run] of m) {
        if (run.length === 0) {
          continue;
        }
        out.set(offset, toTrivia(run));
      }
      return out;
    };
    return createTriviaMap({ before: toShared(this._triviaBefore), after: toShared(this._triviaAfter) });
  }

  // ── Domain helpers ─────────────────────────────────────────────────

  /**
   * Check if a token matches an expected type (including category parents).
   * Uses categoryMatchesMap directly to avoid dual-package tokenMatcher issues
   * where ESM/CJS boundary causes two module instances of chevrotain.
   */
  matchToken(tok: IToken, expected: TokenType): boolean {
    return tok.tokenType === expected
      || (expected.isParent === true && expected.categoryMatchesMap?.[tok.tokenTypeIdx] === true);
  }

  /**
   * Check if next token matches expected type (including category parents).
   */
  isType(expected: TokenType): boolean {
    const la1 = this.LA(1);
    if (la1.tokenType === expected) {
      return true;
    }
    return expected.isParent === true
      && expected.categoryMatchesMap?.[la1.tokenTypeIdx] === true;
  }

  /** Exact token type check only (no category traversal) */
  isExact(expected: TokenType): boolean {
    return this.LA(1).tokenType === expected;
  }

  /** Alias for isType */
  check(expected: TokenType): boolean {
    return this.isType(expected);
  }

  isTypeAt(offset: number, expected: TokenType): boolean {
    const tok = offset === 0
      ? (this.currIdx > -1 ? this.tokVector[this.currIdx] : undefined)
      : this.tokVector[this.currIdx + offset];
    if (!tok) {
      return expected.name === 'EOF';
    }
    if (tok.tokenType === expected) {
      return true;
    }
    return expected.isParent === true
      && expected.categoryMatchesMap?.[tok.tokenTypeIdx] === true;
  }

  /**
   * Shared bounded prefix check for structured media/container conditions.
   * Commits only on immediate condition starts: `(` or `not (`.
   */
  startsMediaCondition(T: TokenMap): boolean {
    const t1 = this.LA(1).tokenType;
    return t1 === T.LParen || (t1 === T.Not && this.LA(2).tokenType === T.LParen);
  }

  noSep(offset = 0): boolean {
    return this.triviaBefore(offset) === undefined;
  }

  isToken(node: unknown): node is IToken {
    return Boolean(node && typeof node === 'object' && 'tokenType' in node);
  }

  hasWS(offset = 0): boolean {
    return Boolean(this.triviaBefore(offset)?.some(token => token.tokenType.name === 'WS'));
  }

  private triviaBefore(offset: number): IToken[] | undefined {
    const token = this.tokVector[this.currIdx + 1 + offset];
    if (!token) {
      return undefined;
    }
    return this.triviaMap.lookup(token.startOffset, 'before');
  }

  protected claimSpaceCombinator(offset: number | undefined): IToken | undefined {
    if (offset === undefined) {
      return undefined;
    }
    const skipped = this.triviaMap.lookup(offset, 'before');
    if (!skipped) {
      return undefined;
    }
    for (let i = skipped.length - 1; i >= 0; i--) {
      const token = skipped[i]!;
      if (token.tokenType.name !== 'WS' || token.image.length === 0) {
        continue;
      }
      const claimed = {
        ...token,
        image: token.image.slice(-1),
        startOffset: token.endOffset ?? token.startOffset,
        startColumn: token.endColumn ?? token.startColumn,
        startLine: token.endLine ?? token.startLine
      };
      const image = token.image.slice(0, -1);
      if (image.length === 0) {
        skipped.splice(i, 1);
      } else {
        skipped[i] = {
          ...token,
          image
        };
      }
      return claimed;
    }
    return undefined;
  }

  /**
   * Decide whether an inner declaration-list entry should be treated as a
   * nested qualified rule instead of a declaration.
   *
   * Fast early-exit tiers:
   * 1. Non-Ident start => selector-like, allow immediately.
   * 2. Ident + no Colon => selector-like, allow immediately.
   * 3. Ident + Colon + whitespace after colon => declaration, reject.
   * 4. Ident + Colon + no-space + selector-like token => only allow the nested
   *    qualified-rule path when a `{` appears before `;`/`}`.
   * 5. Ident + Colon + no-space + Ident => same `{` lookahead before `;`/`}`.
   */
  shouldTryQualifiedRuleInDeclarationList(): boolean {
    const {
      Ident,
      Assign,
      Colon,
      NthPseudoClass,
      SelectorPseudoClass,
      FunctionStart
    } = this.T;
    if (!this.isTypeAt(1, Ident)) {
      return true;
    }
    if (!this.isTypeAt(2, Assign)) {
      return true;
    }
    if (this.hasWS(2)) {
      return false;
    }
    const tt3 = this.LA(3).tokenType;
    if (
      tt3 === Colon
      || tt3 === NthPseudoClass
      || tt3 === SelectorPseudoClass
      || this.matchToken(this.LA(3), FunctionStart)
    ) {
      return this.hasLCurlyAhead();
    }
    if (!this.matchToken(this.LA(3), Ident)) {
      return false;
    }
    return this.hasLCurlyAhead();
  }

  /**
   * Scan forward from the current position and return true if an LCurly
   * appears before a Semi or RCurly at the same nesting level.
   * Used to disambiguate nested qualified rules from declarations when
   * the first token is an Ident (e.g. `a:hover { }` vs `color: red;`).
   */
  hasLCurlyAhead(): boolean {
    const tokens = this.tokVector;
    const len = this.tokVectorLength;
    const LCurly = this.T.LCurly;
    const RCurly = this.T.RCurly;
    const Semi = this.T.Semi;
    let depth = 0;
    for (let i = this.currIdx + 1; i < len; i++) {
      const tt = tokens[i]!.tokenType;
      if (tt === LCurly) {
        if (depth === 0) {
          return true;
        }
        depth++;
      } else if (tt === RCurly) {
        if (depth === 0) {
          return false;
        }
        depth--;
      } else if (tt === Semi && depth === 0) {
        return false;
      }
    }
    return false;
  }

  getLocationInfo(tok: IToken): LocationInfo {
    if (tok.tokenType?.name === 'EOF') {
      return [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
    }
    return [
      tok.startOffset ?? NaN,
      tok.startLine ?? NaN,
      tok.startColumn ?? NaN,
      tok.endOffset ?? tok.startOffset ?? NaN,
      tok.endLine ?? tok.startLine ?? NaN,
      tok.endColumn ?? tok.startColumn ?? NaN
    ];
  }

  getLocationFromNodes(nodes: Array<IToken | { location?: LocationInfo | [] }>): LocationInfo | undefined {
    let startOffset = Infinity, startLine = Infinity, startColumn = Infinity;
    let endOffset = -Infinity, endLine = -Infinity, endColumn = -Infinity;
    let found = false;
    for (const item of nodes) {
      if (!item) {
        continue;
      }
      if ('tokenType' in item) {
        const t = item as IToken;
        if (t.startOffset < startOffset) {
          startOffset = t.startOffset;
          startLine = t.startLine!;
          startColumn = t.startColumn!;
        }
        if ((t.endOffset ?? -Infinity) > endOffset) {
          endOffset = t.endOffset!;
          endLine = t.endLine!;
          endColumn = t.endColumn!;
        }
        found = true;
      } else if (item.location && (item.location as LocationInfo).length === 6) {
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
    return found ? [startOffset, startLine, startColumn, endOffset, endLine, endColumn] : undefined;
  }

  startRule(): LocationInfo {
    const tok = this.LA(1);
    const location: LocationInfo = tok
      ? [tok.startOffset ?? NaN, tok.startLine ?? NaN, tok.startColumn ?? NaN, NaN, NaN, NaN]
      : [NaN, NaN, NaN, NaN, NaN, NaN];
    this.locationStack.push(location);
    return location;
  }

  endRule(): LocationInfo {
    const tok = this.LA(0);
    const location = this.locationStack.pop();
    if (!location) {
      return [NaN, NaN, NaN, NaN, NaN, NaN];
    }
    if (tok) {
      location[3] = tok.endOffset ?? tok.startOffset ?? NaN;
      location[4] = tok.endLine ?? tok.startLine ?? NaN;
      location[5] = tok.endColumn ?? tok.startColumn ?? NaN;
    }
    return location;
  }

  protected getRulesWithComments(
    existingRules: Node[] = [],
    nextTokenLocation?: LocationInfo
  ): Rules {
    if (!nextTokenLocation) {
      nextTokenLocation = this.getLocationInfo(this.LA(1));
    }
    const rules = this.addStandaloneRuleComments(existingRules, nextTokenLocation);
    return new Rules(
      rules,
      undefined,
      rules.length ? this.getLocationFromNodes(rules) : nextTokenLocation,
      this.context
    );
  }

  private addStandaloneRuleComments(existingRules: Node[], nextTokenLocation: LocationInfo): Node[] {
    const rules: Node[] = [];
    const claimed = new Set<IToken>();
    const processedRuns = new Set<IToken[]>();

    const collect = (tokens: IToken[] | undefined, prev: Node | undefined, next: Node | undefined): Comment[] => {
      if (!tokens) {
        return [];
      }
      const comments: Comment[] = [];
      const claimedFromRun = new Set<IToken>();
      for (const token of tokens) {
        if (
          token.tokenType.name !== 'Comment'
          || claimed.has(token)
          || !this.isStandaloneRuleComment(token, prev, next)
        ) {
          continue;
        }
        claimed.add(token);
        claimedFromRun.add(token);
        comments.push(new Comment(token.image, undefined, this.getLocationInfo(token), this.context));
      }
      if (claimedFromRun.size > 0 && !processedRuns.has(tokens)) {
        processedRuns.add(tokens);
        for (let i = tokens.length - 1; i >= 0; i--) {
          if (claimedFromRun.has(tokens[i]!)) {
            tokens.splice(i, 1);
          }
        }
      }
      return comments;
    };

    let previous: Node | undefined;
    for (const rule of existingRules) {
      rules.push(...collect(this.triviaMap.lookup(rule.location.start, 'before'), previous, rule));
      rules.push(rule);
      previous = rule;
    }
    rules.push(...collect(this.triviaMap.lookup(nextTokenLocation[0], 'before'), previous, undefined));

    return rules;
  }

  private isStandaloneRuleComment(token: IToken, _prev: Node | undefined, next: Node | undefined): boolean {
    if (next?.location?.[1] === token.endLine) {
      return false;
    }
    return true;
  }

  protected processValueToken(token: IToken, _ctx?: RuleContext): Node {
    const tokValue = token.image;
    const tokName = token.tokenType?.name ?? '';
    const T = this.T;
    let dimValue: { number: number; unit?: string } | undefined;
    let numValue: number | undefined;
    const getDimension = (v: Exclude<typeof dimValue, undefined>) =>
      new Dimension(v, undefined, this.getLocationInfo(token), this.context);
    const getNumber = (v: number) => new Num(v, undefined, this.getLocationInfo(token), this.context);

    if (this.matchToken(token, T.Ident) || this.matchToken(token, T.PlainIdent)) {
      const colorKey = tokValue.toLowerCase();
      if (colorKey === 'transparent') {
        return new Color(
          { node: 'transparent', rgb: [0, 0, 0], alpha: 0 },
          { format: ColorFormat.HEX },
          this.getLocationInfo(token),
          this.context
        );
      }
      if (colors[colorKey as keyof typeof colors]) {
        const cv = colors[colorKey as keyof typeof colors];
        return new Color(
          { node: tokValue, rgb: cv, alpha: 1 },
          { format: ColorFormat.HEX },
          this.getLocationInfo(token),
          this.context
        );
      }
      return new Any(tokValue, { role: 'ident' }, this.getLocationInfo(token), this.context);
    }
    if (this.matchToken(token, T.Dimension)) {
      const pl = token.payload as [string, string] | undefined;
      dimValue = { number: parseFloat(pl?.[0] ?? '0'), unit: pl?.[1] ?? '' };
      return getDimension(dimValue);
    }
    if (tokName === 'MathConstant') {
      switch (tokValue.toLowerCase()) {
        case 'pi':
          numValue = Math.PI;
          break;
        case 'infinity':
          numValue = Infinity;
          break;
        case '-infinity':
          numValue = -Infinity;
          break;
        case 'e':
          numValue = Math.E;
          break;
        case 'nan':
          numValue = NaN;
          break;
      }
      return getNumber(numValue!);
    }
    if (this.matchToken(token, T.Number)) {
      return getNumber(parseFloat(tokValue));
    }
    if (this.matchToken(token, T.Color)) {
      return new Color(tokValue, undefined, this.getLocationInfo(token), this.context);
    }
    return new Any(tokValue, { type: tokName }, this.getLocationInfo(token), this.context);
  }

  // ── Production rules (assigned in constructor via RULE) ─────────────
  stylesheet!: Rule<(options?: Record<string, any>) => void>;
  main!: Rule;
  qualifiedRule!: Rule;
  atRule!: Rule;
  selectorList!: Rule;
  declarationList!: Rule;
  forgivingSelectorList!: Rule;
  classSelector!: Rule;
  idSelector!: Rule;
  pseudoSelector!: Rule;
  attributeName!: Rule;
  attributeSelector!: Rule;
  nthValue!: Rule;
  complexSelector!: Rule;
  simpleSelector!: Rule;
  compoundSelector!: Rule;
  relativeSelector!: Rule;

  declaration!: Rule;
  valueList!: Rule;
  valueSequence!: Rule;
  value!: Rule;
  squareValue!: Rule;
  customValue!: Rule;
  innerCustomValue!: Rule;

  functionCall!: Rule;
  functionCallLike!: Rule;
  functionCallArgs!: Rule;
  ifFunction!: Rule;
  ifFunctionArgs!: Rule;
  knownFunctions!: Rule;
  varFunction!: Rule;
  calcFunction!: Rule;
  urlFunction!: Rule;
  unknownValue!: Rule;
  string!: Rule;

  mathSum!: Rule;
  mathProduct!: Rule;
  mathValue!: Rule;
  mathParen!: Rule;

  innerAtRule!: Rule;
  importAtRule!: Rule;
  importPrelude!: Rule;
  importPostlude!: Rule;
  mediaAtRule!: Rule;
  supportsAtRule!: Rule;
  containerAtRule!: Rule;
  containerName!: Rule;
  containerQueryList!: Rule;
  containerQuery!: Rule;
  containerCondition!: Rule;
  containerInParens!: Rule;
  containerFeature!: Rule;
  containerAnd!: Rule;
  containerOr!: Rule;
  atRuleBody!: Rule;
  pageAtRule!: Rule;
  keyframesAtRule!: Rule;
  keyframesName!: Rule;
  layerAtRule!: Rule;
  layerName!: Rule;
  scopeAtRule!: Rule;
  documentAtRule!: Rule;
  pageSelector!: Rule;
  fontFaceAtRule!: Rule;
  nestedAtRule!: Rule;
  nonNestedAtRule!: Rule;
  unknownAtRule!: Rule;

  mediaQueryList!: Rule;
  mediaQuery!: Rule;
  mediaTypeQuery!: Rule;
  mediaCondition!: Rule;
  mediaType!: Rule;
  mediaConditionWithoutOr!: Rule;
  mediaNot!: Rule;
  mediaInParens!: Rule;
  mediaAnd!: Rule;
  mediaOr!: Rule;
  mediaFeature!: Rule;
  mfValue!: Rule;
  mediaRange!: Rule;
  mfComparison!: Rule;
  mfNonIdentifierValue!: Rule;

  supportsCondition!: Rule;
  supportsInParens!: Rule;

  anyOuterValue!: Rule;
  anyInnerValue!: Rule;
  extraTokens!: Rule;
  customBlock!: Rule;
}
