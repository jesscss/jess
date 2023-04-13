/**
 * references:
 * https://github.com/antlr/grammars-v4/blob/master/css3/css3.g4
 * https://www.lifewire.com/css2-vs-css3-3466978
 * https://www.w3.org/TR/css-syntax-3/
 * https://github.com/jesscss/jess/blob/master/packages/css-parser/src/cssTokens.ts
 */
lexer grammar CssLexer;

/** Keywords */
AND:            'and';
OR:             'or';
NOT:            'not';
ONLY:           'only';

fragment Newline
  : '\n' | '\r' '\n'? | '\f'
  ;

fragment Whitespace
  : ' ' | '\t' | Newline
  ;

fragment Digit
  : '0'..'9'
  ;

fragment Hex
  : Digit
  | 'a'..'f'
  | 'A'..'F'
  ;

fragment Unicode
  : '\\' Hex (Hex Hex Hex Hex Hex)? Whitespace? // 1 or 6 hex digits
  ;

fragment Escape
  : Unicode
  | '\\' ~[\r\n\f0-9a-fA-F]
  ;

fragment DoubleString
  : '"' ('\\' | ~[\n\r\f"] | Newline | Escape)* '"'
  ;

fragment SingleString
  : '\'' ('\\' | ~[\n\r\f'] | Newline | Escape)* '\''
  ;

fragment NonAscii
  : '\u0240'..'\uffff'
  ;

fragment NmStart
  : [_a-zA-Z] | NonAscii | Escape
  ;

fragment NmChar
  : [_a-zA-Z0-9-]
  | NonAscii
  | Escape
  ;

/** Reference: https://www.w3.org/TR/css-syntax-3/#consume-url-token */
fragment UrlFragment
  : (~(
    '('
    | '"'
    | '\''
    // Non-printable
    | '\u0000'..'\u0008'
    | '\u000b'
    | '\u000e'..'\u001f'
    | '\u007f'
  ))*
  ;

fragment Sign
  : ('+' | '-')
  ;

fragment Exp
  : [eE][+-]Digit+
  ;

fragment Integer
  : Digit+
  ;

fragment Gt   : '>';

fragment NthFunctions
  : 'nth-child'
  | 'nth-last-child'
  | 'nth-of-type'
  | 'nth-last-of-type'
  ;
/**
 * TOKENS
 *  - default mode should look for selectors and at-rule starts
 *  - selector mode should look for selectors and '{'
 *  - at-rule mode should look for any token and blocks and outer '{'
 *  - declaration list mode should look for idents and at-rule starts and selectors (nesting)
 *  - declaration mode should look for valid value tokens and ';'
 *  - custom property mode should look for any token and blocks and outer ';'
 */

/** 
 * Uses nongreedy wildcard
 * @see https://github.com/antlr/antlr4/blob/master/doc/wildcard.md
 */
Comment     : '/*' .*? '*/' -> channel(HIDDEN);
/**
 * Aliased because Less will not skip CSS comments
 *   e.g. (Whitespace | Comment)
 */
WS          : Whitespace;

Cdo         : '<!--' -> skip;
Cdc         : '-->' -> skip;

/** Ignore BOM */
UnicodeBOM  : '\uFFFE' -> skip;

/**
  Keywords and special characters -
  These must come before the Ident definition.
*/

Ident
  : '-'? NmStart NmChar*
  ;

LCurly      : '{';
RCurly      : '}';

/**
 * CSS syntax says we should identify integers as separate from numbers,
 * probably because there are parts of the syntax where one is allowed but not the other?
 */
/** Separate for easy token identification during parsing */
UnsignedInteger   : Integer;
SignedInteger     : Sign UnsignedInteger;

/** Any number that's not simply an integer e.g. 1.1 or 1e+1 */
UnsignedNumber    : Digit* '.' Integer Exp? | Integer Exp?;
SignedNumber      : Sign UnsignedNumber;

UnsignedDimension : UnsignedNumber Ident;
SignedDimension   : SignedNumber Ident;

UnsignedPercentage: UnsignedNumber '%';
SignedPercentage  : SignedNumber '%';

Comma       : ',';
String      : DoubleString | SingleString;

Semi        : ';';

/** Simple Selectors */
Star        : '*' -> pushMode(Selector);
Ampersand   : '&' -> pushMode(Selector);
ID          : '#' Ident -> pushMode(Selector);
Class       : '.' Ident -> pushMode(Selector);

fragment NthSyntax   : 'odd' | 'even' | Integer | Integer? [nN] (WS* [+-] WS* Digit)?;
PseudoNth   : ':' NthFunctions '(' WS* NthSyntax WS* ')' -> pushMode(Selector);
Pseudo      : ':' ':'? Ident ('(' .*? ')')? -> pushMode(Selector);
/** @todo - lookup */
Attribute   : LSquare WS* Ident [*~|^$]? ('=') WS* (Ident | String) WS* ([is] WS*)? RSquare -> pushMode(Selector);

Combinator    : ([~>+] | '||') -> pushMode(Selector);

/** Non-nested */
Charset           : '@charset' WS String ';' -> channel(HIDDEN);
ImportRule        : '@import' -> pushMode(Values);
NamespaceRule     : '@namespace' -> pushMode(Values);

/** Nested */
MediaRule         : '@media' -> pushMode(Values);
SupportsRule      : '@supports' -> pushMode(Values);
PageRule          : '@page' -> pushMode(Values);
FontFaceRule      : '@font-face' -> pushMode(Values);
KeyframesRule     : '@keyframes' -> pushMode(Values);
ContainerRule     : '@container' -> pushMode(Values);
PropertyRule      : '@property' -> pushMode(Values);
LayerRule         : '@layer' -> pushMode(Values);
ScopeRule         : '@scope' -> pushMode(Values);

/** CSS allows any at-rule definition */
AtRule            : '@' Ident -> pushMode(Values);

// Parse specifically later?
// CounterStyleRule  : '@counter-style';
// FontFeatureRule   : '@font-feature-values';
//   SwashRule       : '@swash';
//   AnnotationRule  : '@annotation';
//   OrnamentsRule   : '@ornaments';
//   StylisticRule   : '@stylistic';
//   StylesetRule    : '@styleset';
//   CharacterVarRule: '@character-variant';

/** Match any unknown to figure it out at parsing time */
// MatchUnknown      : . ;

mode Selector;
/** Un-skipped white-space */
Sel_WS            : Whitespace -> type(WS);
Sel_Comma         : Comma -> type(Comma);

Sel_Star          : Star -> type(Star);
Sel_Amp           : Ampersand -> type(Ampersand);
Sel_ID            : ID -> type(ID);
Sel_Class         : Class -> type(Class);
Sel_Ident         : Ident -> type(Ident);
Sel_PseudoNth     : PseudoNth -> type(PseudoNth);
Sel_Pseudo        : Pseudo -> type(Pseudo);
Sel_Attribute     : Attribute -> type(Attribute);

Sel_Combinator    : Combinator -> type(Combinator);
Sel_LCurly        : LCurly -> type(LCurly), popMode, pushMode(DeclarationList);

mode DeclarationList;

DList_WS          : Whitespace -> channel(HIDDEN);
DList_Comma       : Comma -> type(Comma);

DList_Star        : Star -> pushMode(Selector), type(Star);
DList_Amp         : Ampersand -> pushMode(Selector), type(Ampersand);
DList_ID          : ID -> pushMode(Selector), type(ID);
DList_Class       : Class -> pushMode(Selector), type(Class);
// DeclarationList_Element -- not valid
DList_PseudoNth   : PseudoNth -> pushMode(Selector), type(PseudoNth);
DList_Pseudo      : Pseudo -> pushMode(Selector), type(Pseudo);
DList_Attribute   : Attribute -> pushMode(Selector), type(Attribute);

/** Can start with a combinator in some modes */
DList_Combinator  : Combinator -> pushMode(Selector), type(Combinator);


DList_CustomProp  : '--' NmStart NmChar* WS* ':' -> pushMode(CustomPropertyValue);
DList_Property    : Ident WS* ':' -> pushMode(Values);

Dlist_RCurly      : RCurly -> type(RCurly), popMode;

/** "Component values" */
mode Values;

Val_WS                : WS -> channel(HIDDEN);
Val_SignedInteger     : SignedInteger -> type(SignedInteger);
Val_UnsignedInteger   : UnsignedInteger -> type(UnsignedInteger);

Val_SignedNumber      : SignedNumber -> type(SignedNumber);
Val_UnsignedNumber    : UnsignedNumber -> type(UnsignedNumber);

Val_SignedDimension   : SignedDimension -> type(SignedDimension);
Val_UnsignedDimension : UnsignedDimension -> type(UnsignedDimension);

Val_Comma       : Comma -> type(Comma);
Url             : 'url(' WS* (UrlFragment | Escape)* | SingleString | DoubleString WS* ')';
Function        : Ident '(' -> pushMode(Values);
PlainIdent      : Ident -> type(Ident);
CustomIdent     : '--' NmStart NmChar*;

Val_String      : String -> type(String);
Val_Semi        : Semi -> type(Semi), popMode;

CompareOp       : ('>' | '<') '='? | '=';

/** Math operations */
Plus        : '+';
Minus       : '-';
Divide      : '/';
Multiply    : '*';

Val_LCurly  : LCurly -> type(LCurly), pushMode(Values);
LParen      : '(' -> pushMode(Values);
LSquare     : '[' -> pushMode(Values);

RParen      : ')' -> popMode;
RSquare     : ']' -> popMode;
Val_RCurly  : RCurly -> type(RCurly), popMode;


mode CustomPropertyValue;

/** Just needs matching blocks */
Custom_Value
  : ~[{(['"]+
  | String
  | '{' Custom_Value? '}'
  | '[' Custom_Value? ']'
  | '(' Custom_Value? ')'
  ;

Custom_Semi       : ';' -> type(Semi), popMode;
Custom_RCurly     : RCurly ->type(RCurly);









