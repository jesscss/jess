import type { IParserConfig, TokenVocabulary, TokenType } from 'chevrotain'
// import { LLStarLookaheadStrategy } from 'chevrotain-allstar'
import type { Rule } from '@jesscss/css-parser'
import { CssParser } from '@jesscss/css-parser'
import { type LessTokenType } from './lessTokens'
import {
  atVariableDeclarations,
  mathExpressions,
  mixinsAndNamespaces,
  extendSelectors,
  extendRoot,
  guards
} from './productions'

// import root from './productions/root'
// import atRules from './productions/atRules'
// import blocks from './productions/blocks'
// import declarations from './productions/declarations'
// import mixin from './productions/mixin'
// import selectors from './productions/selectors'
// import interpolation from './productions/interpolation'
// import values from './productions/values'

export type LessParserConfig = IParserConfig

export type TokenMap = Record<LessTokenType, TokenType>

/**
 * Unlike the historical Less parser, this parser
 * avoids all backtracking
 */
export class LessParser extends CssParser {
  T: TokenMap

  expression: Rule
  function: Rule
  isMixinCallCandidate: boolean
  isMixinDefinitionCandidate: boolean
  isCompareExpression: boolean

  testQualifiedRule: Rule

  // mixins
  mixinName: Rule
  // mixinDefinition: Rule
  mixinCallSequence: Rule
  mixinCall: Rule
  mixinCallArgs: Rule
  mixinArgList: Rule<(definition?: boolean) => void>
  mixinArg: Rule<(definition?: boolean) => void>
  mixinValue: Rule

  // namespaces
  accessors: Rule

  comparison: Rule
  guard: Rule
  guardOr: Rule<(disallowComma?: boolean) => void>
  guardAnd: Rule
  guardExpression: Rule

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: IParserConfig = {}
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
      extendSelectors
    ].forEach(ext => ext.call($, T))

    if ($.constructor === LessParser) {
      $.performSelfAnalysis()
    }
  }

  // https://sap.github.io/chevrotain/documentation/6_1_0/classes/baseparser.html#reset
  reset() {
    super.reset()
    // this.inCompareBlock = false
    // this.isMixinDefinition = false
    // this.isSemiColonSeparated = false
    // this.isVariableCall = false
  }
}