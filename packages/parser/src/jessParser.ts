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
import variables from './productions/variables'

export class JessParser extends CssParser {
  T: TokenMap

  atImportCss: Rule
  atImportJs: Rule
  atImportJsBlock: Rule
  atImportJsArg: Rule

  /** JS Stuff */
  atLet: Rule
  atLetValue: Rule
  jsCollection: Rule
  jsExpression: Rule
  jsValue: Rule
  jsTokens: Rule

  /** Mixins */
  rulesMixin: Rule
  mixin: Rule
  mixinPrelude: Rule
  mixinArgs: Rule
  mixinArg: Rule
  atInclude: Rule

  rulePrimary: Rule
  nested: Rule

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
    variables.call($, $)

    if ($.constructor === JessParser) {
      $.performSelfAnalysis()
    }
  }
}
