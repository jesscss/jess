import type { TokenVocabulary, TokenType } from 'chevrotain'
// import { LLStarLookaheadStrategy } from 'chevrotain-allstar'
import type { Rule, RuleContext as CssRuleContext, CssParserConfig } from '@jesscss/css-parser'
import { CssParser } from '@jesscss/css-parser'
import { type LessTokenType } from './lessTokens'
import {
  atVariableDeclarations,
  mathExpressions,
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
  /**
   * This is parsing state maintained while parsing a qualified rule.
   * It helps determine if this is valid as a mixin call or definition
   * without having to backtrack.
   */
  isMixinCallCandidate?: boolean
  isMixinDefinitionCandidate?: boolean
  hasExtend?: boolean
  // isCompareExpression?: boolean
}
/**
 * Unlike the historical Less parser, this parser
 * avoids all backtracking
 */
export class LessParser extends CssParser {
  T: TokenMap

  expression: Rule
  expressionValue: Rule
  function: Rule

  testQualifiedRule: Rule

  // mixins
  mixinName: Rule
  mixinDefinition: Rule
  mixinCallSequence: Rule
  mixinCall: Rule
  mixinCallArgs: Rule<(ctx?: RuleContext) => void>
  mixinArgList: Rule<(ctx?: RuleContext) => void>
  mixinArg: Rule<(ctx?: RuleContext) => void>
  mixinValue: Rule

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
      mathExpressions,
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