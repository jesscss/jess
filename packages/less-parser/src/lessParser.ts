import type { IParserConfig, TokenVocabulary, TokenType } from 'chevrotain'
// import { LLStarLookaheadStrategy } from 'chevrotain-allstar'
import type { Rule } from '@jesscss/css-parser'
import { CssParser } from '@jesscss/css-parser'
import { type LessTokenType } from './lessTokens'
import {
  innerIdentSelector,
  atVariableDeclarations,
  mathExpressions,
  mixinDefinition
} from './extensions'

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

export class LessParser extends CssParser {
  T: TokenMap

  expression: Rule

  // mixins
  mixinDefinitionArgList: Rule
  mixinDefinitionArg: Rule

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: IParserConfig = {}
  ) {
    super(tokenVocabulary, T, config)

    const $ = this

    /** Less extensions */
    ;[
      innerIdentSelector,
      atVariableDeclarations,
      mathExpressions,
      mixinDefinition
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