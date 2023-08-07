import {
  CstParser,
  type TokenType,
  type IParserConfig,
  type BaseParser,
  type ConsumeMethodOpts,
  type IToken
} from "chevrotain";
import type { TokenMap } from './util'

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


class CssParser extends CstParser {
  _: (idx?: number) => IToken | undefined

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
        { ALT: () => $.CONSUME(T.ID) },
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
          $._(0)
          $.SUBRULE($.nthValue)
          $._(1)
          $.CONSUME(T.RParen)
        }},
        { ALT: () => {
          $.CONSUME(T.FunctionalPseudoClass)
          $.CONSUME(T.LParen)
          $._(0)
          $.SUBRULE($.forgivingSelectorList)
          $._(1)
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
  

    if ($.constructor === CssParser) {
      $.performSelfAnalysis()
    }
  }
}

pseudoSelector
  : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
  | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
  | COLON COLON? identifier ('(' anyInnerValue* ')')?
  ;

nthValue
  : NTH_ODD
  | NTH_EVEN
  | (
    | NTH_DIMENSION
    | NTH_DIMENSION_SIGNED
  ) (SIGNED_INTEGER | '-' WS+ UNSIGNED_INTEGER)? (WS* OF WS* complexSelector)?
  ;

attributeSelector
  : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE 
  ;

/**
  A sequence of simple selectors that are not separated by
  a combinator.
    .e.g. `a#selected`
*/
compoundSelector
  : simpleSelector+
  ;

/**
  A sequence of one or more simple and/or compound selectors
  that are separated by combinators.
    .e.g. a#selected > .icon
*/
complexSelector
  : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  ;

combinator
  : PLUS
  | TILDE
  | COLUMN
  | GT
  ;

/**
  A selector representing an element relative to one or more
  anchor elements preceded by a combinator.
    e.g. + div#topic > #reference
*/
relativeSelector
  : (combinator WS*)? complexSelector
  ;

forgivingSelectorList
  : relativeSelector (WS* COMMA WS* relativeSelector)*
  ;

selectorList
  : complexSelector (WS* COMMA WS* complexSelector)*
  ;

/*** Declarations ***/
// https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
declarationList
  : WS* (
    declaration? (WS* SEMI declarationList)*
    | innerAtRule declarationList
    | innerQualifiedRule declarationList
  )
  ;

declaration
  : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  ;

/** Values separated by commas or slashes */
valueList
  : value+ ((',' | '/') value+)*
  ;

value
  : WS
  | identifier
  | integer
  | number
  | dimension
  | COLOR_IDENT_START
  | COLOR_INT_START
  | STRING
  | function
  | '[' identifier ']'
  | unknownValue
  ;

/** Implementers can decide to throw errors or warnings or not */
unknownValue
  : COLON
  | EQ
  | DOT
  | ID
  | UNKNOWN
  | AT_RULE
  ;

mathSum
  : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  ;

mathProduct
  : mathValue (WS* ('*' | '/') WS* mathValue)*
  ;

mathValue
  : number
  | dimension
  | percentage
  | mathConstant
  | '(' WS* mathSum WS* ')'
  ; 

mathConstant
  : 'e'
  | 'pi'
  | '-'? 'infinity'
  | 'nan'
  ;

function
  : URL_FUNCTION
  | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
  | CALC_FUNCTION '(' WS* mathSum WS* ')'
  | identifier '(' valueList ')'
  ;

integer
  : UNSIGNED_INTEGER
  | SIGNED_INTEGER
  ;

number
  : UNSIGNED_NUMBER
  | SIGNED_NUMBER
  | UNSIGNED_INTEGER
  | SIGNED_INTEGER
  ;

dimension
  : UNSIGNED_DIMENSION
  | SIGNED_DIMENSION
  | NTH_DIMENSION
  | NTH_DIMENSION_SIGNED
  ;

percentage
  : UNSIGNED_PERCENTAGE
  | SIGNED_PERCENTAGE
  ;

/**
  All At-rules according to spec are supposed to end with either
  a semi-colon or a curly-braced block. Some pre-processors
  (like PostCSS) allow the semi-colon to be optional, so we also
  allow it and insert it if it's missing.
*/
atRule
  : importAtRule
  | mediaAtRule
  | unknownAtRule
  | pageAtRule
  | fontFaceAtRule
  | supportsAtRule
  ;

/**
  Inner rules are mostly the same except they have a declarationList
  instead of a main block within {}
*/
innerAtRule
  : innerMediaAtRule
  | unknownAtRule
  ;

mediaAtRule
  : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
  ;

innerMediaAtRule
  : MEDIA_RULE WS* mediaQuery WS* LCURLY declarationList RCURLY
  ;

// https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
// Note, some of the spec had to be re-written for less ambiguity
mediaQuery
  : mediaCondition
  | ((NOT | ONLY) WS*)? mediaType (WS* AND WS* mediaConditionWithoutOr)?
  ;

/** Doesn't include only, not, and, or, layer */
mediaType
  : IDENT
  | SCREEN
  | PRINT
  | ALL
  ;

mediaCondition
  : mediaNot | mediaInParens ( WS* (mediaAnd* | mediaOr* ))
  ;

mediaConditionWithoutOr
  : mediaNot | mediaInParens (WS* mediaAnd)*
  ;

mediaNot
  : NOT WS* mediaInParens
  ;

mediaAnd
  : AND WS* mediaInParens
  ;

mediaOr
  : OR WS* mediaInParens
  ;

mediaInParens
  : '(' WS* (mediaCondition | mediaFeature) WS* ')'
  | generalEnclosed
  ;

/**
  An identifier is a legal value, so it can be
  ambiguous which side of the expression we're on
  while parsing. The browser figures this out
  post-parsing.
*/
mediaFeature
  : identifier (WS* (
    COLON WS* mfValue
    | mediaRange
    | mfComparison WS* mfNonIdentifierValue
  ))?
  | mfNonIdentifierValue WS* (
    mfComparison WS* identifier
    | mediaRange
  )
  ;

mediaRange
  : mfLt WS* identifier (WS* mfLt WS* mfValue)?
  | mfGt WS* identifier (WS* mfGt WS* mfValue)?
  ;

mfNonIdentifierValue
  : number (WS* '/' WS* number)?
  | dimension
  ;

mfValue
  : mfNonIdentifierValue | identifier
  ;

mfLt
  : '<' '='?
  ;

mfGt
  : '>' '='?
  ;

mfEq
  : '='
  ;

mfComparison
  : mfLt | mfGt | mfEq
  ;

generalEnclosed
  : function
  // The spec allows the following, presumably because
  // whether or not a query is valid is up to the user agent.
  // However, this makes the grammar more ambiguous,
  // and we limit parsing to known query types.
  // | '(' WS* anyValue WS* ')'
  ;

ratio
  : number WS* '/' WS* number
  ;

/** https://www.w3.org/TR/css-page-3/ */
pageAtRule
  : PAGE_RULE WS* (PAGE_PSEUDO_CLASS WS*)? LCURLY declarationList RCURLY
  ;

fontFaceAtRule
  : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
  ;

/** https://developer.mozilla.org/en-US/docs/Web/CSS/@supports */
supportsAtRule
  : SUPPORTS_RULE WS* supportsCondition WS* LCURLY main RCURLY
  ;

supportsCondition
  : NOT supportsInParens
  | supportsInParens (WS* AND supportsInParens)*
  | supportsInParens (WS* OR supportsInParens)*
  ;

supportsInParens
  : '(' WS* supportsCondition WS* ')'
  | '(' WS* declaration WS* ')'
  | generalEnclosed
  ;

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