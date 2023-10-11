import {
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type ParserMethod,
  type IToken,
  tokenMatcher
} from 'chevrotain'

// import { AdvancedCstParser } from './advancedCstParser'
import { LLStarLookaheadStrategy } from 'chevrotain-allstar'

import { AdvancedActionsParser } from './advancedActionsParser'

import { type CssTokenType } from './cssTokens'
import { productions } from './productions'
import {
  type LocationInfo,
  Node,
  Comment,
  Color,
  Dimension,
  Anonymous,
  Keyword
} from '@jesscss/core'

const { isArray } = Array

// /** Assert that tokens will have full location info */
// export interface IToken extends Required<Omit<OrigIToken, 'payload'>> {
//   payload?: OrigIToken['payload']
// }

export type TokenMap = Record<CssTokenType, TokenType>

export type Rule<F extends () => void = () => void> = ParserMethod<Parameters<F>, any>

export interface CssParserConfig extends IParserConfig {
  /** Thinks like star property hacks and IE filters */
  legacyMode?: boolean
}

export type RuleContext = {
  /** Inside a declaration list */
  inner?: boolean
  /** Determine if this is the first selector in the list */
  firstSelector?: boolean
  /** If downstream selector rules are part of a qualified rule */
  qualifiedRule?: boolean

  [k: string]: boolean | undefined
}

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
  T: TokenMap
  legacyMode: boolean

  /** Expose Chevrotain's flag */
  skipValidations: boolean

  /** Rewire, declaring class fields in constructor with `public` */
  stylesheet: Rule
  main: Rule<(ctx?: RuleContext) => void>
  qualifiedRule: Rule<(ctx?: RuleContext) => void>
  atRule: Rule
  selectorList: Rule<(ctx?: RuleContext) => void>
  declarationList: Rule
  forgivingSelectorList: Rule<(ctx?: RuleContext) => void>
  classSelector: Rule
  idSelector: Rule
  pseudoSelector: Rule<(ctx?: RuleContext) => void>
  attributeSelector: Rule
  nthValue: Rule
  complexSelector: Rule<(ctx?: RuleContext) => void>
  simpleSelector: Rule<(ctx?: RuleContext) => void>
  compoundSelector: Rule<(ctx?: RuleContext) => void>
  relativeSelector: Rule<(ctx?: RuleContext) => void>

  declaration: Rule
  valueList: Rule<(ctx?: RuleContext) => void>
  /** Often a space-separated sequence */
  valueSequence: Rule<(ctx?: RuleContext) => void>
  value: Rule<(ctx?: RuleContext) => void>
  squareValue: Rule<(ctx?: RuleContext) => void>
  customValue: Rule
  innerCustomValue: Rule

  function: Rule
  functionArgs: Rule<(ctx?: RuleContext) => void>
  knownFunctions: Rule
  varFunction: Rule
  calcFunction: Rule
  urlFunction: Rule
  unknownValue: Rule
  string: Rule

  // expression: Rule
  // calc()
  mathSum: Rule
  mathProduct: Rule
  mathValue: Rule

  /** At Rules */
  innerAtRule: Rule
  importAtRule: Rule
  mediaAtRule: Rule<(inner?: boolean) => void>
  supportsAtRule: Rule<(inner?: boolean) => void>
  containerAtRule: Rule<(inner?: boolean) => void>
  atRuleBody: Rule<(inner?: boolean) => void>
  pageAtRule: Rule
  pageSelector: Rule
  fontFaceAtRule: Rule
  nestedAtRule: Rule
  nonNestedAtRule: Rule
  unknownAtRule: Rule

  /** `@media` syntax */
  mediaQuery: Rule
  mediaCondition: Rule
  mediaType: Rule
  mediaConditionWithoutOr: Rule
  mediaNot: Rule
  mediaInParens: Rule
  mediaAnd: Rule
  mediaOr: Rule
  mediaFeature: Rule

  mfValue: Rule
  mediaRange: Rule
  mfComparison: Rule
  mfNonIdentifierValue: Rule

  /**
   * `@supports` syntax - the parsing is defined differently
   * from `@media`, which is fortunate, because it's much
   * simpler.
  */
  supportsCondition: Rule
  supportsInParens: Rule

  /** General purpose subrules */
  anyOuterValue: Rule<(ctx?: RuleContext) => void>
  anyInnerValue: Rule<(ctx?: RuleContext) => void>
  extraTokens: Rule
  customBlock: Rule

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: CssParserConfig = {}
  ) {
    const defaultConfig: CssParserConfig = {
      lookaheadStrategy: new LLStarLookaheadStrategy({
        // suppress ambiguity logging
        // logging() {}
      })
    }

    const { legacyMode = true, ...rest } = { ...defaultConfig, ...config }

    super(tokenVocabulary, rest)

    this.T = T
    this.legacyMode = legacyMode

    productions.call(this, T)

    if (this.constructor === CssActionsParser) {
      this.performSelfAnalysis()
    }
  }

  protected getLocationFromNodes(nodes: Node[]) {
    let startNode = nodes[0]!
    let lastNode = nodes[nodes.length - 1]!
    let [startOffset, startLine, startColumn] = startNode.location
    let [,,,endOffset, endLine, endColumn] = lastNode.location
    let location: LocationInfo = [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!]
    return location
  }

  protected getRulesWithComments(existingRules: Node[]) {
    let rules = []
    /**
     * @todo - I think this pattern means that comments after
     * the last rule will be tossed out, so we need to figure
     * out a way to get comments when comments are the only
     * content in a file.
     */
    // let rule: Node | undefined

    for (let rule of existingRules) {
      let pre = this.getPrePost(rule.location[0]!)
      if (isArray(pre)) {
        let i = 0
        let item = pre[i]
        while (item) {
          if (item instanceof Node) {
            let prev = pre[i - 1]
            /** Attach whitespace before comment to comment */
            if (prev) {
              item.pre = [prev]
              pre.shift()
              i--
            }
            rules.push(item)
            pre.shift()
            i--
          }
          item = pre[++i]
        }
      }
      rule.pre = pre
      rules.push(rule)
    }
    return rules
  }

  protected getPrePost(offset: number, commentsOnly?: boolean, post?: boolean): Node['pre'] {
    let skipped = post ? this.postSkippedTokenMap.get(offset) : this.preSkippedTokenMap.get(offset)
    if (!skipped) {
      return 0
    }
    if (this.usedSkippedTokens.has(skipped)) {
      return 0
    }
    this.usedSkippedTokens.add(skipped)

    let pre: Node['pre'] = skipped.map(token => {
      let name = token.tokenType.name
      if (name === 'WS') {
        return token.image
      } else {
        return new Comment(token.image, { lineComment: name.includes('Line') }, this.getLocationInfo(token), this.context)
      }
    })
    if (commentsOnly) {
      pre = pre.filter(item => item instanceof Comment)
    }

    if (pre.length === 1 && pre[0] === ' ') {
      pre = 1
    }
    return pre
  }

  /**
   * Attaches pre / post whitespace and comments.
   * Note that nodes can be wrapped more than once.
   */
  protected wrap<T extends Node = Node>(node: T, post?: boolean | 'both', commentsOnly?: boolean): T {
    if (!(node instanceof Node)) {
      return node
    }
    let skipValidations = this.skipValidations
    if (post) {
      if (node.post === 0) {
        let offset = node.location[3]
        if (!offset && !skipValidations) {
          throw new Error(`Node "${node.type}" can't be wrapped`)
        }
        node.post = this.getPrePost(offset!, commentsOnly, true)
      }
      if (post !== 'both') {
        return node
      }
    }
    if (node.pre === 0) {
      let offset = node.location[0]
      if (!offset && !skipValidations) {
        throw new Error(`Node "${node.type}" can't be wrapped`)
      }
      node.pre = this.getPrePost(offset!, commentsOnly)
    }
    return node
  }

  protected processValueToken(
    token: IToken
  ) {
    let tokValue = token.image
    let tokType = token.tokenType
    let tokName = tokType.name
    let T = this.T
    let dimValue: [number: number, unit?: string] | undefined
    const getDimension = (finalValue: Exclude<typeof dimValue, undefined>) =>
      new Dimension(finalValue, undefined, this.getLocationInfo(token), this.context)

    if (tokenMatcher(token, T.Ident)) {
      /** @todo - check to see if it's a color */
      return new Keyword(tokValue, undefined, this.getLocationInfo(token), this.context)
    } else if (tokenMatcher(token, T.Dimension)) {
      dimValue = [parseFloat(token.payload[0]), token.payload[1]]
      return getDimension(dimValue)
    } else if (tokName === 'MathConstant') {
      switch (tokValue.toLowerCase()) {
        case 'pi':
          dimValue = [Math.PI]
          break
        case 'infinity':
          dimValue = [Infinity]
          break
        case '-infinity':
          dimValue = [-Infinity]
          break
        case 'e':
          dimValue = [Math.E]
          break
        case 'nan':
          dimValue = [NaN]
      }
      return getDimension(dimValue!)
    } else if (tokenMatcher(token, T.Number)) {
      dimValue = [parseFloat(tokValue)]
      return getDimension(dimValue)
    } else if (tokenMatcher(token, T.Color)) {
      return new Color(tokValue, undefined, this.getLocationInfo(token), this.context)
    } else {
      return new Anonymous(tokValue, undefined, this.getLocationInfo(token), this.context)
    }
  }
}
