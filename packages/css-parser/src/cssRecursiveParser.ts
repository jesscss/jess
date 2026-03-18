/**
 * CssRecursiveParser — Hand-written recursive-descent CSS parser
 *
 * Replaces CssActionsParser (Chevrotain-based) with a hand-coded parser
 * built on @jesscss/parser. Production rule structure mirrors
 * the original Chevrotain grammar for near-mechanical conversion.
 *
 * The DSL method names and production-rule patterns were inspired by
 * Chevrotain (https://chevrotain.io). The implementation is hand-coded
 * for greater performance: no RECORDING_PHASE, no numbered DSL variants,
 * no GAST construction, and zero-allocation token matching.
 */
import {
  RecursiveDescentParser,
  buildTokenMatchBitsets,
  buildTokenTypeSet,
  EOF_TOKEN_TYPE,
  type IToken,
  type TokenType,
  type LocationInfo,
  tokenMatches
} from '@jesscss/parser';

import {
  TreeContext,
  Node,
  Comment,
  F_VISIBLE,
  Color,
  ColorFormat,
  Dimension,
  Num,
  Rules,
  Any,
  type Nil
} from '@jesscss/core';

import colors from 'color-name';

import { type CssTokenType } from './cssTokens.js';

type TokenMap = Record<CssTokenType, TokenType>;

// ── Import production rule implementations ──────────────────────────
import * as selectors from './productions/selectors.js';
import * as values from './productions/values.js';
import * as atRules from './productions/atRules.js';
import * as misc from './productions/misc.js';

const { isArray } = Array;

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
}

// ── Parser ───────────────────────────────────────────────────────────

export class CssRecursiveParser extends RecursiveDescentParser {
  T: TokenMap;
  legacyMode: boolean;
  ruleIndex = 0;

  /** Token sets for O(1) token matching */

  SIMPLE_NAME_START: Uint32Array;
  NESTED_RULE_START: Uint32Array;
  DECL_NAME_START: Uint32Array;
  IDENT_LIKE_START: Uint32Array;
  DECL_VALUE_NAME_START: Uint32Array;
  QUERY_CONDITION_START: Uint32Array;
  FUNCTION_LIKE_END: Uint32Array;

  constructor(
    T: TokenMap,
    config: CssRecursiveParserConfig = {}
  ) {
    super({
      recoveryEnabled: config.recoveryEnabled ?? false
    });
    this.T = T;
    this.legacyMode = config.legacyMode ?? true;
    buildTokenMatchBitsets([...Object.values(T), EOF_TOKEN_TYPE]);

    /** Build token sets for O(1) token matching */
    this.SIMPLE_NAME_START = buildTokenTypeSet([
      T.DotName,
      T.HashName,
      T.ColorIdentStart
    ]);

    this.NESTED_RULE_START = buildTokenTypeSet([
      T.DotName,
      T.HashName,
      T.Ampersand,
      T.LSquare,
      T.SelectorPseudoClass,
      T.NthPseudoClass,
      T.Star,
      T.ColorIdentStart,
      T.AtKeyword
    ]),

    this.DECL_NAME_START = buildTokenTypeSet([
      T.PlainIdent,
      T.CustomProperty,
      T.LegacyPropIdent
    ]);

    this.IDENT_LIKE_START = buildTokenTypeSet([
      T.Ident,
      T.PlainIdent
    ]);

    this.DECL_VALUE_NAME_START = buildTokenTypeSet([
      T.Ident,
      T.PlainIdent,
      T.CustomProperty
    ]);

    this.QUERY_CONDITION_START = buildTokenTypeSet([
      T.LParen,
      T.Not
    ]);

    this.FUNCTION_LIKE_END = buildTokenTypeSet([
      T.RParen,
      T.UrlEnd
    ]);
  }

  override get context(): TreeContext {
    return (this._context ??= new TreeContext());
  }

  override set context(c: TreeContext) {
    this._context = c;
  }

