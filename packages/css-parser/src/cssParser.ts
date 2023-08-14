import {
  CstParser,
  type TokenVocabulary,
  type TokenType,
  type IParserConfig,
  type ConsumeMethodOpts,
  type IToken,
  type CstNode,
  type ParserMethod,
  EMPTY_ALT
} from 'chevrotain'
import { LLStarLookaheadStrategy } from 'chevrotain-allstar'

import type { CssTokenType } from './cssTokens'

export type TokenMap = Record<CssTokenType, TokenType>

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
type Rule<F extends () => void = () => void> = ParserMethod<Parameters<F>, CstNode>

export class CssParser extends CstParser {
  _: (idx?: number, options?: ConsumeMethodOpts) => IToken | undefined
  skippedTokens: IToken[]
  skippedIndex = 0

  stylesheet: Rule
  main: Rule
  qualifiedRule: Rule
  atRule: Rule
  selectorList: Rule
  declarationList: Rule
  forgivingSelectorList: Rule<(inDeclarationList?: boolean) => void>
  classSelector: Rule
  pseudoSelector: Rule
  attributeSelector: Rule
  nthValue: Rule
  complexSelector: Rule<(inDeclarationList?: boolean) => void>
  simpleSelector: Rule<(inDeclarationList?: boolean) => void>
  compoundSelector: Rule<(inDeclarationList?: boolean) => void>
  relativeSelector: Rule<(inDeclarationList?: boolean) => void>
  combinator: Rule

  declaration: Rule
  innerQualifiedRule: Rule
  innerAtRule: Rule
  valueList: Rule
  spacedValue: Rule
  value: Rule
  customValue: Rule
  innerCustomValue: Rule

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
  pageAtRule: Rule
  fontFaceAtRule: Rule
  supportsAtRule: Rule
  nestedAtRule: Rule
  nonNestedAtRule: Rule
  unknownAtRule: Rule

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

  /**
   * `@supports` is defined differently in spec,
   * but parsing is much like media queries,
   * so we structure the same for symmetry
   */
  supportsNot: Rule
  supportsAnd: Rule
  supportsOr: Rule

