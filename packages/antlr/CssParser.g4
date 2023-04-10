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
  : selectorList WS* LCurly declarationList? RCurly
  ;

/*** SELECTORS ***/
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
  | Ident
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

complexSelector
  : compoundSelector (WS* (Combinator WS*)? compoundSelector)*
  ;

relativeSelector
  : (Combinator WS*)? complexSelector
  ;

selectorList
  : complexSelector (WS* Comma WS* complexSelector)*
  ;

/*** Declarations ***/
// https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
declarationList
  : declaration (Semi declarationList)*
  | atRule declarationList
  ;

declaration
  : DList_Property value
  | DList_CustomProp Custom_Value
  ;

value
  :
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