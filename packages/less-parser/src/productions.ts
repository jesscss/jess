import type { LessParser, TokenMap, RuleContext } from './lessParser'
import { tokenMatcher } from 'chevrotain'

/** Extensions of the CSS language */
export function extendRoot(this: LessParser, T: TokenMap) {
  const $ = this

  const isEscapedString = () => {
    const next = $.LA(1)
    return tokenMatcher(next, T.QuoteStart) && next.image.startsWith('~')
  }

  $.OVERRIDE_RULE('main', () => {
    let needsSemi = false
    $.MANY({
      GATE: () => !needsSemi ||
        (needsSemi && (
          $.LA(1).tokenType === T.Semi ||
          $.LA(0).tokenType === T.Semi
        )),
      DEF: () => {
        $.OR([
          {
            ALT: () => {
              $.OR2([
                { ALT: () => $.SUBRULE($.mixinDefinition) },
                {
                  ALT: () => {
                    $.SUBRULE($.function)
                    $.CONSUME(T.Semi)
                  }
                },
                { ALT: () => $.SUBRULE($.qualifiedRule) },
                /** At-rules that don't have curly blocks must end in semi-colons according to CSS */
                { ALT: () => $.SUBRULE($.atRule) },
                { ALT: () => $.CONSUME2(T.Semi) }
              ])
              needsSemi = false
            }
          },
          {
            ALT: () => {
              $.SUBRULE($.mixinCall)
              needsSemi = true
            }
          }
        ])
      }
    })
  })

  $.OVERRIDE_RULE('declarationList', () => {
    let needsSemi = false
    $.MANY({
      GATE: () => !needsSemi ||
        (needsSemi && (
          $.LA(1).tokenType === T.Semi ||
          $.LA(0).tokenType === T.Semi
        )),
      DEF: () => {
        $.OR([
          {
            ALT: () => {
              $.OR2([
                { ALT: () => $.SUBRULE($.declaration) },
                { ALT: () => $.SUBRULE($.mixinCall) }
              ])
              needsSemi = true
            }
          },
          {
            ALT: () => {
              $.OR3([
                { ALT: () => $.SUBRULE($.mixinDefinition) },
                {
                  ALT: () => {
                    $.SUBRULE($.function)
                    $.CONSUME(T.Semi)
                  }
                },
                { ALT: () => $.SUBRULE($.innerAtRule) },
                { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ inner: true }] }) },
                { ALT: () => $.CONSUME2(T.Semi) }
              ])
              needsSemi = false
            }
          }
        ])
      }
    })
  })

  $.OVERRIDE_RULE('declaration', () => {
    $.OR([
      {
        ALT: () => {
          $.OR2([
            {
              ALT: () => $.CONSUME(T.Ident)
            },
            {
              GATE: () => $.legacyMode,
              ALT: () => $.CONSUME(T.LegacyPropIdent)
            }
          ])
          $.CONSUME(T.Assign)
          $.SUBRULE($.valueList)
          $.OPTION(() => {
            $.CONSUME(T.Important)
          })
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.CustomProperty)
          $.CONSUME2(T.Assign)
          $.MANY(() => $.SUBRULE($.customValue))
        }
      }
    ])
  })

  // $.OVERRIDE_RULE('mediaQuery', () => {
  //   $.OR([
  //     {
  //       /** Allow escaped strings */
  //       GATE: isEscapedString,
  //       ALT: () => $.SUBRULE($.string)
  //     },
  //     { ALT: () => $.CONSUME(T.AtKeyword) },
  //     { ALT: () => $.SUBRULE($.mediaCondition) },
  //     {
  //       ALT: () => {
  //         $.OPTION(() => {
  //           $.OR2([
  //             { ALT: () => $.CONSUME(T.Not) },
  //             { ALT: () => $.CONSUME(T.Only) }
  //           ])
  //         })
  //         $.SUBRULE($.mediaType)
  //         $.OPTION2(() => {
  //           $.CONSUME(T.And)
  //           $.SUBRULE($.mediaConditionWithoutOr)
  //         })
  //       }
  //     }
  //   ])
  // })

  $.OVERRIDE_RULE('mediaInParens', () => {
    $.OR([
      /**
       * It's up to the Less author to validate that this will produce
       * valid media queries.
       */
      {
        /** Allow escaped strings */
        GATE: isEscapedString,
        ALT: () => $.SUBRULE($.string)
      },
      { ALT: () => $.CONSUME(T.AtKeyword) },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.OR2([
            { ALT: () => $.SUBRULE($.mediaCondition) },
            { ALT: () => $.SUBRULE($.mediaFeature) }
          ])
          $.CONSUME(T.RParen)
        }
      },
      { ALT: () => $.SUBRULE($.generalEnclosed) }
    ])
  })

  $.OVERRIDE_RULE('mfValue', () => {
    /**
     * Like the original Less Parser, we're
     * going to allow any value expression,
     * and it's up to the Less author to know
     * if it's valid.
     */
    $.SUBRULE($.expression)
  })
}

