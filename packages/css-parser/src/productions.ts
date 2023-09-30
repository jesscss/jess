import type { CssCstParser, TokenMap, RuleContext } from './cssCstParser'
import { EMPTY_ALT } from 'chevrotain'

export function productions(this: CssCstParser, T: TokenMap) {
  const $ = this

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  $.RULE('stylesheet', () => {
    $.OPTION(() => {
      $.CONSUME(T.Charset)
    })
    $.SUBRULE($.main)
  })

  // main
  //   : (WS
  //     | qualifiedRule
  //     | atRule
  //   )*
  //   ;
  $.RULE('main', () => {
    $.MANY(() => {
      $.OR([
        { ALT: () => $.SUBRULE($.qualifiedRule) },
        { ALT: () => $.SUBRULE($.atRule) }
      ])
    })
  })

  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  $.RULE('qualifiedRule', (ctx: RuleContext = {}) => {
    $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => $.SUBRULE($.selectorList, { ARGS: [{ ...ctx, qualifiedRule: true }] })
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [{ ...ctx, firstSelector: true, qualifiedRule: true }] })
      }
    ])

    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  /** * SELECTORS ***/
  /** @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors  */
  /**
      A selector with a single component, such as a single id selector
      or type selector, that's not used in combination with or contains
      any other selector component or combinator
        .e.g `a` | `#selected` | `.foo`

      @todo Define known pseudos

      NOTE: A COLOR_IDENT_START token is a valid ID
    */
  // simpleSelector
  //   : classSelector
  //   | ID
  //   | COLOR_IDENT_START
  //   | identifier
  //   | AMPERSAND
  //   | STAR
  //   | pseudoSelector
  //   | attributeSelector
  //   ;
  $.RULE('simpleSelector', (ctx: RuleContext = {}) => {
    $.OR([
      {
        /** In CSS Nesting, the first selector cannot be an identifier */
        GATE: () => !ctx.firstSelector,
        ALT: () => $.CONSUME(T.Ident)
      },
      {
        /** In CSS Nesting, outer selector can't contain an ampersand */
        GATE: () => !!ctx.inner,
        ALT: () => $.CONSUME(T.Ampersand)
      },
      { ALT: () => $.SUBRULE($.classSelector) },
      { ALT: () => $.SUBRULE($.idSelector) },
      { ALT: () => $.CONSUME(T.Star) },
      { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.attributeSelector) }
    ])
  })

  // classSelector
  //   : DOT identifier
  //   ;
  $.RULE('classSelector', () => {
    $.CONSUME(T.DotName)
  })

  /** #id, #FF0000 are both valid ids */
  $.RULE('idSelector', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.HashName) },
      { ALT: () => $.CONSUME(T.ColorIdentStart) }
    ])
  })

  // pseudoSelector
  //   : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
  //   | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
  //   | COLON COLON? identifier ('(' anyInnerValue* ')')?
  //   ;
  $.RULE('pseudoSelector', (ctx: RuleContext = {}) => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.NthPseudoClass)
          $.SUBRULE($.nthValue)
          $.CONSUME(T.RParen)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.SelectorPseudoClass)
          $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] })
          $.CONSUME2(T.RParen)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Colon)
          $.OPTION({
            GATE: $.noSep,
            DEF: () => {
              $.CONSUME2(T.Colon)
            }
          })
          $.OR4([
            {
              GATE: $.noSep,
              ALT: () => {
                $.CONSUME(T.Ident)
                $.OPTION2(() => {
                  $.CONSUME(T.LParen)
                  $.MANY(() => $.SUBRULE($.anyInnerValue))
                  $.CONSUME3(T.RParen)
                })
              }
            }
          ])
        }
      }
    ])
  })

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  $.RULE('nthValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.NthOdd) },
      { ALT: () => $.CONSUME(T.NthEven) },
      { ALT: () => $.CONSUME(T.Integer) },
      {
        ALT: () => {
          $.OR2([
            { ALT: () => $.CONSUME(T.NthDimension) },
            { ALT: () => $.CONSUME(T.NthDimensionSigned) }
          ])
          $.OPTION(() => {
            $.OR3([
              { ALT: () => $.CONSUME(T.SignedInt) },
              {
                ALT: () => {
                  $.CONSUME(T.Minus)
                  $.CONSUME(T.UnsignedInt)
                }
              }
            ])
          })
          $.OPTION2(() => {
            $.CONSUME(T.Of)
            $.SUBRULE($.complexSelector)
          })
        }
      }
    ])
  })

  // attributeSelector
  //   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE
  //   ;
  $.RULE('attributeSelector', () => {
    $.CONSUME(T.LSquare)
    $.CONSUME(T.Ident)
    $.OPTION(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.AttrMatch) }
      ])
      $.OR2([
        { ALT: () => $.CONSUME2(T.Ident) },
        { ALT: () => $.SUBRULE($.string) }
      ])
    })
    $.OPTION2(() => {
      $.CONSUME(T.AttrFlag)
    })
    $.CONSUME(T.RSquare)
  })

  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  $.RULE('compoundSelector', (ctx: RuleContext = {}) => {
    $.SUBRULE($.simpleSelector, { ARGS: [ctx] })
    $.MANY(() => $.SUBRULE2($.simpleSelector, { ARGS: [{ ...ctx, firstSelector: false }] }))
  })

  /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
  // complexSelector
  //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  //   ;
  $.RULE('complexSelector', (ctx: RuleContext = {}) => {
    $.SUBRULE($.compoundSelector, { ARGS: [ctx] })
    $.MANY(() => {
      $.SUBRULE($.combinator)
      $.SUBRULE2($.compoundSelector, { ARGS: [{ ...ctx, firstSelector: false }] })
    })
  })

  /** We must have a combinator of some kind between compound selectors */
  $.RULE('combinator', () => {
    $.OR([
      {
        ALT: () => $.CONSUME(T.Combinator)
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
  })

  /**
      A selector representing an element relative to one or more
      anchor elements preceded by a combinator.
        e.g. + div#topic > #reference
    */
  // relativeSelector
  //   : (combinator WS*)? complexSelector
  //   ;
  $.RULE('relativeSelector', (ctx: RuleContext = {}) => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Combinator)
          $.SUBRULE($.complexSelector, { ARGS: [{ ...ctx, firstSelector: false }] })
        }
      },
      {
        ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
      }
    ])
  })

  /**
      https://www.w3.org/TR/css-nesting-1/

      NOTE: implementers should throw a parsing
      error if the selectorlist starts with an identifier
    */
  // forgivingSelectorList
  //   : relativeSelector (WS* COMMA WS* relativeSelector)*
  //   ;
  $.RULE('forgivingSelectorList', (ctx: RuleContext = {}) => {
    $.SUBRULE($.relativeSelector, { ARGS: [ctx] })
    $.MANY(() => {
      $.CONSUME(T.Comma)
      $.SUBRULE2($.relativeSelector, { ARGS: [{ ...ctx, firstSelector: false }] })
    })
  })

  // selectorList
  //   : complexSelector (WS* COMMA WS* complexSelector)*
  //   ;
  $.RULE('selectorList', (ctx: RuleContext = {}) => {
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => $.SUBRULE($.complexSelector, { ARGS: [ctx] })
    })
  })

  /** * Declarations ***/
  // https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
  // declarationList
  //   : WS* (
  //     declaration? (WS* SEMI declarationList)*
  //     | innerAtRule declarationList
  //     | innerQualifiedRule declarationList
  //   )
  //   ;
  /**
   * Originally this was structured much like the CSS spec,
   * like this:
   *  $.OPTION(() => $.SUBRULE($.declaration))
   *  $.OPTION2(() => {
   *     $.CONSUME(T.Semi)
   *     $.SUBRULE3($.declarationList)
   *   })
   * ...but chevrotain-allstar doesn't deal well with
   * recursivity, as it predicts the ENTIRE path for
   * each alt
   */
  $.RULE('declarationList', () => {
    let needsSemi = false
    $.MANY({
      GATE: () => !needsSemi || (needsSemi && $.LA(1).tokenType === T.Semi),
      DEF: () => {
        $.OR([
          {
            ALT: () => {
              $.SUBRULE($.declaration)
              needsSemi = true
            }
          },
          {
            ALT: () => {
              $.OR2([
                { ALT: () => $.SUBRULE($.innerAtRule) },
                { ALT: () => $.SUBRULE2($.qualifiedRule, { ARGS: [{ inner: true }] }) },
                { ALT: () => $.CONSUME(T.Semi) }
              ])
              needsSemi = false
            }
          }
        ])
      }
    })
  })

  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  $.RULE('declaration', () => {
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

  /**
     * @todo - This could be implemented with a multi-mode lexer?
     * Multi-modes was the right way to do it with Antlr, but
     * Chevrotain does not support recursive tokens very well.
     */
  $.RULE('customValue', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.customBlock) }
    ])
  })

  /** Can also have semi-colons */
  $.RULE('innerCustomValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.Semi) },
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.customBlock) }
    ])
  })

  /**
     * Extra tokens in a custom property or general enclosed. Should include any
     * and every token possible (except semis), including unknown tokens.
     */
  $.RULE('extraTokens', () =>
    $.OR([
      { ALT: () => $.SUBRULE($.knownFunctions) },
      { ALT: () => $.CONSUME(T.Value) },
      { ALT: () => $.CONSUME(T.CustomProperty) },
      { ALT: () => $.CONSUME(T.Colon) },
      { ALT: () => $.CONSUME(T.AtName) },
      { ALT: () => $.CONSUME(T.Comma) },
      { ALT: () => $.CONSUME(T.Important) },
      { ALT: () => $.CONSUME(T.Unknown) }
    ])
  )

  $.RULE('customBlock', () => {
    $.OR([
      {
        ALT: () => {
          $.OR2([
            /**
               * All tokens that have a left parentheses.
               * These need to match a right parentheses.
               */
            { ALT: () => $.CONSUME(T.LParen) },
            { ALT: () => $.CONSUME(T.Function) },
            { ALT: () => $.CONSUME(T.FunctionalPseudoClass) }
          ])
          $.MANY(() => $.SUBRULE($.innerCustomValue))
          $.CONSUME(T.RParen)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.LSquare)
          $.MANY2(() => $.SUBRULE2($.innerCustomValue))
          $.CONSUME(T.RSquare)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.MANY3(() => $.SUBRULE3($.innerCustomValue))
          $.CONSUME(T.RCurly)
        }
      }
    ])
  })

  /** Values separated by commas or slashes */
  // valueList
  //   : value+ ((',' | '/') value+)*
  //   ;
  $.RULE('valueList', (ctx: RuleContext = {}) => {
    $.SUBRULE($.valueSequence, { ARGS: [ctx] })
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Comma) },
        { ALT: () => $.CONSUME(T.Slash) }
      ])
      $.SUBRULE2($.valueSequence, { ARGS: [ctx] })
    })
  })

  /** Often space-separated */
  $.RULE('valueSequence', (ctx: RuleContext = {}) => {
    $.AT_LEAST_ONE(() => $.SUBRULE($.value, { ARGS: [ctx] }))
  })

  // value
  //   : WS
  //   | identifier
  //   | integer
  //   | number
  //   | dimension
  //   | COLOR_IDENT_START
  //   | COLOR_INT_START
  //   | STRING
  //   | function
  //   | '[' identifier ']'
  //   | unknownValue
  //   ;
  $.RULE('value', (ctx: RuleContext = {}) => {
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        /** Function should appear before Ident */
        { ALT: () => $.SUBRULE($.function) },
        { ALT: () => $.CONSUME(T.Ident) },
        { ALT: () => $.CONSUME(T.Dimension) },
        { ALT: () => $.CONSUME(T.Number) },
        { ALT: () => $.CONSUME(T.Color) },
        { ALT: () => $.SUBRULE($.string) },
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

  $.RULE('string', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.SingleQuoteStart)
          $.OPTION(() => $.CONSUME(T.SingleQuoteStringContents))
          $.CONSUME(T.SingleQuoteEnd)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.DoubleQuoteStart)
          $.OPTION2(() => $.CONSUME(T.DoubleQuoteStringContents))
          $.CONSUME(T.DoubleQuoteEnd)
        }
      }
    ])
  })

  /** Implementers can decide to throw errors or warnings or not */
  // unknownValue
  //   : COLON
  //   | EQ
  //   | DOT
  //   | ID
  //   | UNKNOWN
  //   | AT_RULE
  //   ;
  $.RULE('unknownValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.Colon) },
      { ALT: () => $.CONSUME(T.Eq) },
      { ALT: () => $.CONSUME(T.DotName) },
      { ALT: () => $.CONSUME(T.HashName) },
      { ALT: () => $.CONSUME(T.Unknown) },
      { ALT: () => $.CONSUME(T.AtName) }
    ])
  })

  /** Abstracted for easy over-ride */
  // $.RULE('expression', () => {
  //   $.SUBRULE($.mathSum)
  // })

  // mathSum
  //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  //   ;
  $.RULE('mathSum', () => {
    $.SUBRULE($.mathProduct)
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Plus) },
        { ALT: () => $.CONSUME(T.Minus) }
      ])
      $.SUBRULE2($.mathProduct)
    })
  })

  // mathProduct
  //   : mathValue (WS* ('*' | '/') WS* mathValue)*
  //   ;
  $.RULE('mathProduct', () => {
    $.SUBRULE($.mathValue)
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Star) },
        { ALT: () => $.CONSUME(T.Divide) }
      ])
      $.SUBRULE2($.mathValue)
    })
  })

  // mathValue
  //   : number
  //   | dimension
  //   | percentage
  //   | mathConstant
  //   | '(' WS* mathSum WS* ')'
  //   ;
  $.RULE('mathValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.MathConstant) },
      { ALT: () => $.SUBRULE($.knownFunctions) },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.SUBRULE($.mathSum)
          $.CONSUME(T.RParen)
        }
      }
    ])
  })

  // function
  //   : URL_FUNCTION
  //   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
  //   | CALC_FUNCTION '(' WS* mathSum WS* ')'
  //   | identifier '(' valueList ')'
  //   ;
  // These have special parsing rules
  $.RULE('knownFunctions', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.varFunction) },
      { ALT: () => $.SUBRULE($.calcFunction) }
    ])
  })

  $.RULE('varFunction', () => {
    $.CONSUME(T.Var)
    $.CONSUME(T.CustomProperty)
    $.OPTION(() => {
      $.CONSUME(T.Comma)
      $.SUBRULE($.valueList)
    })
    $.CONSUME(T.RParen)
  })

  $.RULE('calcFunction', () => {
    $.CONSUME(T.Calc)
    $.SUBRULE($.mathSum)
    $.CONSUME2(T.RParen)
  })

  $.RULE('urlFunction', () => {
    $.CONSUME(T.UrlStart)
    $.OR([
      { ALT: () => $.SUBRULE($.string) },
      { ALT: () => $.CONSUME(T.NonQuotedUrl) }
    ])
    $.CONSUME(T.UrlEnd)
  })

  /**
      All At-rules according to spec are supposed to end with either
      a semi-colon or a curly-braced block. Some pre-processors
      (like PostCSS) allow the semi-colon to be optional, so we also
      allow it and insert it if it's missing.
    */
  // atRule
  //   : importAtRule
  //   | mediaAtRule
  //   | unknownAtRule
  //   | pageAtRule
  //   | fontFaceAtRule
  //   | supportsAtRule
  //   ;
  $.RULE('atRule', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.importAtRule) },
      { ALT: () => $.SUBRULE($.mediaAtRule) },
      { ALT: () => $.SUBRULE($.pageAtRule) },
      { ALT: () => $.SUBRULE($.fontFaceAtRule) },
      { ALT: () => $.SUBRULE($.supportsAtRule) },
      { ALT: () => $.SUBRULE($.nestedAtRule) },
      { ALT: () => $.SUBRULE($.nonNestedAtRule) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  })

  /**
      Inner rules are mostly the same except they have a declarationList
      instead of a main block within {}
      @todo - Add `@container` `@layer` `@scope`
    */
  // innerAtRule
  //   : innerMediaAtRule
  //   | unknownAtRule
  //   ;
  $.RULE('innerAtRule', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  })

  /**
     * @see https://www.w3.org/TR/css-nesting-1/#conditionals
     */
  $.RULE('atRuleBody', (inner: boolean = false) => {
    $.OR([
      {
        GATE: () => !inner,
        ALT: () => $.SUBRULE($.main)
      },
      {
        GATE: () => inner,
        ALT: () => $.SUBRULE($.declarationList)
      }
    ])
  })

  // mediaAtRule
  //   : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
  //   ;
  $.RULE('mediaAtRule', (inner?: boolean) => {
    $.CONSUME(T.AtMedia)
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => $.SUBRULE($.mediaQuery)
    })
    $.CONSUME(T.LCurly)
    $.SUBRULE($.atRuleBody, { ARGS: [inner] })
    $.CONSUME(T.RCurly)
  })

  /**
     * @see https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
     * Note, some of the spec had to be re-written for less ambiguity.
     * However, this is a spec-compliant implementation.
     */
  // mediaQuery
  //   : mediaCondition
  //   | ((NOT | ONLY) WS*)? mediaType (WS* AND WS* mediaConditionWithoutOr)?
  //   ;
  $.RULE('mediaQuery', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaCondition) },
      {
        ALT: () => {
          $.OPTION(() => {
            $.OR2([
              { ALT: () => $.CONSUME(T.Not) },
              { ALT: () => $.CONSUME(T.Only) }
            ])
          })
          $.SUBRULE($.mediaType)
          $.OPTION2(() => {
            $.CONSUME(T.And)
            $.SUBRULE($.mediaConditionWithoutOr)
          })
        }
      }
    ])
  })

  /** Doesn't include only, not, and, or, layer */
  // mediaType
  //   : IDENT
  //   | SCREEN
  //   | PRINT
  //   | ALL
  //   ;
  $.RULE('mediaType', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.PlainIdent) },
      { ALT: () => $.CONSUME(T.Screen) },
      { ALT: () => $.CONSUME(T.Print) },
      { ALT: () => $.CONSUME(T.All) }
    ])
  })

  // mediaCondition
  //   : mediaNot | mediaInParens ( WS* (mediaAnd* | mediaOr* ))
  //   ;
  $.RULE('mediaCondition', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaNot) },
      {
        ALT: () => {
          $.SUBRULE($.mediaInParens)
          $.MANY(() => {
            $.OR2([
              { ALT: () => { $.SUBRULE($.mediaAnd) } },
              { ALT: () => { $.SUBRULE($.mediaOr) } }
            ])
          })
        }
      }
    ])
  })

  // mediaConditionWithoutOr
  //   : mediaNot | mediaInParens (WS* mediaAnd)*
  //   ;
  $.RULE('mediaConditionWithoutOr', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaNot) },
      {
        ALT: () => {
          $.SUBRULE($.mediaInParens)
          $.MANY(() => $.SUBRULE($.mediaAnd))
        }
      }
    ])
  })

  // mediaNot
  //   : NOT WS* mediaInParens
  //   ;
  $.RULE('mediaNot', () => {
    $.CONSUME(T.Not)
    $.SUBRULE($.mediaInParens)
  })

  // mediaAnd
  //   : AND WS* mediaInParens
  //   ;
  $.RULE('mediaAnd', () => {
    $.CONSUME(T.And)
    $.SUBRULE($.mediaInParens)
  })

  // mediaOr
  //   : OR WS* mediaInParens
  //   ;
  $.RULE('mediaOr', () => {
    $.CONSUME(T.Or)
    $.SUBRULE($.mediaInParens)
  })

  // mediaInParens
  //   : '(' WS* (mediaCondition | mediaFeature) WS* ')'
  //   | generalEnclosed
  //   ;
  $.RULE('mediaInParens', () => {
    $.OR([
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

  /**
      An identifier is a legal value, so it can be
      ambiguous which side of the expression we're on
      while parsing. The browser figures this out
      post-parsing.
    */
  // mediaFeature
  // : identifier (WS* (
  //   COLON WS* mfValue
  //   | mediaRange
  //   | mfComparison WS* mfNonIdentifierValue
  // ))?
  // | mfNonIdentifierValue WS* (
  //   mfComparison WS* identifier
  //   | mediaRange
  // )
  // ;
  $.RULE('mediaFeature', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $.OR2([
              {
                ALT: () => {
                  $.CONSUME(T.Colon)
                  $.SUBRULE($.mfValue)
                }
              },
              { ALT: () => $.SUBRULE($.mediaRange) },
              {
                ALT: () => {
                  $.SUBRULE($.mfComparison)
                  $.SUBRULE($.mfNonIdentifierValue)
                }
              }
            ])
          })
        }
      },
      {
        ALT: () => {
          $.SUBRULE2($.mfNonIdentifierValue)
          $.OR3([
            {
              ALT: () => {
                $.SUBRULE2($.mfComparison)
                $.CONSUME2(T.Ident)
              }
            },
            { ALT: () => $.SUBRULE2($.mediaRange) }
          ])
        }
      }
    ])
  })

  /**
     * @note Both comparison operators have to match.
     */
  // mediaRange
  //   : mfLt WS* identifier (WS* mfLt WS* mfValue)?
  //   | mfGt WS* identifier (WS* mfGt WS* mfValue)?
  //   ;
  $.RULE('mediaRange', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Lt, { LABEL: 'L' })
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $.CONSUME2(T.Lt, { LABEL: 'R' })
            $.SUBRULE($.mfValue)
          })
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Gt, { LABEL: 'L' })
          $.CONSUME2(T.Ident)
          $.OPTION2(() => {
            $.CONSUME2(T.Gt, { LABEL: 'R' })
            $.SUBRULE2($.mfValue)
          })
        }
      }
    ])
  })

  // mfNonIdentifierValue
  //   : number (WS* '/' WS* number)?
  //   | dimension
  //   ;
  $.RULE('mfNonIdentifierValue', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Number)
          $.OPTION(() => {
            $.CONSUME(T.Slash)
            $.CONSUME2(T.Number)
          })
        }
      },
      { ALT: () => $.CONSUME(T.Dimension) }
    ])
  })

  // mfValue
  //   : mfNonIdentifierValue | identifier
  //   ;
  $.RULE('mfValue', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mfNonIdentifierValue) },
      { ALT: () => $.CONSUME(T.Ident) }
    ])
  })

  // mfComparison
  //   : mfLt | mfGt | mfEq
  //   ;
  $.RULE('mfComparison', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.Lt) },
      { ALT: () => $.CONSUME(T.Gt) },
      { ALT: () => $.CONSUME(T.Eq) }
    ])
  })

  // generalEnclosed
  //   : function
  //   // The spec allows the following, presumably because
  //   // whether or not a query is valid is up to the user agent.
  //   // However, this makes the grammar more ambiguous,
  //   // and we limit parsing to known query types.
  //   // | '(' WS* anyValue WS* ')'
  //   ;
  $.RULE('generalEnclosed', () => {
    $.CONSUME(T.LParen)
    $.SUBRULE($.anyInnerValue)
    $.CONSUME(T.RParen)
  })

  /**
     * @see https://www.w3.org/TR/css-page-3/
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
     */
  $.RULE('pageAtRule', () => {
    $.CONSUME(T.AtPage)
    $.MANY_SEP({
      SEP: T.Comma,
      DEF: () => $.SUBRULE($.pageSelector)
    })
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  $.RULE('pageSelector', () => {
    $.OPTION(() => $.CONSUME(T.Ident))
    $.MANY({
      GATE: () => $.LA(1).tokenType === T.Colon && $.noSep(1),
      DEF: () => {
        $.CONSUME(T.Colon)
        $.CONSUME(T.PagePseudoClassKeywords)
      }
    })
  })

  // fontFaceAtRule
  //   : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
  //   ;
  $.RULE('fontFaceAtRule', () => {
    $.CONSUME(T.AtFontFace)
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  /**
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
     */
  // supportsAtRule
  //   : SUPPORTS_RULE WS* supportsCondition WS* LCURLY main RCURLY
  //   ;
  $.RULE('supportsAtRule', (inner?: boolean) => {
    $.CONSUME(T.AtSupports)
    $.SUBRULE($.supportsCondition)
    $.CONSUME(T.LCurly)
    $.SUBRULE($.atRuleBody, { ARGS: [inner] })
    $.CONSUME(T.RCurly)
  })

  // supportsCondition
  //   : NOT supportsInParens
  //   | supportsInParens (WS* AND supportsInParens)*
  //   | supportsInParens (WS* OR supportsInParens)*
  //   ;
  $.RULE('supportsCondition', () => {
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.supportsNot)
        }
      },
      {
        ALT: () => {
          $.SUBRULE($.supportsInParens)
          $.MANY(() => {
            $.OR2([
              { ALT: () => { $.SUBRULE($.supportsAnd) } },
              { ALT: () => { $.SUBRULE($.supportsOr) } }
            ])
          })
        }
      }
    ])
  })

  $.RULE('function', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.knownFunctions) },
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OR2([{
            GATE: $.noSep,
            ALT: () => {
              $.CONSUME(T.LParen)
              $.OPTION(() => $.SUBRULE($.valueList))
              $.CONSUME(T.RParen)
            }
          }])
        }
      }
    ])
  })

  // supportsInParens
  // : '(' WS* supportsCondition WS* ')'
  // | '(' WS* declaration WS* ')'
  // | generalEnclosed
  // ;
  $.RULE('supportsInParens', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OR2([
            {
              GATE: $.noSep,
              ALT: () => {
                $.CONSUME(T.LParen)
                $.SUBRULE($.valueList)
                $.CONSUME(T.RParen)
              }
            }
          ])
        }
      },
      {
        ALT: () => {
          $.CONSUME2(T.LParen)
          $.OR3([
            { ALT: () => $.SUBRULE($.supportsCondition) },
            { ALT: () => $.SUBRULE($.declaration) }
          ])
          $.CONSUME2(T.RParen)
        }
      },
      { ALT: () => $.SUBRULE($.generalEnclosed) }
    ])
  })

  $.RULE('supportsNot', () => {
    $.CONSUME(T.Not)
    $.SUBRULE($.supportsInParens)
  })

  $.RULE('supportsAnd', () => {
    $.CONSUME(T.And)
    $.SUBRULE($.supportsInParens)
  })

  $.RULE('supportsOr', () => {
    $.CONSUME(T.Or)
    $.SUBRULE($.supportsInParens)
  })

  // https://www.w3.org/TR/css-cascade-4/#at-import
  // importAtRule
  //   : IMPORT_RULE WS* (URL_FUNCTION | STRING) (WS* SUPPORTS_FUNCTION WS* (supportsCondition | declaration))? (WS* mediaQuery)? SEMI
  //   ;
  $.RULE('importAtRule', () => {
    $.CONSUME(T.AtImport)
    $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.string) }
    ])
    $.OPTION(() => {
      $.CONSUME(T.Supports)
      $.OR2([
        { ALT: () => $.SUBRULE($.supportsCondition) },
        { ALT: () => $.SUBRULE($.declaration) }
      ])
    })
    $.OPTION2(() => {
      $.SUBRULE($.mediaQuery)
    })
    $.CONSUME(T.Semi)
  })

  $.RULE('nestedAtRule', () => {
    $.CONSUME(T.AtNested)
    $.MANY(() => $.SUBRULE($.anyOuterValue))
    $.CONSUME(T.LCurly)
    $.MANY2(() => $.SUBRULE($.anyInnerValue))
    $.CONSUME(T.RCurly)
  })

  $.RULE('nonNestedAtRule', () => {
    $.CONSUME(T.AtNonNested)
    $.MANY(() => $.SUBRULE($.anyOuterValue))
    $.CONSUME(T.Semi)
  })

  // unknownAtRule
  //   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
  //   ;
  $.RULE('unknownAtRule', () => {
    $.CONSUME(T.AtKeyword)
    $.MANY(() => $.SUBRULE($.anyOuterValue))
    $.OR([
      { ALT: () => $.CONSUME(T.Semi) },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.MANY2(() => $.SUBRULE($.anyInnerValue))
          $.CONSUME(T.RCurly)
        }
      }
    ])
  })
  /**
      @todo - add all tokens
      @see - https://stackoverflow.com/questions/55594491/antlr-4-parser-match-any-token

      From - https://w3c.github.io/csswg-drafts/css-syntax-3/#typedef-any-value
      The <any-value> production is identical to <declaration-value>, but also allows
      top-level <semicolon-token> tokens and <delim-token> tokens with a value of "!".
      It represents the entirety of what valid CSS can be in any context.

      Parts of the spec that allow any value should not display a warning or error
      for any unknown token.
    */
  // anyOuterValue
  //   : value
  //   | COMMA
  //   | '(' anyInnerValue* ')'
  //   | '[' anyInnerValue* ']'
  //   ;
  $.RULE('anyOuterValue', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.string) },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.MANY(() => $.SUBRULE($.anyInnerValue))
          $.CONSUME(T.RParen)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.LSquare)
          $.MANY2(() => $.SUBRULE2($.anyInnerValue))
          $.CONSUME(T.RSquare)
        }
      }
    ])
  })

  /**
     * Same as allowable outer values, but allows
     * semi-colons and curly blocks.
     */
  // anyInnerValue
  //   : anyOuterValue
  //   | '{' anyInnerValue* '}'
  //   | ID
  //   | SEMI
  //   | pseudoSelector
  //   ;
  $.RULE('anyInnerValue', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.anyOuterValue) },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.MANY(() => $.SUBRULE2($.anyInnerValue))
          $.CONSUME(T.RCurly)
        }
      },
      { ALT: () => $.CONSUME(T.Semi) }
    ])
  })
}