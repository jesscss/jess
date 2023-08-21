import type { LessParser, TokenMap } from './lessParser'

export function innerIdentSelector(this: LessParser, T: TokenMap) {
  const $ = this
  /** Allow identifiers at rule starts */
  $.OVERRIDE_RULE('simpleSelector', (inner: boolean = false) => {
    $.OR([
      { ALT: () => $.CONSUME(T.Ident) },
      {
      /** In CSS Nesting, outer selector can't contain an ampersand */
        GATE: () => inner,
        ALT: () => $.CONSUME(T.Ampersand)
      },
      { ALT: () => $.SUBRULE($.classSelector) },
      { ALT: () => $.CONSUME(T.HashName) },
      { ALT: () => $.CONSUME(T.ColorIdentStart) },
      { ALT: () => $.CONSUME(T.Star) },
      { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [inner] }) },
      { ALT: () => $.SUBRULE($.attributeSelector) }
    ])
  })
}

export function atVariableDeclarations(this: LessParser, T: TokenMap) {
  const $ = this
  /** Less variables */
  $.OVERRIDE_RULE('unknownAtRule', () => {
    $.CONSUME(T.AtKeyword)
    $.OR([
      {
        /** This is a variable declaration */
        ALT: () => {
          $.CONSUME(T.Colon)
          $.OR2([
            {
              ALT: () => {
                $.CONSUME(T.LCurly)
                $.SUBRULE($.declarationList)
                $.CONSUME(T.RCurly)
                $.OPTION(() => $.CONSUME(T.Semi))
              }
            },
            {
              ALT: () => {
                $.SUBRULE($.anyOuterValue)
                $.CONSUME2(T.Semi)
              }
            }
          ])
        }
      },
      {
        ALT: () => {
          $.MANY(() => $.SUBRULE2($.anyOuterValue))
          $.OR3([
            { ALT: () => $.CONSUME3(T.Semi) },
            {
              ALT: () => {
                $.CONSUME2(T.LCurly)
                $.MANY2(() => $.SUBRULE($.anyInnerValue))
                $.CONSUME2(T.RCurly)
              }
            }
          ])
        }
      }
    ])
  })
}

export function mathExpressions(this: LessParser, T: TokenMap) {
  const $ = this
  $.OVERRIDE_RULE('valueSequence', () => {
    $.OR([
      {
        GATE: () => $.loose,
        ALT: () => { $.MANY(() => $.SUBRULE($.expression)) }
      },
      {
        GATE: () => !$.loose,
        /** @todo - create warning in the CST Visitor */
        ALT: () => { $.AT_LEAST_ONE(() => $.SUBRULE2($.expression)) }
      }
    ])
  })

  $.RULE('expression', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mathSum) },
      { ALT: () => $.SUBRULE($.anyOuterValue) }
    ])
  })

  $.OVERRIDE_RULE('mathValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.String) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.MathConstant) },
      { ALT: () => $.SUBRULE($.function) },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.SUBRULE($.mathSum)
          $.CONSUME(T.RParen)
        }
      }
    ])
  })
}

export function mixinDefinition(this: LessParser, T: TokenMap) {
  const $ = this

  $.OVERRIDE_RULE('selectorList', () => {
    $.SUBRULE($.complexSelector)
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.OPTION(() => $.SUBRULE($.mixinDefinitionArgList))
          $.CONSUME(T.RParen)
        }
      },
      {
        ALT: () => {
          $.MANY(() => {
            $.CONSUME(T.Comma)
            $.SUBRULE2($.complexSelector)
          })
        }
      }
    ])
  })

  /**
   * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
   *
   * Less allows separating with commas or semi-colons, so we sort out
   * the bounds of each argument in the CST Visitor.
   */
  $.RULE('mixinDefinitionArgList', () => {
    $.SUBRULE($.mixinDefinitionArg)
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Comma) },
        { ALT: () => $.CONSUME(T.Semi) }
      ])
      $.SUBRULE2($.mixinDefinitionArg)
    })
    $.OPTION(() => $.CONSUME2(T.Semi))
  })

  $.RULE('mixinDefinitionArg', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.AtKeyword)
          $.OR2([
            {
              ALT: () => {
                $.CONSUME(T.Colon)
                $.SUBRULE($.valueSequence)
              }
            },
            { ALT: () => $.CONSUME(T.Ellipsis) }
          ])
        }
      },
      { ALT: () => $.SUBRULE2($.valueSequence) },
      { ALT: () => $.CONSUME2(T.Ellipsis) }
    ])
  })
}