// const getRuleContext = (ctx: RuleContext): RuleContext => ({
//   mixinCandidate: {
//     call: false,
//     definition: false
//   },
//   ...ctx
// })

export function extendSelectors(this: LessParser, T: TokenMap) {
  const $ = this

  $.OVERRIDE_RULE('qualifiedRule', (ctx: RuleContext = {}) => {
    ctx.qualifiedRule = true
    $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => $.SUBRULE($.selectorList, { ARGS: [ctx] })
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => {
          ctx.firstSelector = true
          $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] })
        }
      }
    ])

    $.OR2([
      {
        /** :extend at the end of a qualified rule */
        GATE: () => !!ctx.hasExtend,
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
  })

  $.OVERRIDE_RULE('complexSelector', (ctx: RuleContext = {}) => {
    $.SUBRULE($.compoundSelector, { ARGS: [ctx] })
    $.MANY(() => {
      $.SUBRULE($.combinator)
      $.SUBRULE2($.compoundSelector, { ARGS: [{ ...ctx, firstSelector: false }] })
    })
    $.OPTION(() => {
      $.OR([
        { ALT: () => $.SUBRULE($.guard) },
        {
          GATE: () => !!ctx.qualifiedRule,
          ALT: () => $.SUBRULE($.extend, { ARGS: [ctx] })
        }
      ])
    })
  })

  $.RULE('extend', (ctx: RuleContext = {}) => {
    ctx.hasExtend = true
    $.CONSUME(T.Extend)
    $.SUBRULE($.selectorList)
    $.OPTION(() => $.CONSUME(T.All))
    $.CONSUME(T.RParen)
  })

  // $.OVERRIDE_RULE('relativeSelector', (ctx: RuleContext = {}) => {
  //   $.OR([
  //     {
  //       ALT: () => {
  //         ctx.isMixinCallCandidate = false
  //         ctx.isMixinCallCandidate = false
  //         ctx.isMixinDefinitionCandidate = false
  //         $.CONSUME(T.Combinator)
  //         $.SUBRULE($.complexSelector)
  //       }
  //     },
  //     {
  //       ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
  //     }
  //   ])
  // })

  $.OVERRIDE_RULE('simpleSelector', (ctx: RuleContext = {}) => {
    $.OR([
      {
        /** In Less/Sass, the first selector can be an identifier */
        // GATE: () => !ctx.firstSelector,
        ALT: () => $.CONSUME(T.Ident)
      },
      {
        /**
         * Unlike CSS Nesting, Less allows outer qualified rules
         * to have `&`, and it is just silently absorbed if there
         * is no parent selector.
         */
        ALT: () => $.CONSUME(T.Ampersand)
      },
      { ALT: () => $.SUBRULE($.classSelector) },
      { ALT: () => $.SUBRULE($.idSelector) },
      { ALT: () => $.CONSUME(T.Star) },
      { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.attributeSelector) }
    ])
  })

  /**
   * We need this rule to succeed quickly if it starts with anything other
   * than an identifier. We also parse very loosely, so that we can
   * establish author intent, and that way we can throw qualified-rule-specific
   * errors when parsing.
   */
  $.RULE('testQualifiedRule', () => {
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
}

export function atVariableDeclarations(this: LessParser, T: TokenMap) {
  const $ = this

  /** Starts with a colon, followed by white space */
  const isVariableLike = () => $.LA(1).tokenType === T.Colon && $.skippedTokens.has($.currIdx + 1)

  /** Doesn't start with a colon or DOES, but it is NOT followed by a space */
  const isNotVariableLike = () => $.LA(1).tokenType !== T.Colon || !$.skippedTokens.has($.currIdx + 1)

  $.RULE('anonymousMixinDefinition', () => {
    $.OPTION(() => {
      $.CONSUME(T.AnonMixinStart)
      $.SUBRULE($.mixinArgList, { ARGS: [{ isDefinition: true }] })
      $.CONSUME(T.RParen)
    })
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  /** Less variables */
  $.OVERRIDE_RULE('unknownAtRule', () => {
    $.CONSUME(T.AtKeyword)
    $.OR([
      {
        /**
         * This is a variable declaration
         * Disallows `@atrule :foo;` because it resembles a pseudo-selector
         */
        GATE: isVariableLike,
        ALT: () => {
          $.CONSUME(T.Colon)
          $.OR2([
            {
              ALT: () => {
                $.SUBRULE($.anonymousMixinDefinition)
                $.OPTION2(() => $.CONSUME(T.Semi))
              }
            },
            {
              ALT: () => {
                $.SUBRULE($.valueList)
                $.CONSUME2(T.Semi)
              }
            }
          ])
        }
      },
      /** This is a variable call */
      {
        GATE: () => $.noSep() && $.LA(1).tokenType === T.LParen,
        /**
         * This is a change from Less 1.x-4.x
         * e.g.
         * ```
         * @dr: #(@var1, @var2) {
         *   // ...
         * }
         * @dr(arg1, arg2);
         */
        ALT: () => $.SUBRULE($.mixinArgs)
      },
      /** Just a regular unknown at-rule */
      {
        GATE: isNotVariableLike,
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

export function expressionsAndValues(this: LessParser, T: TokenMap) {
  const $ = this

  $.OVERRIDE_RULE('valueSequence', (ctx: RuleContext = {}) => {
    $.OR([
      {
        GATE: () => $.loose,
        ALT: () => { $.MANY(() => $.SUBRULE($.expression, { ARGS: [ctx] })) }
      },
      {
        GATE: () => !$.loose,
        /** @todo - create warning in the CST Visitor */
        ALT: () => { $.AT_LEAST_ONE(() => $.SUBRULE2($.expression, { ARGS: [ctx] })) }
      }
    ])
  })

  /**
   * In CSS, would be a single value.
   * In Less, these are math expressions which
   * represent a single value. During AST construction,
   * these will be grouped by order of operations.
   */
  $.RULE('expression', (ctx: RuleContext = {}) => {
    $.SUBRULE($.expressionValue, { LABEL: 'L', ARGS: [ctx] })
    $.MANY({
      /**
       * What this GATE does. We need to dis-ambiguate
       * 1 -1 (a value sequence) from 1-1 (a Less expression),
       * so Less is white-space sensitive here.
       */
      GATE: () => {
        const next = $.LA(1)
        const nextType = next.tokenType
        return (
          nextType === T.Plus ||
          nextType === T.Minus ||
          nextType === T.Divide ||
          nextType === T.Star
        ) || ($.noSep() && tokenMatcher(next, T.Signed))
      },
      DEF: () => {
        $.OR([
          {
            ALT: () => {
              $.OR2([
                { ALT: () => $.CONSUME(T.Plus) },
                { ALT: () => $.CONSUME(T.Minus) },
                { ALT: () => $.CONSUME(T.Star) },
                { ALT: () => $.CONSUME(T.Divide) }
              ])
              $.SUBRULE2($.expressionValue, { LABEL: 'R', ARGS: [ctx] })
            }
          },
          /** This will be interpreted by Less as a complete expression */
          { ALT: () => $.CONSUME(T.Signed) }
        ])
      }
    })
  })

  $.RULE('expressionValue', (ctx: RuleContext = {}) => {
    $.OR([
      {
        ALT: () => {
          /** Can create a negative expression */
          $.OPTION(() => $.CONSUME(T.Minus))
          $.CONSUME(T.LParen)
          $.SUBRULE($.expression, { ARGS: [ctx] })
          $.CONSUME(T.RParen)
        }
      },
      { ALT: () => $.SUBRULE($.value, { ARGS: [ctx] }) }
    ])
  })

  $.OVERRIDE_RULE('function', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.knownFunctions) },
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OR2([{
            GATE: $.noSep,
            ALT: () => {
              $.CONSUME(T.LParen)
              $.SUBRULE($.functionValueList)
              $.CONSUME(T.RParen)
            }
          }])
        }
      }
    ])
  })

  $.RULE('functionValueList', (ctx: RuleContext = {}) => {
    ctx.allowsAnonymousMixins = true
    $.SUBRULE($.valueSequence, { ARGS: [ctx] })
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Comma) },
        { ALT: () => $.CONSUME(T.Semi) }
      ])
      $.SUBRULE2($.valueSequence, { ARGS: [ctx] })
    })
  })

  $.OVERRIDE_RULE('value', (ctx: RuleContext = {}) => {
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        /** Function should appear before Ident */
        { ALT: () => $.SUBRULE($.function) },
        { ALT: () => $.SUBRULE($.mixinCallLookup) },
        {
          GATE: () => !!ctx.allowsAnonymousMixins,
          ALT: () => $.SUBRULE($.anonymousMixinDefinition)
        },
        {
          ALT: () => {
            $.CONSUME(T.AtKeyword)
            $.OPTION(() => $.SUBRULE($.accessors))
          }
        },
        { ALT: () => $.SUBRULE($.string) },
        { ALT: () => $.CONSUME(T.Value) },
        {
          ALT: () => {
            $.CONSUME(T.LSquare)
            $.CONSUME2(T.Ident)
            $.CONSUME(T.RSquare)
          }
        },
        {
          /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
          GATE: () => $.legacyMode,
          ALT: () => $.CONSUME(T.LegacyMSFilter)
        }
      ]
    })
  })

  $.OVERRIDE_RULE('mathValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.SUBRULE($.function) },
      {
        /** Only allow escaped strings in calc */
        GATE: () => $.LA(1).image.startsWith('~'),
        ALT: () => $.SUBRULE($.string)
      },
      {
        /** For some reason, e() goes here instead of $.function */
        GATE: () => $.LA(2).tokenType !== T.LParen,
        ALT: () => $.CONSUME(T.MathConstant)
      },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.SUBRULE($.mathSum)
          $.CONSUME(T.RParen)
        }
      }
    ])
  })

  /** @todo - add interpolation */
  // $.OVERRIDE_RULE('string', () => {
  //   $.OR([
  //     {
  //       ALT: () => {
  //         $.CONSUME(T.SingleQuoteStart)
  //         $.OPTION(() => $.CONSUME(T.SingleQuoteStringContents))
  //         $.CONSUME(T.SingleQuoteEnd)
  //       }
  //     },
  //     {
  //       ALT: () => {
  //         $.CONSUME(T.DoubleQuoteStart)
  //         $.OPTION2(() => $.CONSUME(T.DoubleQuoteStringContents))
  //         $.CONSUME(T.DoubleQuoteEnd)
  //       }
  //     }
  //   ])
  // })
}

