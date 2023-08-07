import {
  CstParser,
  type TokenType,
  type IParserConfig,
  type ConsumeMethodOpts,
  type IToken
} from "chevrotain";

import type { Tokens } from './cssTokens'

type TokenMap = Record<typeof Tokens[number]['name'], TokenType>

/**
  Note that whitespace is WS* and not consumed as
  WS? even though whitespace consumes multiple spaces.
  This is because comments can cause consecutive
  WS to be separated into separate tokens.

  Even though CSS pretends that white-space isn't important
  in a number of specs, it obviously is in one specific place:
  between selectors. So if you want a general purpose parser,
  you need to parse whitespace.

  Also, by parsing whitespace, some of the token recognition
  phase and the parsing phase can be simplified, because
  we can parse colons (':') as general tokens, which means
  that a declaration of `a:b` doesn't get mis-labeled as
  an identifier followed by a pseudo-selector.

  Another approach would be to have different lexing phases
  for qualified rules vs declarations, but it can
  get super-complicated quickly.
*/
type Rule = ReturnType<CstParser['RULE']>

export class CssParser extends CstParser {
  _: (idx?: number, options?: ConsumeMethodOpts) => IToken | undefined

  stylesheet: Rule
  main: Rule
  qualifiedRule: Rule
  atRule: Rule
  selectorList: Rule
  declarationList: Rule
  forgivingSelectorList: Rule
  classSelector: Rule
  pseudoSelector: Rule
  attributeSelector: Rule
  nthValue: Rule
  complexSelector: Rule
  simpleSelector: Rule
  compoundSelector: Rule
  relativeSelector: Rule

  declaration: Rule
  innerQualifiedRule: Rule
  innerAtRule: Rule
  valueList: Rule
  value: Rule
  customValue: Rule

  function: Rule
  urlFunction: Rule
  unknownValue: Rule

  expression: Rule
  mathProduct: Rule
  mathSum: Rule
  mathValue: Rule

  /** At Rules */
  importAtRule: Rule
  mediaAtRule: Rule
  innerMediaAtRule: Rule
  unknownAtRule: Rule
  pageAtRule: Rule
  fontFaceAtRule: Rule
  supportsAtRule: Rule

  /** `@media` syntax */
  mediaQuery: Rule
  mediaCondition: Rule
  mediaType: Rule
  mediaConditionWithoutOr: Rule
  mediaNot: Rule
  mediaInParens: Rule
  mediaAnd: Rule
  mediaOr: Rule
  mediaFeature: Rule
  generalEnclosed: Rule

  mfValue: Rule
  mediaRange: Rule
  mfComparison: Rule
  mfNonIdentifierValue: Rule

  /** `@supports` syntax */
  supportsCondition: Rule
  supportsInParens: Rule


