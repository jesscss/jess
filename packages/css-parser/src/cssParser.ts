import {
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type IToken,
  type CstNode,
  type ParserMethod
} from 'chevrotain'
import { AdvancedCstParser } from './advancedCstParser'
import { LLStarLookaheadStrategy } from 'chevrotain-allstar'

import { type CssTokenType } from './cssTokens'
import { productions } from './productions'

class LLStarLookaheadStrategyLogged extends LLStarLookaheadStrategy {
  constructor(...args: any[]) {
    super(...args)

    ;[
      'initialize',
      'validateAmbiguousAlternationAlternatives',
      'validateEmptyOrAlternatives',
      'buildLookaheadForAlternation',
      'buildLookaheadForOptional'
    ].forEach(key => {
      // @ts-expect-error - this is a hack to log the methods
      const value = this[key]
      // @ts-expect-error - this is a hack to log the methods
      this[key] = function(...args) {
        const methodStart = performance.now()
        const result = value.apply(this, args)
        const methodEnd = performance.now()
        console.log(`${key}(): ${Math.round(methodEnd - methodStart)}ms`)
        if (typeof result === 'function') {
          return function(...args: any[]) {
            const start = performance.now()
            // @ts-expect-error - Don't worry about this
            const newResult = result.apply(this, args)
            const end = performance.now()
            console.log(`function(): ${Math.round(end - start)}ms`)
            return newResult
          }
        }
        return result
      }
    })
  }
}

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

export type RuleContext = {
  /** Inside a declaration list */
  inner?: boolean
  /** Determine if this is the first selector in the list */
  firstSelector?: boolean
  /** If downstream selector rules are part of a qualified rule */
  qualifiedRule?: boolean
}

export class CssParser extends AdvancedCstParser {
  T: TokenMap
  skippedTokens: Map<number, IToken[]>
  legacyMode: boolean
  loose: boolean

  stylesheet: Rule
  main: Rule
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
  string: Rule

  // expression: Rule
  // calc()
  mathSum: Rule
  mathProduct: Rule
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
      lookaheadStrategy: new LLStarLookaheadStrategyLogged({
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
}