export function guards(this: LessParser, T: TokenMap) {
  const $ = this

  $.RULE('guard', () => {
    $.CONSUME(T.When)
    $.SUBRULE($.guardOr, { ARGS: [true] })
  })

  /**
   * 'or' expression
   * Allows an (outer) comma like historical media queries
   */
  $.RULE('guardOr', (allowComma: boolean = false) => {
    $.SUBRULE($.guardAnd)
    $.MANY({
      GATE: () => allowComma || $.LA(1).tokenType !== T.Comma,
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
      DEF: () => {
        $.OPTION(() => $.CONSUME(T.Not))
        $.SUBRULE($.guardInParens)
      }
    })
  })

  $.RULE('guardInParens', () => {
    $.CONSUME(T.LParen)
    $.OR([
      { ALT: () => $.SUBRULE($.guardOr) },
      { ALT: () => $.SUBRULE($.comparison) }
    ])
    $.CONSUME(T.RParen)
  })

  /** Currently, Less only allows a single comparison expression */
  $.RULE('comparison', () => {
    $.SUBRULE($.valueList, { LABEL: 'L' })
    $.OPTION(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.Gt) },
        { ALT: () => $.CONSUME(T.GtEq) },
        { ALT: () => $.CONSUME(T.GtEqAlias) },
        { ALT: () => $.CONSUME(T.Lt) },
        { ALT: () => $.CONSUME(T.LtEq) },
        { ALT: () => $.CONSUME(T.LtEqAlias) }
      ])
      $.SUBRULE2($.valueList, { LABEL: 'R' })
    })
  })
}

