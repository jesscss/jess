import {
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type ParserMethod,
  type IToken,
  tokenMatcher,
  type IRecognitionException
} from 'chevrotain';

// import { AdvancedCstParser } from './advancedCstParser'
import { LLStarLookaheadStrategy } from 'chevrotain-allstar';

import { AdvancedActionsParser } from './advancedActionsParser';

import { type CssTokenType } from './cssTokens';
import * as productions from './productions';
import {
  type LocationInfo,
  Node,
  Comment,
  Color,
  ColorFormat,
  Dimension,
  Num,
  Rules,
  Any,
  type Nil
} from '@jesscss/core';
import type { CssErrorMessageProvider } from './cssErrorMessageProvider';
import colors from 'color-name';

const { isArray } = Array;

// /** Assert that tokens will have full location info */
// export interface IToken extends Required<Omit<OrigIToken, 'payload'>> {
//   payload?: OrigIToken['payload']
// }

export type TokenMap = Record<CssTokenType, TokenType>;

export type Rule<F extends (...args: any[]) => void = (ctx?: RuleContext) => void> = ParserMethod<Parameters<F>, any>;

export interface CssParserConfig extends IParserConfig {
  /** Things like star property hacks and IE filters */
  legacyMode?: boolean;
}

export type RuleContext = {
  /** Inside a declaration list */
  inner?: boolean;
  /** Determine if this is the first selector in the list */
  firstSelector?: boolean;
  /** If downstream selector rules are part of a qualified rule */
  qualifiedRule?: boolean;

  [k: string]: object | boolean | string | object[] | number | undefined;
};

/**
 * @note - we use an EmbeddedActionsParser for a few reasons:
 *   1. Jess's AST is essentially a CST; that is, it records
 *      all whitespace and comments. (The one difference may
 *      be that some nodes are "simplified" in the Jess AST.)
 *   2. Chevrotain's CST is not the most efficient structure
 *      for a CST.
 *   3. We can avoid the overhead of a CST visitor by creating
 *      the Jess nodes directly.
 *   4. In some cases, we need some additional business logic
 *      about what the intended structure of the AST is, based
 *      on the presence of certain tokens.
 */
export class CssActionsParser extends AdvancedActionsParser {
  T: TokenMap;
  legacyMode: boolean;
  ruleIndex = 0;

  declare _errors: Array<IRecognitionException>;
  /** Expose Chevrotain's flag */
  declare skipValidations: boolean;

  /** Rewire, declaring class fields in constructor with `public` */
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
  attributeSelector!: Rule;
  nthValue!: Rule;
  complexSelector!: Rule;
  simpleSelector!: Rule;
  compoundSelector!: Rule;
  relativeSelector!: Rule;

  declaration!: Rule;
  valueList!: Rule;
  /** Often a space-separated sequence */
  valueSequence!: Rule;
  value!: Rule;
  squareValue!: Rule;
  customValue!: Rule;
  innerCustomValue!: Rule;

  functionCall!: Rule;
  functionCallLike!: Rule;
  functionCallArgs!: Rule;
  knownFunctions!: Rule;
  varFunction!: Rule;
  calcFunction!: Rule;
  urlFunction!: Rule;
  unknownValue!: Rule;
  string!: Rule;

  // expression: Rule
  // calc()
  mathSum!: Rule;
  mathProduct!: Rule;
  mathValue!: Rule;
  mathParen!: Rule;

  /** At Rules */
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

  /** `@media` syntax */
  mediaQueryList!: Rule;
  mediaQuery!: Rule;
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

  /** `@container` syntax - declarations are above */

  /**
   * `@supports` syntax - the parsing is defined differently
   * from `@media`, which is fortunate, because it's much
   * simpler.
  */
  supportsCondition!: Rule;
  supportsInParens!: Rule;

