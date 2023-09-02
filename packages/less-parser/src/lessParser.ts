import type { TokenVocabulary, TokenType } from 'chevrotain'
// import { LLStarLookaheadStrategy } from 'chevrotain-allstar'
import type { Rule, RuleContext as CssRuleContext, CssParserConfig } from '@jesscss/css-parser'
import { CssParser } from '@jesscss/css-parser'
import { type LessTokenType } from './lessTokens'
import {
  atVariableDeclarations,
  expressionsAndValues,
  mixinsAndNamespaces,
  extendSelectors,
  extendRoot,
  guards,
  atRuleBubbling
} from './productions'

// import root from './productions/root'
// import atRules from './productions/atRules'
// import blocks from './productions/blocks'
// import declarations from './productions/declarations'
// import mixin from './productions/mixin'
// import selectors from './productions/selectors'
// import interpolation from './productions/interpolation'
// import values from './productions/values'

export type LessParserConfig = CssParserConfig & {
  /**
   * Is less strict with certain CSS rules
   * that the old Less parser allowed.
   *
   * @note This will also enable CSS legacyMode unless
   * legacyMode is explicitly false.
   */
  looseMode?: boolean
}

export type TokenMap = Record<LessTokenType, TokenType>

export type RuleContext = CssRuleContext & {
  hasExtend?: boolean
  /** Mixin definition */
  isDefinition?: boolean
  // isCompareExpression?: boolean
  allowAnonymousMixins?: boolean
  // boolean() and if() do not need parens around compare expressions
  // additionally, they do not allow outer commas
  inValueList?: boolean
  // An outer guard allows a comma
  allowComma?: boolean
}
/**
 * Unlike the historical Less parser, this parser
 * avoids all backtracking
 */
export class LessParser extends CssParser {
  T: TokenMap
  looseMode: boolean

  expression: Rule<(ctx?: RuleContext) => void>
  expressionValue: Rule<(ctx?: RuleContext) => void>
  functionValueList: Rule
  ifFunction: Rule
  booleanFunction: Rule

  valueReference: Rule

  // mixins
  mixinReference: Rule
  mixinName: Rule
  mixinDefinition: Rule
  mixinCall: Rule
  inlineMixinCall: Rule
  mixinArgs: Rule<(ctx?: RuleContext) => void>
  mixinArgList: Rule<(ctx?: RuleContext) => void>
  mixinArg: Rule<(ctx?: RuleContext) => void>
  mixinValue: Rule
  anonymousMixinDefinition: Rule

  extend: Rule<(ctx?: RuleContext) => void>

  // namespaces
  accessors: Rule

  comparison: Rule
  comparison2: Rule
  guard: Rule<(ctx?: RuleContext) => void>
  guardOr: Rule<(ctx?: RuleContext) => void>
  guardAnd: Rule<(ctx?: RuleContext) => void>
  guardInParens: Rule<(ctx?: RuleContext) => void>

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: LessParserConfig = {}
  ) {
    let { legacyMode, looseMode = true, ...rest } = config
    legacyMode = legacyMode ?? looseMode
    super(tokenVocabulary, T, { legacyMode, ...rest })

    this.looseMode = looseMode

    const $ = this

    /** Less extensions */
    ;[
      extendRoot,
      atVariableDeclarations,
      expressionsAndValues,
      guards,
      mixinsAndNamespaces,
      extendSelectors,
      atRuleBubbling
    ].forEach(ext => ext.call($, T))

    if ($.constructor === LessParser) {
      $.performSelfAnalysis()
    }
  }
}