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
                $.SUBRULE($.expression)
                $.CONSUME2(T.Semi)
              }
            }
          ])
        }
      },
      /** Just a regular unknown at-rule */
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
      { ALT: () => $.SUBRULE($.mixinCallSequence) },
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

export function guards(this: LessParser, T: TokenMap) {
  const $ = this

  $.RULE('guard', () => {
    $.CONSUME(T.When)
  })
}

export function mixinsAndNamespaces(this: LessParser, T: TokenMap) {
  const $ = this

  /** e.g. .mixin */
  $.RULE('mixinName', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.classSelector) },
      { ALT: () => $.SUBRULE($.idSelector) }
    ])
  })

  /** e.g. .mixin() {} */
  $.RULE('mixinDefinition', () => {
    $.SUBRULE($.mixinName)
    $.CONSUME(T.LParen)
    $.OPTION(() => $.SUBRULE($.mixinArgList, { ARGS: [true] }))
    $.CONSUME(T.RParen)
    $.OPTION2(() => $.SUBRULE($.guard))
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  /** e.g. #ns > .mixin() */
  $.RULE('mixinCallSequence', () => {
    $.SUBRULE($.mixinCall)
    $.MANY(() => {
      $.OPTION(() => $.CONSUME(T.Gt))
      $.SUBRULE2($.mixinCall)
    })
  })

  $.RULE('mixinCall', () => {
    $.SUBRULE($.mixinName)
    $.OPTION(() => $.SUBRULE($.mixinCallArgs))
    $.OPTION2(() => $.SUBRULE($.accessors))
  })

  $.RULE('mixinCallArgs', () => {
    $.CONSUME(T.LParen)
    $.OPTION(() => $.SUBRULE($.mixinArgList))
    $.CONSUME(T.RParen)
  })

  $.RULE('accessors', () => {
    $.CONSUME(T.LSquare)
    $.OPTION(() => $.OR([
      { ALT: () => $.CONSUME(T.NestedReference) },
      { ALT: () => $.CONSUME(T.AtName) },
      { ALT: () => $.CONSUME(T.PropertyReference) }
    ]))
    $.CONSUME(T.RSquare)
    /** Allows chaining of lookups / calls */
    $.OPTION2(() => {
      $.OR2([
        { ALT: () => $.SUBRULE($.mixinCall) },
        { ALT: () => $.SUBRULE($.mixinCallArgs) },
        { ALT: () => $.SUBRULE($.accessors) }
      ])
    })
  })

  /**
   * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
   *
   * Less allows separating with commas or semi-colons, so we sort out
   * the bounds of each argument in the CST Visitor.
   */
  $.RULE('mixinArgList', (definition: boolean = false) => {
    $.SUBRULE($.mixinArg, { ARGS: [definition] })
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Comma) },
        { ALT: () => $.CONSUME(T.Semi) }
      ])
      $.SUBRULE2($.mixinArg, { ARGS: [definition] })
    })
    $.OPTION(() => $.CONSUME2(T.Semi))
  })

  $.RULE('mixinArg', (definition: boolean = false) => {
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
            {
              GATE: () => definition,
              ALT: () => $.CONSUME(T.Ellipsis)
            }
          ])
        }
      },
      { ALT: () => $.SUBRULE2($.valueSequence) },
      {
        GATE: () => definition,
        ALT: () => $.CONSUME2(T.Ellipsis)
      }
    ])
  })

  $.OVERRIDE_RULE('main', () => {
    $.MANY(() => {
      $.OR([
        { ALT: () => $.SUBRULE($.mixinDefinition) },
        { ALT: () => $.SUBRULE($.mixinCallSequence) },
        { ALT: () => $.SUBRULE($.qualifiedRule) },
        { ALT: () => $.SUBRULE($.atRule) }
      ])
    })
  })

  /**
   * Expland the recursive pattern to make sure we have semi-separators
   * after mixin calls.
   */
  $.OVERRIDE_RULE('main', () => {
    $.OPTION(() => {
      $.OR([
        {
          ALT: () => {
            $.SUBRULE($.mixinDefinition)
            $.OPTION2(() => $.SUBRULE($.main))
          }
        },
        {
          ALT: () => {
            $.SUBRULE($.mixinCallSequence)
            /** This is very similar to declaration list parsing */
            $.OPTION3(() => {
              $.CONSUME(T.Semi)
              $.OPTION4(() => $.SUBRULE2($.main))
            })
          }
        },
        {
          ALT: () => {
            $.SUBRULE($.qualifiedRule)
            $.OPTION5(() => $.SUBRULE3($.main))
          }
        },
        {
          ALT: () => {
            $.SUBRULE($.atRule)
            $.OPTION6(() => $.SUBRULE4($.main))
          }
        }
      ])
    })
  })

  $.OVERRIDE_RULE('declarationList', () => {
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.mixinDefinition)
          $.OPTION(() => $.SUBRULE($.declarationList))
        }
      },
      {
        ALT: () => {
          $.OR2([
            { ALT: () => $.SUBRULE($.mixinCallSequence) },
            { ALT: () => $.OPTION2(() => $.SUBRULE($.declaration)) }
          ])
          $.OPTION3(() => {
            $.CONSUME(T.Semi)
            $.SUBRULE2($.declarationList)
          })
        }
      },
      {
        ALT: () => {
          $.SUBRULE($.innerAtRule)
          $.SUBRULE3($.declarationList)
        }
      },
      {
        ALT: () => {
          $.SUBRULE($.qualifiedRule, { ARGS: [true] })
          $.SUBRULE4($.declarationList)
        }
      }
    ])
  })
}

export function extendSelectors(this: LessParser, T: TokenMap) {
  const $ = this

  /** Extend to include interpolated selectors */
  $.OVERRIDE_RULE('classSelector', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.InterpolatedSelector) },
      {
        ALT: () => {
          $.CONSUME(T.Dot)
          $.OR2([
            {
              GATE: $.noSep,
              ALT: () => $.CONSUME(T.Ident)
            }
          ])
        }
      }
    ])
  })
}