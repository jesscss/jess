import { TokenType, IParserConfig } from 'chevrotain'
import { TokenMap, CssParser, Rule } from '@jesscss/css-parser'
import root from './productions/root'
import atRules from './productions/atRules'
import blocks from './productions/blocks'
import declarations from './productions/declarations'
import mixin from './productions/mixin'
import selectors from './productions/selectors'
import interpolation from './productions/interpolation'
import values from './productions/values'

export class JessParser extends CssParser {
  T: TokenMap

  identOrInterpolated: Rule

  /** values */
  addition: Rule
  multiplication: Rule
  compare: Rule
  variable: Rule
  valueBlock: Rule

  /** functions */
  function: Rule
  functionArgs: Rule
  functionArg: Rule

  /** mixins */
  mixin: Rule
  mixinName: Rule
  mixinStart: Rule
  mixinArgs: Rule
  mixinArg: Rule

  constructor(
    tokens: TokenType[],
    T: TokenMap,
    config: IParserConfig = {
      maxLookahead: 1
    }
  ) {
    super(tokens, T, config)
    const $ = this
    $.T = T

    root.call($, $)
    atRules.call($, $)
    blocks.call($, $)
    declarations.call($, $)
    interpolation.call($, $)
    mixin.call($, $)
    selectors.call($, $)
    values.call($, $)

    if ($.constructor === JessParser) {
      $.performSelfAnalysis()
    }
  }

  // https://sap.github.io/chevrotain/documentation/6_1_0/classes/baseparser.html#reset
  reset() {
    super.reset()
    this.inCompareBlock = false
    this.isMixinDefinition = false
    this.isSemiColonSeparated = false
    this.isVariableCall = false
  }
}
