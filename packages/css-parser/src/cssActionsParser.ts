import {
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type ParserMethod,
  type IToken,
  tokenMatcher
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
  Dimension,
  Num,
  Rules,
  Any,
  type Nil
} from '@jesscss/core';

const { isArray } = Array;

// /** Assert that tokens will have full location info */
// export interface IToken extends Required<Omit<OrigIToken, 'payload'>> {
//   payload?: OrigIToken['payload']
// }

export type TokenMap = Record<CssTokenType, TokenType>;

export type Rule<F extends () => void = () => void> = ParserMethod<Parameters<F>, any>;

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

  [k: string]: object | boolean | string | object[] | undefined;
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

  /** Expose Chevrotain's flag */
  declare skipValidations: boolean;

  /** Rewire, declaring class fields in constructor with `public` */
  stylesheet!: Rule<(options?: Record<string, any>) => void>;
  main!: Rule<(ctx?: RuleContext) => void>;
  qualifiedRule!: Rule<(ctx?: RuleContext) => void>;
  atRule!: Rule<(ctx?: RuleContext) => void>;
  selectorList!: Rule<(ctx?: RuleContext) => void>;
  declarationList!: Rule;
  forgivingSelectorList!: Rule<(ctx?: RuleContext) => void>;
  classSelector!: Rule;
  idSelector!: Rule;
  pseudoSelector!: Rule<(ctx?: RuleContext) => void>;
  attributeSelector!: Rule;
  nthValue!: Rule;
  complexSelector!: Rule<(ctx?: RuleContext) => void>;
  simpleSelector!: Rule<(ctx?: RuleContext) => void>;
  compoundSelector!: Rule<(ctx?: RuleContext) => void>;
  relativeSelector!: Rule<(ctx?: RuleContext) => void>;

  declaration!: Rule;
  valueList!: Rule<(ctx?: RuleContext) => void>;
  /** Often a space-separated sequence */
  valueSequence!: Rule<(ctx?: RuleContext) => void>;
  value!: Rule<(ctx?: RuleContext) => void>;
  squareValue!: Rule<(ctx?: RuleContext) => void>;
  customValue!: Rule;
  innerCustomValue!: Rule;

  functionCall!: Rule;
  functionCallLike!: Rule;
  functionCallArgs!: Rule<(ctx?: RuleContext) => void>;
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
  mediaAtRule!: Rule<(inner?: boolean) => void>;
  supportsAtRule!: Rule<(inner?: boolean) => void>;
  containerAtRule!: Rule<(inner?: boolean) => void>;
  atRuleBody!: Rule<(inner?: boolean) => void>;
  pageAtRule!: Rule;
  keyframesAtRule!: Rule;
  keyframesName!: Rule;
  layerAtRule!: Rule<(inner?: boolean) => void>;
  layerName!: Rule;
  scopeAtRule!: Rule<(inner?: boolean) => void>;
  documentAtRule!: Rule<(inner?: boolean) => void>;
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

  /**
   * `@supports` syntax - the parsing is defined differently
   * from `@media`, which is fortunate, because it's much
   * simpler.
  */
  supportsCondition!: Rule;
  supportsInParens!: Rule;

  /** General purpose subrules */
  anyOuterValue!: Rule<(ctx?: RuleContext) => void>;
  anyInnerValue!: Rule<(ctx?: RuleContext) => void>;
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

    const { legacyMode = true, ...rest } = { ...defaultConfig, ...config, maxLookahead: 1 };

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
    existingRules: Node[] | undefined,
    nextTokenLocation?: LocationInfo
  ) {
    if (!nextTokenLocation) {
      nextTokenLocation = this.getLocationInfo(this.LA(1));
    }
    if (!existingRules) {
      return undefined;
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
    token: IToken
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

    if (tokenMatcher(token, T.Ident)) {
      /** @todo - check to see if it's a color */
      // In value position, treat as a generic identifier
      return new Any(tokValue, undefined, this.getLocationInfo(token), this.context);
    } else if (tokenMatcher(token, T.Dimension)) {
      dimValue = { number: parseFloat(token.payload[0]), unit: token.payload[1] };
      return getDimension(dimValue);
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
      return getNumber(numValue!);
    } else if (tokenMatcher(token, T.Number)) {
      numValue = parseFloat(tokValue);
      return getNumber(numValue);
    } else if (tokenMatcher(token, T.Color)) {
      return new Color(tokValue, undefined, this.getLocationInfo(token), this.context);
    } else {
      return new Any(tokValue, { type: token.tokenType.name }, this.getLocationInfo(token), this.context);
    }
  }
}
