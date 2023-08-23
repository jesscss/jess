import type { LessParser, TokenMap } from './lessParser'
import { EMPTY_ALT } from 'chevrotain'

/** Extensions of the CSS language */
export function extendSelectors(this: LessParser, T: TokenMap) {
  const $ = this

  $.OVERRIDE_RULE('qualifiedRule', (inner: boolean = false) => {
    $.isMixinCallCandidate = true
    $.isMixinDefinitionCandidate = true

    $.OR([
      {
        GATE: () => !inner,
        ALT: () => $.SUBRULE($.selectorList)
      },
      {
        GATE: () => inner,
        ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [true, true] })
      }
    ])
    $.OR2([
      {
        GATE: () => $.isMixinCallCandidate,
        ALT: () => $.CONSUME(T.Semi)
      },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.SUBRULE($.declarationList)
          $.CONSUME(T.RCurly)
        }
      }
    ])

    $.isMixinCallCandidate = false
    $.isMixinDefinitionCandidate = false
  })

  $.OVERRIDE_RULE('relativeSelector', (inner?: boolean, firstSelector?: boolean) => {
    $.OR([
      {
        ALT: () => {
          $.isMixinCallCandidate = false
          $.isMixinDefinitionCandidate = false
          $.CONSUME(T.Combinator)
          $.SUBRULE($.complexSelector)
        }
      },
      {
        ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [inner, firstSelector] })
      }
    ])
  })

  $.OVERRIDE_RULE('simpleSelector', (inner: boolean = false) => {
    $.OR([
      {
        ALT: () => {
          $.isMixinCallCandidate &&= true
          $.isMixinDefinitionCandidate &&= true
          $.OR2([
            { ALT: () => $.SUBRULE($.classSelector) },
            { ALT: () => $.SUBRULE($.idSelector) },
            { ALT: () => $.CONSUME(T.InterpolatedSelector) },
            { ALT: () => $.CONSUME(T.Interpolated) }
          ])
        }
      },
      {
        ALT: () => {
          $.isMixinCallCandidate = false
          $.isMixinDefinitionCandidate = false
          $.OR3([
            /** Allow identifiers at rule starts */
            { ALT: () => $.CONSUME(T.Ident) },
            {
            /** In CSS Nesting, outer selector can't contain an ampersand */
              GATE: () => inner,
              ALT: () => $.CONSUME(T.Ampersand)
            },
            { ALT: () => $.CONSUME(T.Star) },
            { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [inner] }) },
            { ALT: () => $.SUBRULE($.attributeSelector) }
          ])
        }
      }
    ])
  })

  $.OVERRIDE_RULE('declarationList', () => {
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.innerAtRule)
          $.SUBRULE($.declarationList)
        }
      },
      {
        GATE: $.BACKTRACK($.testQualifiedRule),
        ALT: () => {
          $.SUBRULE($.qualifiedRule, { ARGS: [true] })
          $.SUBRULE2($.declarationList)
        }
      },
      /**
         * Declaration needs to be last, because in the
         * Less and Sass parsers, a qualifiedRule can
         * start with an Identifier also.
         */
      {
        ALT: () => {
          $.OPTION(() => $.SUBRULE($.declaration))
          $.OPTION2(() => {
            $.CONSUME(T.Semi)
            $.SUBRULE3($.declarationList)
          })
        }
      }
    ])
  })

  /**
   * We need this rule to succeed quickly if it starts with anything other than an identifier
   */
  $.RULE('testQualifiedRule', (inner: boolean = false) => {
    $.OR([
      { ALT: () => $.CONSUME(T.NonIdent) },
      {
        ALT: () => {
          /** Well, poop, now we have to look ahead for a '{' */
          $.CONSUME(T.Ident)
          $.MANY(() => $.SUBRULE($.anyOuterValue))
          $.CONSUME(T.LCurly)
        }
      }
    ])
  })

  /**
   * We need to list specific combinators,
   * because only one kind is allowed in a mixin call.
   */
  $.OVERRIDE_RULE('combinator', () => {
    $.OR([
      {
        ALT: () => {
          $.isMixinDefinitionCandidate = false
          $.isMixinCallCandidate &&= true
          $.OR2([
            {
              ALT: () => $.CONSUME(T.Gt)
            },
            /**
             * It's not truly empty - we check skipped tokens,
             * so this indicates at least 1 whitespace is present
             */
            {
              GATE: $.hasWS,
              ALT: EMPTY_ALT()
            }
          ])
        }
      },
      {
        ALT: () => {
          $.isMixinDefinitionCandidate = false
          $.isMixinCallCandidate = false
          $.OR3([
            { ALT: () => $.CONSUME(T.Plus) },
            { ALT: () => $.CONSUME(T.Tilde) },
            { ALT: () => $.CONSUME(T.Pipe) },
            { ALT: () => $.CONSUME(T.Column) }
          ])
        }
      }
    ])
  })

  $.OVERRIDE_RULE('compoundSelector', (inner?: boolean, firstSelector?: boolean) => {
    $.SUBRULE($.simpleSelector, { ARGS: [inner, firstSelector] })
    $.OR([
      {
        ALT: () => {
          /** If there are multiple selectors, it can't be a mixin definition */
          $.isMixinDefinitionCandidate = false
          $.MANY(() => $.SUBRULE2($.simpleSelector, { ARGS: [inner] }))
        }
      }
    ])
    $.OPTION({
      GATE: () => $.isMixinCallCandidate,
      DEF: () => {
        $.SUBRULE($.mixinCallArgs)
        $.OPTION2(() => {
          $.isMixinDefinitionCandidate = false
          $.SUBRULE($.accessors)
        })
      }
    })
    $.OPTION3(() => $.SUBRULE($.guard))
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

  $.OVERRIDE_RULE('mathValue', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mixinCallSequence) },
      {
        ALT: () => {
          $.CONSUME(T.AtKeyword)
          $.OPTION(() => $.SUBRULE($.accessors))
        }
      },
      { ALT: () => $.CONSUME(T.Color) },
      { ALT: () => $.CONSUME(T.String) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.MathConstant) },
      { ALT: () => $.SUBRULE($.identOrFunction) },
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
    $.SUBRULE($.guardOr)
  })

  /** 'or' expression */
  $.RULE('guardOr', (disallowComma: boolean = false) => {
    $.SUBRULE($.guardAnd)
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.Comma || !disallowComma,
      DEF: () => {
        /**
         * Nest expressions within expressions for correct
         * order of operations.
         */
        $.OR([
          { ALT: () => $.CONSUME($.T.Comma) },
          { ALT: () => $.CONSUME($.T.Or) }
        ])
        $.SUBRULE2($.guardAnd)
      }
    })
  })

  /**
   * 'and' and 'or' expressions
   *
   *  In Media queries level 4, you cannot have
   *  `([expr]) or ([expr]) and ([expr])` because
   *  of evaluation order ambiguity.
   *  However, Less allows it.
   */
  $.RULE('guardAnd', () => {
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => $.SUBRULE($.guardExpression)
    })
  })

  $.RULE('guardExpression', () => {
    $.OPTION(() => $.CONSUME($.T.Not))
    $.CONSUME(T.LParen)
    $.SUBRULE($.comparison)
    $.CONSUME(T.RParen)
  })

  /** Currently, Less only allows a single comparison expression */
  $.RULE('comparison', () => {
    $.isCompareExpression = true
    $.SUBRULE($.mathSum)
    $.OR([
      { ALT: () => $.CONSUME(T.Eq) },
      { ALT: () => $.CONSUME(T.Gt) },
      { ALT: () => $.CONSUME(T.GtEq) },
      { ALT: () => $.CONSUME(T.GtEqAlias) },
      { ALT: () => $.CONSUME(T.Lt) },
      { ALT: () => $.CONSUME(T.LtEq) },
      { ALT: () => $.CONSUME(T.LtEqAlias) }
    ])
    $.SUBRULE2($.mathSum)
    $.isCompareExpression = false
  })

  $.OVERRIDE_RULE('expression', () => {
    const isCompare = $.isCompareExpression
    $.OR([
      {
        GATE: () => !isCompare,
        ALT: () => $.SUBRULE($.mathSum)
      },
      {
        GATE: () => isCompare,
        ALT: () => $.SUBRULE($.comparison)
      }
    ])
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
  // $.RULE('mixinDefinition', () => {
  //   $.SUBRULE($.mixinName)
  //   $.CONSUME(T.LParen)
  //   $.OPTION(() => $.SUBRULE($.mixinArgList))
  //   $.CONSUME(T.RParen)
  //   $.OPTION2(() => $.SUBRULE($.guard))
  //   $.CONSUME(T.LCurly)
  //   $.SUBRULE($.declarationList)
  //   $.CONSUME(T.RCurly)
  // })

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
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.PropertyReference) },
      { ALT: () => $.CONSUME(T.Ident) }
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
  $.RULE('mixinArgList', () => {
    $.SUBRULE($.mixinArg)
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Comma) },
        { ALT: () => $.CONSUME(T.Semi) }
      ])
      $.SUBRULE2($.mixinArg)
    })
    $.OPTION(() => $.CONSUME2(T.Semi))
  })

  $.RULE('mixinArg', () => {
    const definition = $.isMixinDefinitionCandidate
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

  /**
   * Expland the recursive pattern to make sure we have semi-separators
   * after mixin calls.
   */
  // $.OVERRIDE_RULE('main', () => {
  //   $.OPTION(() => {
  //     $.OR([
  //       {
  //         ALT: () => {
  //           $.SUBRULE($.mixinDefinition)
  //           $.OPTION2(() => $.SUBRULE($.main))
  //         }
  //       },
  //       {
  //         ALT: () => {
  //           $.SUBRULE($.mixinCallSequence)
  //           /** This is very similar to declaration list parsing */
  //           $.OPTION3(() => {
  //             $.CONSUME(T.Semi)
  //             $.OPTION4(() => $.SUBRULE2($.main))
  //           })
  //         }
  //       },
  //       {
  //         ALT: () => {
  //           $.SUBRULE($.qualifiedRule)
  //           $.OPTION5(() => $.SUBRULE3($.main))
  //         }
  //       },
  //       {
  //         ALT: () => {
  //           $.SUBRULE($.atRule)
  //           $.OPTION6(() => $.SUBRULE4($.main))
  //         }
  //       }
  //     ])
  //   })
  // })

  // $.OVERRIDE_RULE('declarationList', () => {
  //   $.OR([
  //     {
  //       ALT: () => {
  //         $.SUBRULE($.mixinDefinition)
  //         $.OPTION(() => $.SUBRULE($.declarationList))
  //       }
  //     },
  //     {
  //       ALT: () => {
  //         $.OR2([
  //           { ALT: () => $.SUBRULE($.mixinCallSequence) },
  //           { ALT: () => $.OPTION2(() => $.SUBRULE($.declaration)) }
  //         ])
  //         $.OPTION3(() => {
  //           $.CONSUME(T.Semi)
  //           $.SUBRULE2($.declarationList)
  //         })
  //       }
  //     },
  //     {
  //       ALT: () => {
  //         $.SUBRULE($.innerAtRule)
  //         $.SUBRULE3($.declarationList)
  //       }
  //     },
  //     {
  //       ALT: () => {
  //         $.SUBRULE($.qualifiedRule, { ARGS: [true] })
  //         $.SUBRULE4($.declarationList)
  //       }
  //     }
  //   ])
  // })
}