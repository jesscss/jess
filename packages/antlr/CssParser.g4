parser grammar CssParser;

options
  { tokenVocab = CssLexer; }

stylesheet
  : Charset? (
    WS
    | qualifiedRule
    | atRule
  )* EOF
  ;

qualifiedRule
  : selectorList WS* LCurly declarationList RCurly
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
  : Class
  | ID
  | identifier
  | Ampersand
  | Star
  | PseudoNth
  | Pseudo
  | Attribute
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
  : compoundSelector (WS* (Combinator WS*)? compoundSelector)*
  ;

/**
  A selector representing an element relative to one or more
  anchor elements preceded by a combinator.
    e.g. + div#topic > #reference
*/
relativeSelector
  : (Combinator WS*)? complexSelector
  ;

selectorList
  : complexSelector (WS* Comma WS* complexSelector)*
  ;

/*** Declarations ***/
// https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
declarationList
  : declaration? (Semi declarationList)*
  | atRule declarationList
  ;

declaration
  : DList_Property value+
  | DList_CustomProp Custom_Value
  ;

value
  : Ident
  | integer
  | number
  | dimension
  | String
  | Function
  ;

integer
  : UnsignedInteger
  | SignedInteger
  ;

number
  : UnsignedNumber
  | SignedNumber
  ;

dimension
  : UnsignedDimension
  | SignedDimension
  ;

atRule
  : importAtRule
  | unknownAtRule
  ;

importAtRule
  : ImportRule
  ;

unknownAtRule
  : AtRule
  ;

identifier
  : Ident
  ;