import {
  CstParser,
  EOF,
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type IToken,
  type CstNode,
  type ParserMethod,
  type ConsumeMethodOpts
} from 'chevrotain'
import { LLStarLookaheadStrategy } from 'chevrotain-allstar'

import { type CssTokenType, SKIPPED_LABEL } from './cssTokens'
import { productions } from './productions'

export type TokenMap = Record<CssTokenType, TokenType>

/**
  Note that whitespace is WS* and not consumed as
  WS? even though whitespace consumes multiple spaces.
  This is because comments can cause consecutive
  WS to be separated into separate tokens.

  Even though CSS pretends that white-space isn't important
  in a number of specs, it obviously is in one specific place:
  between selectors. So if you want a general purpose parser,
  you need to parse whitespace.

  Also, by parsing whitespace, some of the token recognition
  phase and the parsing phase can be simplified, because
  we can parse colons (':') as general tokens, which means
  that a declaration of `a:b` doesn't get mis-labeled as
  an identifier followed by a pseudo-selector.

  Another approach would be to have different lexing phases
  for qualified rules vs declarations, but it can
  get super-complicated quickly.
*/
export type Rule<F extends () => void = () => void> = ParserMethod<Parameters<F>, CstNode>

export interface CssParserConfig extends IParserConfig {
  /** Thinks like star property hacks and IE filters */
  legacyMode?: boolean
  /**
   * This allows more syntax that is invalid according to the CSS spec.
   * Mainly, this allows unknown tokens (or no tokens) in property values.
   */
  loose?: boolean
}

export class CssParser extends CstParser {
  T: TokenMap
  skippedTokens: Map<number, IToken[]>
  legacyMode: boolean
  loose: boolean

  stylesheet: Rule
  main: Rule
  qualifiedRule: Rule<(inner?: boolean) => void>
  atRule: Rule
  selectorList: Rule
  declarationList: Rule
  forgivingSelectorList: Rule<(inner?: boolean, firstSelector?: boolean) => void>
  classSelector: Rule
  idSelector: Rule
  pseudoSelector: Rule<(inner?: boolean) => void>
  attributeSelector: Rule
  nthValue: Rule
  complexSelector: Rule<(inner?: boolean, firstSelector?: boolean) => void>
  simpleSelector: Rule<(inner?: boolean, firstSelector?: boolean) => void>
  compoundSelector: Rule<(inner?: boolean, firstSelector?: boolean) => void>
  relativeSelector: Rule<(inner?: boolean, firstSelector?: boolean) => void>
  combinator: Rule

  declaration: Rule
  innerAtRule: Rule
  valueList: Rule

  /** Often a space-separated sequence */
  valueSequence: Rule
  value: Rule
  customValue: Rule
  innerCustomValue: Rule

  function: Rule
  knownFunctions: Rule
  varFunction: Rule
  calcFunction: Rule
  urlFunction: Rule
  unknownValue: Rule

  expression: Rule
  mathProduct: Rule
  mathSum: Rule
  mathValue: Rule

  /** At Rules */
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
  generalEnclosed: Rule

  mfValue: Rule
  mediaRange: Rule
  mfComparison: Rule
  mfNonIdentifierValue: Rule

  /** `@supports` syntax */
  supportsCondition: Rule
  supportsInParens: Rule

  /**
   * `@supports` is defined differently in spec,
   * but parsing is much like media queries,
   * so we structure the same for symmetry
   */
  supportsNot: Rule
  supportsAnd: Rule
  supportsOr: Rule

  /** General purpose subrules */
  anyOuterValue: Rule
  anyInnerValue: Rule
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
        logging() {}
      }),
      nodeLocationTracking: 'full'
    }

    const { legacyMode, loose = false, ...rest } = { ...defaultConfig, ...config }

    super(tokenVocabulary, rest)

    this.T = T
    this.legacyMode = legacyMode ?? loose
    this.loose = loose

    productions.call(this, T)

    if (this.constructor === CssParser) {
      this.performSelfAnalysis()
    }
  }

  cstPostTerminal(
    key: string,
    consumedToken: IToken
  ): void {
    const rootCst = this.CST_STACK[this.CST_STACK.length - 1]
    this.addTerminalToCst(rootCst, consumedToken, key)
    this.setNodeLocationFromToken(rootCst.location!, <any>consumedToken)
  }

  cstPostNonTerminal(
    ruleCstResult: CstNode,
    ruleName: string
  ): void {
    const preCstNode = this.CST_STACK[this.CST_STACK.length - 1]
    this.addNoneTerminalToCst(preCstNode, ruleName, ruleCstResult)
    this.setNodeLocationFromNode(preCstNode.location!, ruleCstResult.location!)
  }

  cstInvocationStateUpdate(this: CstParser, fullRuleName: string): void {
    const cstNode: Partial<CstNode> = {
      name: fullRuleName,
      children: Object.create(null)
    }
    /**
     * Sets a linear stream of children CstNodes and ITokens
     * which can easily be re-serialized.
     */
    Object.defineProperty(cstNode, 'childrenStream', {
      value: []
    })

    this.setInitialNodeLocation(cstNode as CstNode)
    this.CST_STACK.push(cstNode as CstNode)
  }

  addTerminalToCst(node: CstNode, token: IToken, tokenTypeName: string) {
    node.childrenStream.push(token)
    if (node.children[tokenTypeName] === undefined) {
      node.children[tokenTypeName] = [token]
    } else {
      node.children[tokenTypeName].push(token)
    }
  }

  addNoneTerminalToCst(node: CstNode, ruleName: string, ruleResult: any) {
    this.addTerminalToCst(node, ruleResult, ruleName)
  }

  private _consumeImplicits(key: 'pre' | 'post') {
    const skipped = this.skippedTokens.get(this.currIdx + 1)
    if (skipped) {
      if (key === 'pre' || this.LA(1).tokenType === EOF) {
        skipped.forEach(token => this.cstPostTerminal(key, token))
      }
    }
  }

  consumeInternal(tokType: TokenType, idx: number, options?: ConsumeMethodOpts): IToken {
    this._consumeImplicits('pre')
    const retVal = super.consumeInternal(tokType, idx, options)
    this._consumeImplicits('post')
    return retVal
  }

  /** Separate skipped tokens into a new map */
  // eslint-disable-next-line accessor-pairs
  set input(value: IToken[]) {
    const skippedTokens = new Map<number, IToken[]>()
    const inputTokens: IToken[] = []
    let foundTokens: number = 0
    for (let i = 0; i < value.length; i++) {
      const token = value[i]
      if (token.tokenType.LABEL === SKIPPED_LABEL) {
        const tokens = skippedTokens.get(foundTokens) ?? []
        skippedTokens.set(foundTokens, [...tokens, token])
      } else {
        inputTokens.push(token)
        foundTokens++
      }
    }
    this.skippedTokens = skippedTokens
    super.input = inputTokens
  }

  /**
   * Used in a GATE.
   * Determine if there is white-space before the next token
   */
  hasWS() {
    const skipped = this.skippedTokens.get(this.currIdx + 1)
    if (!skipped) {
      return false
    }
    return !!skipped.find(token => token.tokenType === this.T.WS)
  }

  /**
   * Used in a GATE.
   * Affirms that there is NOT white space or comment before next token
   */
  noSep() {
    return !this.skippedTokens.get(this.currIdx + 1)
  }
}
