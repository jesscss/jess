parser grammar CssParser;

options
  { tokenVocab = CssLexer; }

stylesheet
  : CHARSET? (
    WS
    | qualifiedRule
    | atRule
  )* EOF
  ;

qualifiedRule
  : selectorList WS* LCURLY declarationList RCURLY
  ;

/*** SELECTORS ***/
/** @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors  */
/**
  A selector with a single component, such as a single id selector
  or type selector, that's not used in combination with or contains
  any other selector component or combinator
    .e.g `a` | `#selected` | `.foo`

  @todo Define known pseudos
*/
simpleSelector
  : CLASS
  | ID
  | identifier
  | AMPERSAND
  | STAR
  | pseudoSelector
  | attributeSelector
  ;

pseudoSelector
  : NTH_PSEUDO_CLASS
  | COLON COLON? identifier (LPAREN anyToken RPAREN)?
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

selectorList
  : complexSelector (WS* COMMA WS* complexSelector)*
  ;

/*** Declarations ***/
// https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
declarationList
  : WS* (
    declaration? (SEMI declarationList)*
    | atRule declarationList
  )
  ;

declaration
  : identifier WS* COLON WS* value+
  // | CUSTOM_IDENT WS* COLON CUSTOM_VALUE
  ;

value
  : WS+
  | IDENT
  | integer
  | number
  | dimension
  | STRING
  | function
  ;

function
  : FUNCTION ')'
  ;

integer
  : UNSIGNED_INTEGER
  | SIGNED_INTEGER
  ;

number
  : UNSIGNED_NUMBER
  | SIGNED_NUMBER
  ;

dimension
  : UNSIGNED_DIMENSION
  | SIGNED_DIMENSION
  ;

atRule
  : importAtRule
  | unknownAtRule
  ;

importAtRule
  : IMPORT_RULE
  ;

unknownAtRule
  : AT_RULE
  ;

identifier
  : IDENT
  | AND
  | NOT
  | ONLY
  | OR
  ;

anyToken
  : selectorList
  ;