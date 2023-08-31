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

export type LessParserConfig = CssParserConfig

export type TokenMap = Record<LessTokenType, TokenType>

export type RuleContext = CssRuleContext & {
  hasExtend?: boolean
  /** Mixin definition */
  isDefinition?: boolean
  // isCompareExpression?: boolean
  allowsAnonymousMixins?: boolean
}
/**
 * Unlike the historical Less parser, this parser
 * avoids all backtracking
 */
export class LessParser extends CssParser {
  T: TokenMap

  expression: Rule<(ctx?: RuleContext) => void>
  expressionValue: Rule<(ctx?: RuleContext) => void>
  functionValueList: Rule

  testQualifiedRule: Rule

  // mixins
  mixinName: Rule
  mixinDefinition: Rule
  mixinCall: Rule
  mixinCallLookup: Rule
  mixinArgs: Rule<(ctx?: RuleContext) => void>
  mixinArgList: Rule<(ctx?: RuleContext) => void>
  mixinArg: Rule<(ctx?: RuleContext) => void>
  mixinValue: Rule
  anonymousMixinDefinition: Rule

  extend: Rule<(ctx?: RuleContext) => void>

  // namespaces
  accessors: Rule

  comparison: Rule
  guard: Rule
  guardOr: Rule<(disallowComma?: boolean) => void>
  guardAnd: Rule
  guardInParens: Rule

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: LessParserConfig = {}
  ) {
    super(tokenVocabulary, T, config)

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