  /** General purpose subrules */
  anyOuterValue: Rule
  anyInnerValue: Rule
  anyToken: Rule
  extraTokens: Rule
  customBlock: Rule

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: IParserConfig = {
      lookaheadStrategy: new LLStarLookaheadStrategy(),
      nodeLocationTracking: 'full'
    }
  ) {
    super(tokenVocabulary, config)

    const $ = this

    $._ = function(idx: number = 0, options?: ConsumeMethodOpts) {
      options ??= { LABEL: idx === 0 ? 'WS' : `WS${idx}` }
      // +10 to avoid conflicts with other OPTION in the calling rule.
      return $.option(idx + 10, () => $.consume(idx + 10, T.WS, options))
    }

    /** Checks if there is white space or comment between tokens */
    const noSep = (whitespaceOnly = false) => {
      const skippedLength = this.skippedTokens.length
      const last = $.LA(0).endOffset!
      const next = $.LA(1).startOffset

      /** No separator because of offsets */
      if (last + 1 === next) {
        return true
      }
      let passed = true
      /**
       * Start where we left off each time, because
       * token parsing is happening linearly.
       */
      for (let i = this.skippedIndex; i < skippedLength; i++) {
        const token = this.skippedTokens[i]
        if (whitespaceOnly && token.tokenType !== T.WS) {
          continue
        }
        if (token.startOffset > last) {
          this.skippedIndex = i
          if (token.endOffset! < next) {
            passed = false
          }
          break
        }
      }
      return passed
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
      $.SUBRULE($.forgivingSelectorList, { ARGS: [true] })
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
    $.RULE('simpleSelector', (inDeclarationList?: boolean) => {
      $.OR([
        {
          /** In CSS Nesting, the first selector cannot be an identifier */
          GATE: () => !inDeclarationList,
          ALT: () => $.CONSUME(T.Ident)
        },
        { ALT: () => $.SUBRULE($.classSelector) },
        { ALT: () => $.CONSUME(T.HashName) },
        { ALT: () => $.CONSUME(T.ColorIdentStart) },
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
      $.OR([
        {
          GATE: noSep,
          ALT: () => {
            $.CONSUME(T.Ident)
          }
        }
      ])
    })

    // pseudoSelector
    //   : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
    //   | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
    //   | COLON COLON? identifier ('(' anyInnerValue* ')')?
    //   ;
    $.RULE('pseudoSelector', () => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.NthPseudoClass)
            $.OR2([
              {
                GATE: noSep,
                ALT: () => {
                  $.CONSUME(T.LParen)
                  $.SUBRULE($.nthValue)
                  $.CONSUME(T.RParen)
                }
              }
            ])
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.FunctionalPseudoClass)
            $.OR3([
              {
                GATE: noSep,
                ALT: () => {
                  $.CONSUME2(T.LParen)
                  $.SUBRULE($.forgivingSelectorList)
                  $.CONSUME2(T.RParen)
                }
              }
            ])
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.Colon)
            $.OPTION({
              GATE: noSep,
              DEF: () => {
                $.CONSUME2(T.Colon)
              }
            })
            $.OR4([
              {
                GATE: noSep,
                ALT: () => $.CONSUME(T.Ident)
              }
            ])
            $.OPTION2({
              GATE: noSep,
              DEF: () => {
                $.CONSUME3(T.LParen)
                $.MANY(() => $.SUBRULE($.anyInnerValue))
                $.CONSUME3(T.RParen)
              }
            })
          }
        }
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
        $.CONSUME(T.AttrMatch)
        $.OR([
          { ALT: () => $.CONSUME2(T.Ident) },
          { ALT: () => $.CONSUME(T.String) }
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
    $.RULE('compoundSelector', (inDeclarationList?: boolean) => {
      $.SUBRULE($.simpleSelector, { ARGS: [inDeclarationList] })
      $.MANY(() => $.SUBRULE2($.simpleSelector))
    })

    /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
    // complexSelector
    //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
    //   ;
    $.RULE('complexSelector', (inDeclarationList?: boolean) => {
      $.SUBRULE($.compoundSelector, { ARGS: [inDeclarationList] })
      $.MANY(() => {
        $.SUBRULE($.combinator)
        $.SUBRULE2($.compoundSelector)
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
          GATE: () => !noSep(true),
          ALT: () => EMPTY_ALT
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
    $.RULE('relativeSelector', (inDeclarationList?: boolean) => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.Combinator)
            $.SUBRULE($.complexSelector)
          }
        },
        {
          ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [inDeclarationList] })
        }
      ])
    })

    // forgivingSelectorList
    //   : relativeSelector (WS* COMMA WS* relativeSelector)*
    //   ;
    $.RULE('forgivingSelectorList', (inDeclarationList?: boolean) => {
      $.SUBRULE($.relativeSelector, { ARGS: [inDeclarationList] })
      $.MANY(() => {
        $.CONSUME(T.Comma)
        $.SUBRULE2($.relativeSelector)
      })
    })

    // selectorList
    //   : complexSelector (WS* COMMA WS* complexSelector)*
    //   ;
    $.RULE('selectorList', () => {
      $.MANY_SEP({
        SEP: T.Comma,
        DEF: () => $.SUBRULE($.complexSelector)
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
    $.RULE('declarationList', () => {
      $.OR([
        {
          ALT: () => {
            $.SUBRULE($.innerAtRule)
            $.SUBRULE($.declarationList)
          }
        },
        {
          ALT: () => {
            $.SUBRULE($.innerQualifiedRule)
            $.SUBRULE2($.declarationList)
          }
        },
        {
          ALT: () => {
            $.SUBRULE($.declaration)
            $.OPTION(() => {
              $.CONSUME(T.Semi)
              $.SUBRULE3($.declarationList)
            })
          }
        },
        {
          ALT: () => EMPTY_ALT
        }
      ])
    })

    // declaration
    //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
    //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
    //   ;
    $.RULE('declaration', () => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.Ident)
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
            $.MANY(() => $.SUBRULE2($.customValue))
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
        { ALT: () => $.SUBRULE($.anyToken) },
        { ALT: () => $.SUBRULE($.extraTokens) },
        { ALT: () => $.SUBRULE($.customBlock) }
      ])
    })

    /** Can also have semi-colons */
    $.RULE('innerCustomValue', () => {
      $.OR([
        { ALT: () => $.CONSUME(T.Semi) },
        { ALT: () => $.SUBRULE($.anyToken) },
        { ALT: () => $.SUBRULE($.extraTokens) },
        { ALT: () => $.SUBRULE($.customBlock) }
      ])
    })

    $.RULE('anyToken', () =>
      $.OR([
        { ALT: () => $.CONSUME(T.Value) },
        { ALT: () => $.CONSUME(T.CustomProperty) },
        { ALT: () => $.CONSUME(T.Colon) }
      ])
    )

    /**
     * Extra tokens in a custom property. Should include any
     * and every token possible (except semis), including unknown tokens.
     */
    $.RULE('extraTokens', () =>
      $.OR([
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
            $.CONSUME(T.LParen)
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
    $.RULE('valueList', () => {
      $.SUBRULE($.spacedValue)
      $.MANY(() => {
        $.OR([
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Slash) }
        ])
        $.SUBRULE2($.spacedValue)
      })
    })

    $.RULE('spacedValue', () => {
      $.AT_LEAST_ONE(() => $.SUBRULE($.value))
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
        { ALT: () => $.CONSUME(T.Ident) },
        { ALT: () => $.CONSUME(T.Dimension) },
        { ALT: () => $.CONSUME(T.Number) },
        { ALT: () => $.CONSUME(T.Color) },
        { ALT: () => $.CONSUME(T.String) },
        { ALT: () => $.SUBRULE($.function) },
        {
          ALT: () => {
            $.CONSUME(T.LSquare)
            $.CONSUME2(T.Ident)
            $.CONSUME(T.RSquare)
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
    $.RULE('function', () => {
      $.OR([
        { ALT: () => $.SUBRULE($.urlFunction) },
        {
          ALT: () => {
            $.CONSUME(T.Var)
            $.OR2([
              {
                GATE: noSep,
                ALT: () => $.CONSUME(T.LParen)
              }
            ])
            $.CONSUME(T.CustomProperty)
            $.OPTION(() => {
              $.CONSUME(T.Comma)
              $.SUBRULE($.valueList)
            })
            $.CONSUME(T.RParen)
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.Calc)
            $.OR3([
              {
                GATE: noSep,
                ALT: () => $.CONSUME2(T.LParen)
              }
            ])
            $.SUBRULE($.mathSum)
            $.CONSUME2(T.RParen)
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.Ident)
            $.OR4([
              {
                GATE: noSep,
                ALT: () => $.CONSUME3(T.LParen)
              }
            ])
            $.SUBRULE2($.valueList)
            $.CONSUME3(T.RParen)
          }
        }
      ])
    })

    $.RULE('urlFunction', () => {
      $.CONSUME(T.UrlStart)
      $.OR([
        { ALT: () => $.CONSUME(T.String) },
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
      $.SUBRULE($.mediaQuery)
      $.CONSUME(T.LCurly)
      $.SUBRULE($.main)
      $.CONSUME(T.RCurly)
    })

    // innerMediaAtRule
    //   : MEDIA_RULE WS* mediaQuery WS* LCURLY declarationList RCURLY
    //   ;
    $.RULE('innerMediaAtRule', () => {
      $.CONSUME(T.AtMedia)
      $.SUBRULE($.mediaQuery)
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
      $.SUBRULE($.anyToken)
      $.CONSUME(T.RParen)
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
      $.OPTION(() => {
        $.CONSUME(T.PagePseudoClass)
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
      $.SUBRULE($.supportsCondition)
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
        { ALT: () => $.SUBRULE($.supportsNot) },
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

    // supportsInParens
    // : '(' WS* supportsCondition WS* ')'
    // | '(' WS* declaration WS* ')'
    // | generalEnclosed
    // ;
    $.RULE('supportsInParens', () => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.LParen)
            $.OR2([
              { ALT: () => $.SUBRULE($.supportsCondition) },
              { ALT: () => $.SUBRULE($.declaration) }
            ])
            $.CONSUME(T.RParen)
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
        { ALT: () => $.CONSUME(T.String) }
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
        { ALT: () => $.CONSUME(T.Value) },
        { ALT: () => $.CONSUME(T.Colon) },
        { ALT: () => $.CONSUME(T.Comma) },
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

    if ($.constructor === CssParser) {
      $.performSelfAnalysis()
    }
  }

  reset() {
    this.skippedIndex = 0
  }
}
