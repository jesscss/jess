/**
 * CssRecursiveParser — Chevrotain EmbeddedActionsParser-based CSS parser
 *
 * Extends Chevrotain's EmbeddedActionsParser with Jess-specific infrastructure:
 * - Filtered input (skipped tokens removed) with pre/post trivia maps
 * - AST building helpers (getLocationInfo, wrap, startRule, endRule)
 * - Token category matching via categoryMatchesMap for gate predicates
 */
import { EmbeddedActionsParser, EOF, tokenMatcher } from 'chevrotain';
import type { TokenType, ParserMethod } from '@chevrotain/types';

export type Rule<F extends (...args: any[]) => void = (ctx?: RuleContext) => void> = ParserMethod<Parameters<F>, any>;

import type { IParseResult, LocationInfo, OptionalLocation } from '@jesscss/core';

import {
  TreeContext,
  Node,
  Color,
  ColorFormat,
  Dimension,
  Num,
  Rules,
  Any
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

  /** Maps token startOffset → preceding skipped tokens (WS/comments) */
  preSkippedTokenMap: Map<number, IToken[]> = new Map();
  /** Maps previous token endOffset → following skipped tokens */
  postSkippedTokenMap: Map<number, IToken[]> = new Map();
  originalInput: IToken[] = [];

  protected hasWSBeforeByPos: Uint8Array = new Uint8Array(0);
  protected hasSepBeforeByPos: Uint8Array = new Uint8Array(0);
  protected skippedBeforeByPos: Array<IToken[] | undefined> = [];
  protected skippedAfterByPos: Array<IToken[] | undefined> = [];

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

  set input(value: IToken[]) {
    this.ruleIndex = 0;
    const preSkippedTokenMap = (this.preSkippedTokenMap = new Map<number, IToken[]>());
    const postSkippedTokenMap = (this.postSkippedTokenMap = new Map<number, IToken[]>());
    const inputTokens: IToken[] = [];
    const skippedBeforeByPos: Array<IToken[] | undefined> = [];
    const skippedAfterByPos: Array<IToken[] | undefined> = [];
    const hasWSBeforeByPos: number[] = [];
    const hasSepBeforeByPos: number[] = [];

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
        if (token.tokenType.name === 'WS') {
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

    if (pendingSkipped) {
      if (prevFilteredIndex >= 0) {
        skippedAfterByPos[prevFilteredIndex] = pendingSkipped;
        const prevToken = inputTokens[prevFilteredIndex]!;
        postSkippedTokenMap.set(prevToken.endOffset!, pendingSkipped);
      }
      preSkippedTokenMap.set(Infinity, pendingSkipped);
    }

    this.originalInput = value;
    this.locationStack = [];
    this.skippedBeforeByPos = skippedBeforeByPos;
    this.skippedAfterByPos = skippedAfterByPos;
    this.hasWSBeforeByPos = Uint8Array.from(hasWSBeforeByPos);
    this.hasSepBeforeByPos = Uint8Array.from(hasSepBeforeByPos);

    this.tokVector = inputTokens;
    this.tokVectorLength = inputTokens.length;
    this.reset();
  }

  get input(): IToken[] {
    return this.tokVector;
  }

  get trivia(): IParseResult['trivia'] {
    return {
      before: this.preSkippedTokenMap,
      after: this.postSkippedTokenMap
    };
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
    const idx = this.currIdx + 1 + offset;
    if (idx >= this.tokVectorLength) {
      return true;
    }
    return this.hasSepBeforeByPos[idx] === 0;
  }

  isToken(node: unknown): node is IToken {
    return Boolean(node && typeof node === 'object' && 'tokenType' in node);
  }

  hasWS(offset = 0): boolean {
    const idx = this.currIdx + 1 + offset;
    if (idx >= this.tokVectorLength) {
      return false;
    }
    return this.hasWSBeforeByPos[idx] === 1;
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

  getLocationFromNodes(nodes: Array<IToken | { location?: OptionalLocation }>): LocationInfo | undefined {
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
    return new Rules(
      existingRules,
      undefined,
      existingRules.length ? this.getLocationFromNodes(existingRules) : nextTokenLocation,
      this.context
    );
  }

  protected wrap<T extends Node = Node>(node: T, post?: boolean | 'both', ctx?: RuleContext): T {
    return node;
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
        case 'pi': numValue = Math.PI; break;
        case 'infinity': numValue = Infinity; break;
        case '-infinity': numValue = -Infinity; break;
        case 'e': numValue = Math.E; break;
        case 'nan': numValue = NaN; break;
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