  constructor(
    tokens: TokenType[],
    T: TokenMap,
    config: IParserConfig = {
      maxLookahead: 1,
      recoveryEnabled: true
    }
  ) {
    super(tokens, config)

    const $ = this

    $._ = function(idx: number = 0, options?: ConsumeMethodOpts) {
      // +10 to avoid conflicts with other OPTION in the calling rule.
      return $.option(idx + 10, () => $.consume(idx + 10, T.WS, options))
    }
  
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
          { ALT: () => $.CONSUME(T.WS) },
          { ALT: () => $.SUBRULE($.qualifiedRule) },
          { ALT: () => $.SUBRULE($.atRule) }
        ])
      })
    })

    // qualifiedRule
    //   : selectorList WS* LCURLY declarationList RCURLY
    //   ;
    $.RULE('qualifiedRule', () => {
      $.SUBRULE($.selectorList)
      $.OPTION(() => {
        $.CONSUME(T.WS)
      })
      $.CONSUME(T.LCurly)
      $.SUBRULE($.declarationList)
      $.CONSUME(T.RCurly)
    })

    /**
      https://www.w3.org/TR/css-nesting-1/

      NOTE: implementers should throw a parsing
      error if the selectorlist starts with an identifier
    */
    // innerQualifiedRule
    //   : forgivingSelectorList WS* LCURLY declarationList RCURLY
    //   ; 
    $.RULE('innerQualifiedRule', () => {
      $.SUBRULE($.forgivingSelectorList)
      $.OPTION(() => {
        $.CONSUME(T.WS)
      })
      $.CONSUME(T.LCurly)
      $.SUBRULE($.declarationList)
      $.CONSUME(T.RCurly)
    })

    /*** SELECTORS ***/
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
    $.RULE('simpleSelector', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.classSelector) },
        { ALT: () => $.CONSUME(T.HashName) },
        { ALT: () => $.CONSUME(T.ColorIdentStart) },
        { ALT: () => $.CONSUME(T.Ident) },
        { ALT: () => $.CONSUME(T.Ampersand) },
        { ALT: () => $.CONSUME(T.Star) },
        { ALT: () => $.SUBRULE($.pseudoSelector) },
        { ALT: () => $.SUBRULE($.attributeSelector) }
      ])
    })

    // classSelector
    //   : DOT identifier
    //   ;
    $.RULE('classSelector', () => {
      $.CONSUME(T.Dot)
      $.CONSUME(T.Ident)
    })

    // pseudoSelector
    //   : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
    //   | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
    //   | COLON COLON? identifier ('(' anyInnerValue* ')')?
    //   ;
    $.RULE('pseudoSelector', () => {
      $.OR([
        { ALT: () => {
          $.CONSUME(T.NthPseudoClass)
          $.CONSUME(T.LParen)
          $._(0, { LABEL: 'PreWS' })
          $.SUBRULE($.nthValue)
          $._(1, { LABEL: 'PostWS' })
          $.CONSUME(T.RParen)
        }},
        { ALT: () => {
          $.CONSUME(T.FunctionalPseudoClass)
          $.CONSUME(T.LParen)
          $._(0, { LABEL: 'PreWS' })
          $.SUBRULE($.forgivingSelectorList)
          $._(1, { LABEL: 'PostWS' })
          $.CONSUME(T.RParen)
        }},
        { ALT: () => {
          $.CONSUME(T.Colon)
          $.OPTION(() => {
            $.CONSUME(T.Colon)
          })
          $.CONSUME(T.Ident)
          $.OPTION2(() => {
            $.CONSUME(T.LParen)
            $.MANY(() => {
              $.CONSUME2(T.Value)
            })
            $.CONSUME3(T.RParen)
          })
        }}
      ])
    })

    // nthValue
    //   : NTH_ODD
    //   | NTH_EVEN
    //   | (
    //     | NTH_DIMENSION
    //     | NTH_DIMENSION_SIGNED
    //   ) (SIGNED_INTEGER | '-' WS+ UNSIGNED_INTEGER)? (WS* OF WS* complexSelector)?
    //   ;
    $.RULE('nthValue', () => {
      $.OR([
        { ALT: () => $.CONSUME(T.NthOdd) },
        { ALT: () => $.CONSUME(T.NthEven) },
        { ALT: () => {
          $.OR2([
            { ALT: () => $.CONSUME(T.NthDimension) },
            { ALT: () => $.CONSUME(T.NthDimensionSigned) }
          ])
          $.OPTION(() => {
            $.OR3([
              { ALT: () => $.CONSUME(T.SignedInt) },
              { ALT: () => {
                $.CONSUME(T.Minus)
                $.CONSUME(T.WS)
                $.CONSUME(T.UnsignedInt)
              }}
            ])
          })
          $.OPTION2(() => {
            $.CONSUME(T.WS)
            $.CONSUME(T.Of)
            $.CONSUME2(T.WS)
            $.SUBRULE($.complexSelector)
          })
        }}
      ])
    })

    // attributeSelector
    //   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE 
    //   ;
    $.RULE('attributeSelector', () => {
      $.CONSUME(T.LSquare)
      $._(0, { LABEL: 'PreWS' })
      $.CONSUME(T.Ident)
      $.OPTION(() => {
        $.CONSUME(T.AttrMatch)
        $._(1, { LABEL: 'PreValWS' })
        $.OR([
          { ALT: () => $.CONSUME(T.Ident) },
          { ALT: () => $.CONSUME(T.String) }
        ])
        $._(2, { LABEL: 'PostValWS' })
      })
      $.OPTION2(() => {
        $.CONSUME(T.AttrFlag)
        $._(3, { LABEL: 'PostFlagWS' })
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
    $.RULE('compoundSelector', () => {
      $.AT_LEAST_ONE(() => {
        $.SUBRULE($.simpleSelector)
      })
    })

    /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
    // complexSelector
    //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
    //   ;
    $.RULE('complexSelector', () => {
      $.SUBRULE($.compoundSelector)
      $.MANY(() => {
        $._(0, { LABEL: 'PreWS' })
        $.OPTION(() => {
          $.CONSUME(T.Combinator)
          $._(1, { LABEL: 'PostWS' })
        })
        $.SUBRULE2($.compoundSelector)
      })
    })

    /**
      A selector representing an element relative to one or more
      anchor elements preceded by a combinator.
        e.g. + div#topic > #reference
    */
    // relativeSelector
    //   : (combinator WS*)? complexSelector
    //   ;
    $.RULE('relativeSelector', () => {
      $.OPTION(() => {
        $.CONSUME(T.Combinator)
        $._(0)
      })
      $.SUBRULE($.complexSelector)
    })
 
    // forgivingSelectorList
    //   : relativeSelector (WS* COMMA WS* relativeSelector)*
    //   ;
    $.RULE('forgivingSelectorList', () => {
      $.SUBRULE($.relativeSelector)
      $.MANY(() => {
        $._(0, { LABEL: 'PreWS' })
        $.CONSUME(T.Comma)
        $._(1, { LABEL: 'PostWS' })
        $.SUBRULE2($.relativeSelector)
      })
    })

    // selectorList
    //   : complexSelector (WS* COMMA WS* complexSelector)*
    //   ;
    $.RULE('selectorList', () => {
      $.SUBRULE($.complexSelector)
      $.MANY(() => {
        $._(0, { LABEL: 'PreWS' })
        $.CONSUME(T.Comma)
        $._(1, { LABEL: 'PostWS' })
        $.SUBRULE2($.complexSelector)
      })
    })

    /*** Declarations ***/
    // https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
    // declarationList
    //   : WS* (
    //     declaration? (WS* SEMI declarationList)*
    //     | innerAtRule declarationList
    //     | innerQualifiedRule declarationList
    //   )
    //   ;
    $.RULE('declarationList', () => {
      $._(0, { LABEL: 'PreWS' })
      $.OR([
        { ALT: () => {
          $.OPTION(() => {
            $.SUBRULE($.declaration)
          })
          $.MANY(() => {
            $._(1, { LABEL: 'PostWS' })
            $.CONSUME(T.Semi)
            $.SUBRULE2($.declarationList)
          })
        }},
        { ALT: () => {
          $.SUBRULE($.innerAtRule)
          $.SUBRULE3($.declarationList)
        }},
        { ALT: () => {
          $.SUBRULE($.innerQualifiedRule)
          $.SUBRULE4($.declarationList)
        }}
      ])
    })

    // declaration
    //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
    //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
    //   ;
    $.RULE('declaration', () => {
      $.OR([
        { ALT: () => {
          $.CONSUME(T.Ident)
          $._(0, { LABEL: 'PreWS' })
          $.CONSUME(T.Assign)
          $._(1, { LABEL: 'PostWS' })
          $.SUBRULE($.valueList)
          $.OPTION(() => {
            $._(2, { LABEL: 'PostValWS' })
            $.CONSUME(T.Important)
          })
        }},
        { ALT: () => {
          $.CONSUME(T.CustomProperty)
          $._(3, { LABEL: 'PreWS' })
          $.CONSUME(T.Assign)
          $.SUBRULE2($.customValue)
        }}
      ])
    })

    /** Values separated by commas or slashes */
    // valueList
    //   : value+ ((',' | '/') value+)*
    //   ;
    $.RULE('valueList', () => {
      $.AT_LEAST_ONE(() => {
        $.SUBRULE($.value)
      })
      $.MANY(() => {
        $.OR([
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Slash) }
        ])
        $.AT_LEAST_ONE2(() => {
          $.SUBRULE2($.value)
        })
      })
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
    $.RULE('value', () => {
      $.OR([
        { ALT: () => $.CONSUME(T.WS) },
        { ALT: () => $.CONSUME(T.Ident) },
        { ALT: () => $.CONSUME(T.Dimension) },
        { ALT: () => $.CONSUME(T.Number) },
        { ALT: () => $.CONSUME(T.Color) },
        { ALT: () => $.CONSUME(T.String) },
        { ALT: () => $.SUBRULE($.function) },
        { ALT: () => {
          $.CONSUME(T.LSquare)
          $.CONSUME2(T.Ident)
          $.CONSUME(T.RSquare)
        }}
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
        { ALT: () => $.CONSUME(T.Dot) },
        { ALT: () => $.CONSUME(T.HashName) },
        { ALT: () => $.CONSUME(T.Unknown) },
        { ALT: () => $.CONSUME(T.AtName) }
      ])
    })

    $.RULE('expression', () => {
      $.SUBRULE($.mathSum)
    })

    // mathSum
    //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
    //   ;
    $.RULE('mathSum', () => {
      $.SUBRULE($.mathProduct)
      $.MANY(() => {
        $._(0, { LABEL: 'PreWS' })
        $.OR([
          { ALT: () => $.CONSUME(T.Plus) },
          { ALT: () => $.CONSUME(T.Minus) }
        ])
        $._(1, { LABEL: 'PostWS' })
        $.SUBRULE2($.mathProduct)
      })
    })

    // mathProduct
    //   : mathValue (WS* ('*' | '/') WS* mathValue)*
    //   ;
    $.RULE('mathProduct', () => {
      $.SUBRULE($.mathValue)
      $.MANY(() => {
        $._(0, { LABEL: 'PreWS' })
        $.OR([
          { ALT: () => $.CONSUME(T.Star) },
          { ALT: () => $.CONSUME(T.Divide) }
        ])
        $._(1, { LABEL: 'PostWS' })
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
        { ALT: () => {
          $.CONSUME(T.LParen)
          $._(0, { LABEL: 'PreWS' })
          $.SUBRULE($.mathSum)
          $._(1, { LABEL: 'PostWS' })
          $.CONSUME(T.RParen)
        }}
      ])
    })

    // function
    //   : URL_FUNCTION
    //   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
    //   | CALC_FUNCTION '(' WS* mathSum WS* ')'
    //   | identifier '(' valueList ')'
    //   ;
    $.RULE('function', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.urlFunction) },
        { ALT: () => {
          $.CONSUME(T.Var)
          $.CONSUME(T.LParen)
          $._(0, { LABEL: 'PreWS' })
          $.CONSUME(T.CustomProperty)
          $.OPTION(() => {
            $._(1, { LABEL: 'PreSepWS' })
            $.CONSUME(T.Comma)
            $._(2, { LABEL: 'PostSepWS' })
            $.SUBRULE($.valueList)
          })
          $.CONSUME(T.RParen)
        }},
        { ALT: () => {
          $.CONSUME(T.Calc)
          $.CONSUME(T.LParen)
          $._(0, { LABEL: 'PreWS' })
          $.SUBRULE($.mathSum)
          $._(1, { LABEL: 'PostWS' })
          $.CONSUME(T.RParen)
        }},
        { ALT: () => {
          $.CONSUME(T.Ident)
          $.CONSUME(T.LParen)
          $.SUBRULE($.valueList)
          $.CONSUME(T.RParen)
        }}
      ])
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
        { ALT: () => $.SUBRULE($.unknownAtRule) },
        { ALT: () => $.SUBRULE($.pageAtRule) },
        { ALT: () => $.SUBRULE($.fontFaceAtRule) },
        { ALT: () => $.SUBRULE($.supportsAtRule) }
      ])
    })

    /**
      Inner rules are mostly the same except they have a declarationList
      instead of a main block within {}
    */
    // innerAtRule
    //   : innerMediaAtRule
    //   | unknownAtRule
    //   ;
    $.RULE('innerAtRule', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.innerMediaAtRule) },
        { ALT: () => $.SUBRULE($.unknownAtRule) }
      ])
    })

    // mediaAtRule
    //   : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
    //   ;
    $.RULE('mediaAtRule', () => {
      $.CONSUME(T.AtMedia)
      $._(0, { LABEL: 'PreWS' })
      $.SUBRULE($.mediaQuery)
      $._(1, { LABEL: 'PostWS' })
      $.CONSUME(T.LCurly)
      $.SUBRULE($.main)
      $.CONSUME(T.RCurly)
    })

    // innerMediaAtRule
    //   : MEDIA_RULE WS* mediaQuery WS* LCURLY declarationList RCURLY
    //   ;
    $.RULE('innerMediaAtRule', () => {
      $.CONSUME(T.AtMedia)
      $._(0, { LABEL: 'PreWS' })
      $.SUBRULE($.mediaQuery)
      $._(1, { LABEL: 'PostWS' })
      $.CONSUME(T.LCurly)
      $.SUBRULE($.declarationList)
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
        { ALT: () => {
          $.OPTION(() => {
            $.OR([
              { ALT: () => $.CONSUME(T.Not) },
              { ALT: () => $.CONSUME(T.Only) }
            ])
            $._(0, { LABEL: 'PreWS' })
          })
          $.SUBRULE($.mediaType)
          $.OPTION(() => {
            $._(1, { LABEL: 'PreSepWS' })
            $.CONSUME(T.And)
            $._(2, { LABEL: 'PostSepWS' })
            $.SUBRULE($.mediaConditionWithoutOr)
          })
        }}
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
        { ALT: () => {
          $.SUBRULE($.mediaInParens)
          $._()
          $.OR([
            { ALT: () => $.MANY(() => $.SUBRULE($.mediaAnd)) },
            { ALT: () => $.MANY(() => $.SUBRULE($.mediaOr)) }
          ])
        }}
      ])
    })
    
    // mediaConditionWithoutOr
    //   : mediaNot | mediaInParens (WS* mediaAnd)*
    //   ;
    $.RULE('mediaConditionWithoutOr', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.mediaNot) },
        { ALT: () => {
          $.SUBRULE($.mediaInParens)
          $.MANY(() => {
            $._()
            $.SUBRULE($.mediaAnd)
          })
        }}
      ])
    })

    // mediaNot
    //   : NOT WS* mediaInParens
    //   ;
    $.RULE('mediaNot', () => {
      $.CONSUME(T.Not)
      $._()
      $.SUBRULE($.mediaInParens)
    })

    // mediaAnd
    //   : AND WS* mediaInParens
    //   ;
    $.RULE('mediaAnd', () => {
      $.CONSUME(T.And)
      $._()
      $.SUBRULE($.mediaInParens)
    })

    // mediaOr
    //   : OR WS* mediaInParens
    //   ;
    $.RULE('mediaOr', () => {
      $.CONSUME(T.Or)
      $._()
      $.SUBRULE($.mediaInParens)
    })

    // mediaInParens
    //   : '(' WS* (mediaCondition | mediaFeature) WS* ')'
    //   | generalEnclosed
    //   ;
    $.RULE('mediaInParens', () => {
      $.OR([
        { ALT: () => {
          $.CONSUME(T.LParen)
          $._(0, { LABEL: 'PreWS' })
          $.OR([
            { ALT: () => $.SUBRULE($.mediaCondition) },
            { ALT: () => $.SUBRULE($.mediaFeature) }
          ])
          $._(1, { LABEL: 'PostWS' })
          $.CONSUME(T.RParen)
        }},
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
        { ALT: () => {
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $._(0, { LABEL: 'PreSepWS' })
            $.OR([
              { ALT: () => {
                $.CONSUME(T.Colon)
                $._(1, { LABEL: 'PostSepWS' })
                $.SUBRULE($.mfValue)
              }},
              { ALT: () => $.SUBRULE($.mediaRange) },
              { ALT: () => {
                $.SUBRULE($.mfComparison)
                $._(2, { LABEL: 'PreSepWS' })
                $.SUBRULE($.mfNonIdentifierValue)
              }}
            ])
          })
        }},
        { ALT: () => {
          $.SUBRULE($.mfNonIdentifierValue)
          $._(3, { LABEL: 'PostSepWS' })
          $.OR([
            { ALT: () => {
              $.SUBRULE($.mfComparison)
              $._(4, { LABEL: 'PreSepWS' })
              $.CONSUME(T.Ident)
            }},
            { ALT: () => $.SUBRULE($.mediaRange) }
          ])
        }}
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
        { ALT: () => {
          $.CONSUME(T.Lt, { LABEL: 'L' })
          $._(0, { LABEL: 'WS1' })
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $._(1, { LABEL: 'WS2' })
            $.CONSUME(T.Lt, { LABEL: 'R' })
            $._(2, { LABEL: 'WS3' })
            $.SUBRULE($.mfValue)
          })
        }},
        { ALT: () => {
          $.CONSUME(T.Gt, { LABEL: 'L' })
          $._(3, { LABEL: 'WS1' })
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $._(4, { LABEL: 'WS2' })
            $.CONSUME(T.Gt, { LABEL: 'R' })
            $._(5, { LABEL: 'WS3' })
            $.SUBRULE($.mfValue)
          })
        }}
      ])
    })

    // mfNonIdentifierValue
    //   : number (WS* '/' WS* number)?
    //   | dimension
    //   ;
    $.RULE('mfNonIdentifierValue', () => {
      $.OR([
        { ALT: () => {
          $.CONSUME(T.Number)
          $.OPTION(() => {
            $._(0, { LABEL: 'WS1' })
            $.CONSUME(T.Slash)
            $._(1, { LABEL: 'WS2' })
            $.CONSUME(T.Number)
          })
        }},
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
      $.SUBRULE($.function)
    })

    /**
     * @see https://www.w3.org/TR/css-page-3/
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
     */
    // pageAtRule
    //   : PAGE_RULE WS* (PAGE_PSEUDO_CLASS WS*)? LCURLY declarationList RCURLY
    //   ;
    $.RULE('pageAtRule', () => {
      $.CONSUME(T.AtPage)
      $._(0, { LABEL: 'WS1' })
      $.OPTION(() => {
        $.CONSUME(T.PagePseudoClass)
        $._(1, { LABEL: 'WS2' })
      })
      $.CONSUME(T.LCurly)
      $.SUBRULE($.declarationList)
      $.CONSUME(T.RCurly)
    })

    // fontFaceAtRule
    //   : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
    //   ;
    $.RULE('fontFaceAtRule', () => {
      $.CONSUME(T.AtFontFace)
      $._(0, { LABEL: 'WS1' })
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
    $.RULE('supportsAtRule', () => {
      $.CONSUME(T.AtSupports)
      $._(0, { LABEL: 'WS1' })
      $.SUBRULE($.supportsCondition)
      $._(1, { LABEL: 'WS2' })
      $.CONSUME(T.LCurly)
      $.SUBRULE($.main)
      $.CONSUME(T.RCurly)
    })

    // supportsCondition
    //   : NOT supportsInParens
    //   | supportsInParens (WS* AND supportsInParens)*
    //   | supportsInParens (WS* OR supportsInParens)*
    //   ;
    $.RULE('supportsCondition', () => {
      $.OR([
        { ALT: () => {
          $.CONSUME(T.Not)
          $.SUBRULE($.supportsInParens)
        }},
        { ALT: () => {
          $.SUBRULE($.supportsInParens)
          $.MANY(() => {
            $._(0, { LABEL: 'WS1' })
            $.CONSUME(T.And)
            $.SUBRULE2($.supportsInParens)
          })
        }},
        { ALT: () => {
          $.SUBRULE($.supportsInParens)
          $.MANY2(() => {
            $._(0, { LABEL: 'WS1' })
            $.CONSUME(T.Or)
            $.SUBRULE3($.supportsInParens)
          })
        }}
      ])
    })

    supportsInParens
  : '(' WS* supportsCondition WS* ')'
  | '(' WS* declaration WS* ')'
  | generalEnclosed
  ;

    if ($.constructor === CssParser) {
      $.performSelfAnalysis()
    }
  }
}

// https://www.w3.org/TR/css-cascade-4/#at-import
importAtRule
  : IMPORT_RULE WS* (URL_FUNCTION | STRING) (WS* SUPPORTS_FUNCTION WS* (supportsCondition | declaration))? (WS* mediaQuery)? SEMI
  ;

unknownAtRule
  : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
  ;

/** List all keywords */
identifier
  : IDENT
  | AND
  | NOT
  | ONLY
  | OR
  | SCREEN
  | PRINT
  | ALL
  | OF
  | ATTRIBUTE_FLAG
  | E
  | PI
  | INFINITY
  | NAN
  ;

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
anyOuterValue
  : value
  | COMMA
  | '(' anyInnerValue* ')'
  | '[' anyInnerValue* ']'
  ;

anyInnerValue
  : anyOuterValue
  | '{' anyInnerValue* '}'
  | ID
  | SEMI
  | pseudoSelector
  ;