  override set input(value: IToken[]) {
    this.ruleIndex = 0;
    super.input = value;
  }

  override get input(): IToken[] {
    return super.input;
  }

  // ── Infrastructure methods (from CssActionsParser) ──────────────

  protected getPrePost(offset: number, post?: boolean, ctx?: RuleContext): Node['pre'] {
    let skipped = post ? this.postSkippedTokenMap.get(offset) : this.preSkippedTokenMap.get(offset);
    if (!skipped) {
      return 0;
    }
    if (this.usedSkippedTokens.has(skipped)) {
      return 0;
    }
    this.addUsedSkippedTokens(skipped);

    let pre: Node['pre'] = skipped.map((token: IToken) => {
      let name = token.tokenType.name;
      if (name === 'WS') {
        return token.image;
      } else {
        const comment = new Comment(token.image, { lineComment: name.includes('Line') }, this.getLocationInfo(token), this.context);
        if (ctx?.inCustomPropertyValue && comment.lineComment) {
          comment.addFlag(F_VISIBLE);
        }
        return comment;
      }
    });

    if (Array.isArray(pre) && pre.length === 1 && pre[0] === ' ') {
      pre = 1;
    }
    return pre;
  }

  protected getRulesWithComments(
    existingRules: Node[] = [],
    nextTokenLocation?: LocationInfo
  ) {
    if (!nextTokenLocation) {
      nextTokenLocation = this.getLocationInfo(this.LA(1));
    }
    let rules: Node[] = [];

    const processPrePost = (prePost: Node['pre']) => {
      if (isArray(prePost)) {
        const remainder: Array<string | Node> = [];
        for (let i = 0; i < prePost.length; i++) {
          const item = prePost[i]!;
          if (item instanceof Node) {
            const prev = remainder.length > 0 ? remainder[remainder.length - 1] : undefined;
            if (typeof prev === 'string') {
              item.pre = [prev];
              remainder.pop();
            }
            const next = prePost[i + 1];
            if (typeof next === 'string') {
              (item as any).post = [next];
              i++;
            }
            rules.push(item);
          } else {
            remainder.push(item);
          }
        }
        return remainder.length === 0 ? 0 : remainder;
      }
      return prePost;
    };

    for (let rule of existingRules) {
      if (rule.pre === undefined) {
        let pre = this.getPrePost(rule.location[0]!);
        const processed = processPrePost(pre) as 0 | 1 | Array<string | Comment | Nil> | undefined;
        rule.pre = processed;
      }
      rules.push(rule);
    }
    const tail = this.getPrePost(nextTokenLocation[0]!);
    const remainder = processPrePost(tail) as 0 | 1 | Array<string | Comment | Nil> | undefined;
    let returnRules: Rules = new Rules(rules, undefined, rules.length ? this.getLocationFromNodes(rules) : undefined, this.context);
    returnRules.post = remainder;
    return returnRules;
  }

  /**
   * Attaches pre / post whitespace and comments.
   * Note that nodes can be wrapped more than once.
   */
  protected wrap<T extends Node = Node>(node: T, post?: boolean | 'both', ctx?: RuleContext): T {
    if (!(node instanceof Node)) {
      return node;
    }
    if (post) {
      if (node.post === undefined) {
        let offset = node.location[3];
        if (offset !== undefined) {
          node.post = this.getPrePost(offset, true, ctx);
        }
      }
      if (post !== 'both') {
        return node;
      }
    }
    if ((!post || post === 'both')) {
      let offset = node.location[0];
      if (offset !== undefined && node.pre === undefined) {
        const pre = this.getPrePost(offset, false, ctx);
        node.pre = pre as any;
      }
    }
    return node;
  }

