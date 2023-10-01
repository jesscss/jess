import {
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type CstNode,
  type ParserMethod
} from 'chevrotain'
import { AdvancedCstParser } from './advancedCstParser'
import { LLStarLookaheadStrategy } from 'chevrotain-allstar'

import { type CssTokenType } from './cssTokens'
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

export class CssCstParser extends AdvancedCstParser {
  T: TokenMap
  legacyMode: boolean

  /** Rewire, declaring class fields in constructor with `public` */
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
  valueList: Rule<(ctx?: RuleContext) => void>
  /** Often a space-separated sequence */
  valueSequence: Rule<(ctx?: RuleContext) => void>
  value: Rule<(ctx?: RuleContext) => void>
  squareValue: Rule<(ctx?: RuleContext) => void>
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
      }),
      nodeLocationTracking: 'full'
    }

    const { legacyMode = true, ...rest } = { ...defaultConfig, ...config }

    super(tokenVocabulary, rest)

    this.T = T
    this.legacyMode = legacyMode

    productions.call(this, T)

    if (this.constructor === CssCstParser) {
      this.performSelfAnalysis()
    }
  }
}