  /** General purpose subrules */
  anyOuterValue!: Rule;
  anyInnerValue!: Rule;
  extraTokens!: Rule;
  customBlock!: Rule;

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: CssParserConfig = {}
  ) {
    const defaultConfig: CssParserConfig = {
      maxLookahead: 1,
      lookaheadStrategy: new LLStarLookaheadStrategy({
        // suppress ambiguity logging
        // logging() {}
      })
    };

    const { legacyMode = true, ...rest } = { ...defaultConfig, ...config };

    super(tokenVocabulary, rest);

    this.T = T;
    this.legacyMode = legacyMode;

    for (let [key, value] of Object.entries(productions)) {
      let rule = value.call(this, T);
      this.RULE(key, rule);
    }

    if (this.constructor === CssActionsParser) {
      this.performSelfAnalysis();
    }
  }

  set input(value: IToken[]) {
    this.ruleIndex = 0;
    super.input = value;
  }

  protected getLocationFromNodes(nodes: Array<IToken | Node>): LocationInfo | undefined {
    let startNode = nodes[0]!;
    let lastNode = nodes[nodes.length - 1]!;
    let startOffset: number;
    let startLine: number;
    let startColumn: number;
    let endOffset: number;
    let endLine: number;
    let endColumn: number;

    if (startNode === undefined) {
      return undefined;
    }

    if (startNode instanceof Node) {
      ([startOffset, startLine, startColumn] = startNode.location as LocationInfo);
    } else {
      ({ startOffset, startLine, startColumn } = startNode as Required<IToken>);
    }

    if (lastNode instanceof Node) {
      ([,,,endOffset, endLine, endColumn] = lastNode.location as LocationInfo);
    } else {
      ({ endOffset, endLine, endColumn } = lastNode as Required<IToken>);
    }

    if (startOffset === undefined) {
      throw new Error(`Node "${startNode instanceof Node ? startNode.type : startNode.tokenType.name}" has no location info`);
    } else if (endOffset === undefined) {
      throw new Error(`Node "${lastNode instanceof Node ? lastNode.type : lastNode.tokenType.name}" has no location info`);
    }
    let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset, endLine!, endColumn!];
    return location;
  }

  protected getRulesWithComments(
    existingRules: Node[] = [],
    nextTokenLocation?: LocationInfo
  ) {
    if (!nextTokenLocation) {
      nextTokenLocation = this.getLocationInfo(this.LA(1));
    }
    let rules = [];
    /**
     * @todo - I think this pattern means that comments after
     * the last rule will be tossed out, so we need to figure
     * out a way to get comments when comments are the only
     * content in a file.
     */
    // let rule: Node | undefined

    const processPrePost = (prePost: Node['pre']) => {
      if (isArray(prePost)) {
        // Build a new remainder array while moving comment nodes to top-level rules
        const remainder: Array<string | Node> = [];
        for (let i = 0; i < prePost.length; i++) {
          const item = prePost[i]!;
          if (item instanceof Node) {
            // Attach immediately preceding whitespace (if any) to the comment
            const prev = remainder.length > 0 ? remainder[remainder.length - 1] : undefined;
            if (typeof prev === 'string') {
              item.pre = [prev];
              remainder.pop();
            }
            // Attach immediately following whitespace (if any) to comment.post
            const next = prePost[i + 1];
            if (typeof next === 'string') {
              (item as any).post = [next];
              i++; // consume the following whitespace
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
    // Do not mutate lastRule.post here; lift only at tail capture time to avoid duplication/newlines.
    // Then capture any remaining EOF tail via preSkipped at LA(1).startOffset.
    const tail = this.getPrePost(nextTokenLocation[0]!);
    const remainder = processPrePost(tail) as 0 | 1 | Array<string | Comment | Nil> | undefined;
    let returnRules: Rules = new Rules(rules, undefined, rules.length ? this.getLocationFromNodes(rules) : undefined, this.context);
    returnRules.post = remainder;
    return returnRules;
  }

  protected getPrePost(offset: number, post?: boolean): Node['pre'] {
    let skipped = post ? this.postSkippedTokenMap.get(offset) : this.preSkippedTokenMap.get(offset);
    if (!skipped) {
      return 0;
    }
    if (this.usedSkippedTokens.has(skipped)) {
      return 0;
    }
    this.usedSkippedTokens.add(skipped);

    let pre: Node['pre'] = skipped.map((token) => {
      let name = token.tokenType.name;
      if (name === 'WS') {
        return token.image;
      } else {
        return new Comment(token.image, { lineComment: name.includes('Line') }, this.getLocationInfo(token), this.context);
      }
    });

    if (pre.length === 1 && pre[0] === ' ') {
      pre = 1;
    }
    return pre;
  }

  /**
   * Attaches pre / post whitespace and comments.
   * Note that nodes can be wrapped more than once.
   *
   * @note Some nodes can't be wrapped because they
   * don't represent a location. For instance, a
   * Rules node may be empty, and hence doesn't
   * have a location.
   */
  protected wrap<T extends Node = Node>(node: T, post?: boolean | 'both'): T {
    if (!(node instanceof Node)) {
      return node;
    }
    // let skipValidations = this.skipValidations
    if (post) {
      if (node.post === undefined) {
        let offset = node.location[3];
        if (offset !== undefined) {
          node.post = this.getPrePost(offset, true);
          // throw new Error(`Node "${node.type}" can't be wrapped`)
        }
      }
      if (post !== 'both') {
        return node;
      }
    }
    if ((!post || post === 'both')) {
      // Always record pre for a node, but if it is the leading child
      // of a parent that will itself own pre (e.g., first selector in a qualified rule),
      // allow callers to reassign this pre to the parent Rules/Ruleset.
      let offset = node.location[0];
      if (offset !== undefined && node.pre === undefined) {
        const pre = this.getPrePost(offset);
        // Narrow to allowed type: Array<Comment | Nil | string> | 1 | 0 | undefined
        node.pre = pre as any;
      }
    }
    return node;
  }

  protected processValueToken(
    token: IToken,
    ctx?: RuleContext
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
    if (tokenMatcher(token, T.Ident)) {
      // Check if it's a color keyword
      const colorKey = tokValue.toLowerCase();
      if (colors[colorKey as keyof typeof colors]) {
        // Create a Color node with the keyword data
        const colorValue = colors[colorKey as keyof typeof colors];
        const colorNode = new Color(
          {
            node: tokValue, // Store the original keyword string
            format: ColorFormat.HEX,
            rgb: colorValue,
            alpha: 1
          },
          undefined,
          this.getLocationInfo(token),
          this.context
        );
        result = colorNode;
      } else {
        // In value position, treat as a generic identifier
        result = new Any(tokValue, undefined, this.getLocationInfo(token), this.context);
      }
    } else if (tokenMatcher(token, T.Dimension)) {
      dimValue = { number: parseFloat(token.payload[0]), unit: token.payload[1] };
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
    } else if (tokenMatcher(token, T.Number)) {
      numValue = parseFloat(tokValue);
      result = getNumber(numValue);
    } else if (tokenMatcher(token, T.Color)) {
      result = new Color(tokValue, undefined, this.getLocationInfo(token), this.context);
    } else {
      result = new Any(tokValue, { type: token.tokenType.name }, this.getLocationInfo(token), this.context);
    }
    return result;
  }

  /**
   * Convenience helper to temporarily set context flags while invoking a subrule.
   * - Saves current values for provided keys
   * - Applies overrides via Object.assign
   * - Invokes callback with the same ctx object
   * - Restores only the provided keys to their previous values
   */
  public callSubRuleWith<T>(
    ctx: RuleContext,
    overrides: Partial<RuleContext>,
    callback: (ctx: RuleContext) => T
  ): T {
    const keys = Object.keys(overrides) as Array<keyof RuleContext>;
    const prev: Partial<RuleContext> = {};
    for (const key of keys) {
      prev[key] = ctx[key];
    }
    Object.assign(ctx, overrides);
    try {
      return callback(ctx);
    } finally {
      for (const key of keys) {
        const oldVal = prev[key];
        ctx[key] = oldVal;
      }
    }
  }
}