  protected processValueToken(
    token: IToken,
    _ctx?: RuleContext
  ): Node {
    let tokValue = token.image;
    let tokType = token.tokenType;
    let tokName = tokType.name;
    let T = this.T;
    let dimValue: { number: number; unit?: string } | undefined;
    let numValue: number | undefined;
    const getDimension = (finalValue: Exclude<typeof dimValue, undefined>) =>
      new Dimension(finalValue, undefined, this.getLocationInfo(token), this.context);
    const getNumber = (finalValue: number) =>
      new Num(finalValue, undefined, this.getLocationInfo(token), this.context);

    let result: Node;
    if (tokenMatches(token, T.Ident)) {
      const colorKey = tokValue.toLowerCase();
      if (colorKey === 'transparent') {
        result = new Color(
          {
            node: 'transparent',
            rgb: [0, 0, 0],
            alpha: 0
          },
          { format: ColorFormat.HEX },
          this.getLocationInfo(token),
          this.context
        );
      } else if (colors[colorKey as keyof typeof colors]) {
        const colorValue = colors[colorKey as keyof typeof colors];
        const colorNode = new Color(
          {
            node: tokValue,
            rgb: colorValue,
            alpha: 1
          },
          { format: ColorFormat.HEX },
          this.getLocationInfo(token),
          this.context
        );
        result = colorNode;
      } else {
        result = new Any(tokValue, { role: 'ident' }, this.getLocationInfo(token), this.context);
      }
    } else if (tokenMatches(token, T.Dimension)) {
      dimValue = { number: parseFloat(token.payload?.[0] ?? '0'), unit: token.payload?.[1] ?? '' };
      result = getDimension(dimValue);
    } else if (tokName === 'MathConstant') {
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
      }
      result = getNumber(numValue!);
    } else if (tokenMatches(token, T.Number)) {
      numValue = parseFloat(tokValue);
      result = getNumber(numValue);
    } else if (tokenMatches(token, T.Color)) {
      result = new Color(tokValue, undefined, this.getLocationInfo(token), this.context);
    } else {
      result = new Any(tokValue, { type: token.tokenType.name }, this.getLocationInfo(token), this.context);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // PRODUCTION RULES — method declarations
  // Implementations are assigned via prototype below.
  // ════════════════════════════════════════════════════════════════════

  // ── Selectors (structure + selectors) ──────────────────────────────
  declare stylesheet: typeof selectors.stylesheet;
  declare main: typeof selectors.main;
  declare qualifiedRule: typeof selectors.qualifiedRule;
  declare simpleSelector: typeof selectors.simpleSelector;
  declare classSelector: typeof selectors.classSelector;
  declare idSelector: typeof selectors.idSelector;
  declare pseudoSelector: typeof selectors.pseudoSelector;
  declare nthValue: typeof selectors.nthValue;
  declare attributeSelector: typeof selectors.attributeSelector;
  declare compoundSelector: typeof selectors.compoundSelector;
  declare complexSelector: typeof selectors.complexSelector;
  declare relativeSelector: typeof selectors.relativeSelector;
  declare forgivingSelectorList: typeof selectors.forgivingSelectorList;
  declare selectorList: typeof selectors.selectorList;
  declare declarationList: typeof selectors.declarationList;

  // ── Values (declarations, math, functions) ───────────────────────
  declare declaration: typeof values.declaration;
  declare customValue: typeof values.customValue;
  declare innerCustomValue: typeof values.innerCustomValue;
  declare extraTokens: typeof values.extraTokens;
  declare customBlock: typeof values.customBlock;
  declare valueList: typeof values.valueList;
  declare valueSequence: typeof values.valueSequence;
  declare squareValue: typeof values.squareValue;
  declare value: typeof values.value;
  declare string: typeof values.string;
  declare mathSum: typeof values.mathSum;
  declare mathProduct: typeof values.mathProduct;
  declare mathValue: typeof values.mathValue;
  declare mathParen: typeof values.mathParen;
  declare knownFunctions: typeof values.knownFunctions;
  declare ifFunctionArgs: typeof values.ifFunctionArgs;
  declare ifFunction: typeof values.ifFunction;
  declare varFunction: typeof values.varFunction;
  declare calcFunction: typeof values.calcFunction;
  declare urlFunction: typeof values.urlFunction;

  // ── At-rules (media, container, keyframes, etc.) ─────────────────
  declare atRule: typeof atRules.atRule;
  declare innerAtRule: typeof atRules.innerAtRule;
  declare atRuleBody: typeof atRules.atRuleBody;
  declare mediaAtRule: typeof atRules.mediaAtRule;
  declare mediaQueryList: typeof atRules.mediaQueryList;
  declare mediaQuery: typeof atRules.mediaQuery;
  declare mediaType: typeof atRules.mediaType;
  declare mediaCondition: typeof atRules.mediaCondition;
  declare mediaConditionWithoutOr: typeof atRules.mediaConditionWithoutOr;
  declare mediaNot: typeof atRules.mediaNot;
  declare mediaAnd: typeof atRules.mediaAnd;
  declare mediaOr: typeof atRules.mediaOr;
  declare mediaInParens: typeof atRules.mediaInParens;
  declare mediaFeature: typeof atRules.mediaFeature;
  declare mediaRange: typeof atRules.mediaRange;
  declare mfNonIdentifierValue: typeof atRules.mfNonIdentifierValue;
  declare mfValue: typeof atRules.mfValue;
  declare mfComparison: typeof atRules.mfComparison;
  declare pageAtRule: typeof atRules.pageAtRule;
  declare pageSelector: typeof atRules.pageSelector;
  declare fontFaceAtRule: typeof atRules.fontFaceAtRule;
  declare keyframesAtRule: typeof atRules.keyframesAtRule;
  declare keyframesName: typeof atRules.keyframesName;
  declare containerAtRule: typeof atRules.containerAtRule;
  declare containerName: typeof atRules.containerName;
  declare containerQueryList: typeof atRules.containerQueryList;
  declare containerQuery: typeof atRules.containerQuery;
  declare containerCondition: typeof atRules.containerCondition;
  declare containerAnd: typeof atRules.containerAnd;
  declare containerOr: typeof atRules.containerOr;
  declare containerInParens: typeof atRules.containerInParens;
  declare containerFeature: typeof atRules.containerFeature;
  declare scopeAtRule: typeof atRules.scopeAtRule;
  declare documentAtRule: typeof atRules.documentAtRule;

  // ── Misc (layer, supports, imports, function calls) ──────────────
  declare layerAtRule: typeof misc.layerAtRule;
  declare layerName: typeof misc.layerName;
  declare supportsAtRule: typeof misc.supportsAtRule;
  declare supportsCondition: typeof misc.supportsCondition;
  declare supportsInParens: typeof misc.supportsInParens;
  declare functionCallLike: typeof misc.functionCallLike;
  declare functionCall: typeof misc.functionCall;
  declare functionCallArgs: typeof misc.functionCallArgs;
  declare importAtRule: typeof misc.importAtRule;
  declare importPrelude: typeof misc.importPrelude;
  declare importPostlude: typeof misc.importPostlude;
  declare nestedAtRule: typeof misc.nestedAtRule;
  declare nonNestedAtRule: typeof misc.nonNestedAtRule;
  declare unknownAtRule: typeof misc.unknownAtRule;
  declare anyOuterValue: typeof misc.anyOuterValue;
  declare anyInnerValue: typeof misc.anyInnerValue;
}

// ── Attach production methods to prototype ────────────────────────────
// This avoids duplicating ~3000 lines of code inside the class body
// while keeping full TypeScript type safety via `declare` above.

const proto = CssRecursiveParser.prototype as any;

for (const mod of [selectors, values, atRules, misc]) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === 'function') {
      // Wrap each production to auto-push/pop ruleStack for error context.
      // No try/finally needed: or() saves/restores ruleStack.length on backtrack.
      proto[name] = function(this: CssRecursiveParser, ...args: unknown[]) {
        this.ruleStack.push(name);
        const result = (fn as Function).apply(this, args);
        this.ruleStack.pop();
        return result;
      };
    }
  }
}