export function atRuleBubbling(this: LessParser, T: TokenMap) {
  const $ = this

  /**
   * Less (perhaps unwisely) allows bubling of normally document-root
   * at-rules, so we need to override CSS here.
   */
  $.OVERRIDE_RULE('innerAtRule', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.pageAtRule) },
      { ALT: () => $.SUBRULE($.fontFaceAtRule) },
      { ALT: () => $.SUBRULE($.nestedAtRule) },
      { ALT: () => $.SUBRULE($.nonNestedAtRule) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  })
}

export function mixinsAndNamespaces(this: LessParser, T: TokenMap) {
  const $ = this

  /** e.g. .mixin, #mixin */
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
  $.RULE('mixinCall', () => {
    $.SUBRULE($.mixinName)
    $.MANY(() => {
      $.OPTION(() => $.CONSUME(T.Gt))
      $.SUBRULE2($.mixinName)
    })

    /** Either needs to end in parens or in a semi-colon (or both) */
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.mixinArgs)
          $.OPTION2(() => $.CONSUME(T.Semi))
        }
      },
      { ALT: () => $.CONSUME2(T.Semi) }
    ])
  })

  /** Used within a value */
  $.RULE('mixinCallLookup', () => {
    $.SUBRULE($.mixinName)
    $.MANY(() => {
      $.OPTION(() => $.CONSUME(T.Gt))
      $.SUBRULE2($.mixinName)
    })
    $.OPTION2(() => $.SUBRULE($.mixinArgs))
    $.SUBRULE($.accessors)
  })

  $.RULE('mixinDefinition', () => {
    $.SUBRULE($.mixinName)
    $.SUBRULE($.mixinArgs, { ARGS: [{ isDefinition: true }] })
    $.OPTION(() => $.SUBRULE($.guard))
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  $.RULE('mixinArgs', (ctx: RuleContext = {}) => {
    $.CONSUME(T.LParen)
    $.OPTION(() => $.SUBRULE($.mixinArgList, { ARGS: [ctx] }))
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
        { ALT: () => $.SUBRULE($.mixinCallLookup) },
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
  $.RULE('mixinArgList', (ctx: RuleContext = {}) => {
    $.SUBRULE($.mixinArg, { ARGS: [ctx] })
    $.MANY(() => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.Comma)
            $.SUBRULE2($.mixinArg, { ARGS: [ctx] })
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.Semi)
            $.OPTION(() => $.SUBRULE3($.mixinArg, { ARGS: [ctx] }))
          }
        }
      ])
    })
  })

  $.RULE('mixinArg', (ctx: RuleContext = {}) => {
    const definition = !!ctx.isDefinition
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.AtKeyword)
          $.OPTION(() => {
            $.OR2([
              {
                ALT: () => {
                  $.CONSUME(T.Colon)
                  $.SUBRULE($.mixinValue)
                }
              },
              {
                GATE: () => definition,
                ALT: () => $.CONSUME(T.Ellipsis)
              }
            ])
          })
        }
      },
      { ALT: () => $.SUBRULE2($.mixinValue) },
      {
        GATE: () => definition,
        ALT: () => $.CONSUME2(T.Ellipsis)
      }
    ])
  })

  $.RULE('mixinValue', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.SUBRULE($.declarationList)
          $.CONSUME(T.RCurly)
        }
      },
      { ALT: () => $.SUBRULE($.valueSequence) }
    ])
  })
}