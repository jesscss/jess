/**
 * references:
 * https://github.com/antlr/grammars-v4/blob/master/css3/css3.g4
 * https://www.lifewire.com/css2-vs-css3-3466978
 * https://www.w3.org/TR/css-syntax-3/
 * https://github.com/jesscss/jess/blob/master/packages/css-parser/src/cssTokens.ts
 */
lexer grammar CssLexer;

// options { caseInsensitive=true; }

/**
  Formatted like Java example lexer / parser
  https://github.com/antlr/grammars-v4/blob/master/java/java/JavaLexer.g4
*/

/** Keywords */
AND:                  'and';
OR:                   'or';
NOT:                  'not';
ONLY:                 'only';
ATTRIBUTE_FLAG:       'i' | 's';

/**
 * CSS syntax says we should identify integers as separate from numbers,
 * probably because there are parts of the syntax where one is allowed but not the other?
 */
/** Separate for easy token identification during parsing */
UNSIGNED_INTEGER:     Integer;
SIGNED_INTEGER:       Sign UNSIGNED_INTEGER;

/** Any number that's not simply an integer e.g. 1.1 or 1e+1 */
UNSIGNED_NUMBER:      Digit* '.' Integer Exp? | Integer Exp?;
SIGNED_NUMBER:        Sign UNSIGNED_NUMBER;

UNSIGNED_DIMENSION:   UNSIGNED_NUMBER IDENT;
SIGNED_DIMENSION:     SIGNED_NUMBER IDENT;

UNSIGNED_PERCENTAGE:  UNSIGNED_NUMBER '%';
SIGNED_PERCENTAGE:    SIGNED_NUMBER '%';

/** Simple Selectors */
AMPERSAND:            '&';

// We need to separate IDs in general lexing because
// some may be valid colors.

// Colors can have 3, 4, 6, or 8 hex values
// These are valid ID selectors
COLOR_IDENT_START
  : '#' [a-fA-F] ColorValueRemainder;

// These are not valid ID selectors
COLOR_INT_START
  : '#' [0-9] ColorValueRemainder;

fragment ColorValueRemainder
  : Hex Hex (Hex (Hex Hex (Hex Hex)?)?)?
  ;

// Anything else is lexed as an ID selector
ID:                   '#' IDENT;

CLASS:                '.' IDENT;

/** Mark these for special recognition of nth syntax */
NTH_PSEUDO_CLASS
  : COLON (
    'nth-child'
    | 'nth-last-child'
    | 'nth-of-type'
    | 'nth-last-of-type'
  )
  ;

/** These pseudo-classes accept a selector list or forgiving selector list as a parameter. */
FUNCTIONAL_PSEUDO_CLASS
  : COLON (
    'is'
    | 'not'
    | 'where'
    | 'has'
  )
  ;


/** Combinators and Operators */

// Math(multiplication) and all elements
STAR:                 '*';

// Math(divide) and values separator
SLASH:                '/';

// sibling combinator
TILDE:                '~';

// Greater than and child combinator
GT:                   '>';

// Used in media queries Level 4
LT:                   '<';
GTE:                  '>=';
LTE:                  '<=';
EQ:                   '=';

// Math(addition) and adjacent sibling
PLUS:                 '+';

MINUS:                '-';

// Column
COLUMN:               '||';

CARET:                '^';
DOLLAR:               '$';
PIPE:                 '|';

// Assignment or pseudo start
COLON:                ':';

NTH_ODD:              'odd';
NTH_EVEN:             'even';

/** Separators */
SEMI:                 ';';
LCURLY:               '{';
RCURLY:               '}';
LPAREN:               '(';
RPAREN:               ')';
LSQUARE:              '[';
RSQUARE:              ']';
COMMA:                ',';

/** Strings */
STRING:               DoubleString | SingleString;

/** At Rules */
/** Non-nested */
CHARSET:              '@charset' WS STRING ';' -> channel(HIDDEN);
IMPORT_RULE:          '@import';
NAMESPACE_RULE:       '@namespace';

/** Nested */
MEDIA_RULE:           '@media';
SUPPORTS_RULE:        '@supports';
PAGE_RULE:            '@page';
FONT_FACE_RULE:       '@font-face';
KEYFRAMES_RULE:       '@keyframes';
CONTAINER_RULE:       '@container';
PROPERTY_RULE:        '@property';
LAYER_RULE:           '@layer';
SCOPE_RULE:           '@scope';

// Parse specifically later?
// CounterStyleRule  : '@counter-style';
// FontFeatureRule   : '@font-feature-values';
//   SwashRule       : '@swash';
//   AnnotationRule  : '@annotation';
//   OrnamentsRule   : '@ornaments';
//   StylisticRule   : '@stylistic';
//   StylesetRule    : '@styleset';
//   CharacterVarRule: '@character-variant';

/** CSS allows any at-rule definition */
AT_RULE:              '@' IDENT;

/** Special-case function */
URL_FUNCTION:         'url(' WS* ((UrlFragment | Escape)* | STRING) WS* ')';
SUPPORTS_FUNCTION:    'supports(';
FUNCTION:             IDENT '(';
/**
  We consume the ident + custom value because it doesn't
  parse into individual tokens.

  Another approach might be to open a new mode
*/
CUSTOM_IDENT
  : '--' NmStart NmChar* -> pushMode(PossibleCustomDeclaration)
  ;

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

/** Must come after keywords */
IDENT:                '-'? NmStart NmChar*;

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

// Start searching for a colon after a custom property
// If found, we'll gobble the whole value at once
mode PossibleCustomDeclaration;

POS_WS:               WS -> skip;
POS_COLON:            COLON -> type(COLON), popMode, pushMode(CustomDeclaration);

UNKNOWN:              . -> popMode, more;

mode CustomDeclaration;

INNER_CUSTOM_VALUE
  : ~[{(['"]+
  | STRING+
  | '{' INNER_CUSTOM_VALUE*? '}'
  | '[' INNER_CUSTOM_VALUE*? ']'
  | '(' INNER_CUSTOM_VALUE*? ')'
  ;

/** Matching blocks and no outer ';' */
CUSTOM_VALUE
  : ~[{(['";]+
  | STRING+
  | '{' INNER_CUSTOM_VALUE*? '}'
  | '[' INNER_CUSTOM_VALUE*? ']'
  | '(' INNER_CUSTOM_VALUE*? ')'
  ;

CUSTOM_SEMI:          SEMI -> type(SEMI), popMode;
CUSTOM_RCURLY:        RCURLY -> type(RCURLY), popMode;


// fragment NthSyntax   : 'odd' | 'even' | Integer | Integer? [nN] (WS* [+-] WS* Digit)?;
// PseudoNth   : ':' NthFunctions '(' WS* NthSyntax WS* ')' -> pushMode(Selector);
// Pseudo      : ':' ':'? Ident ('(' .*? ')')? -> pushMode(Selector);
// /** @todo - lookup */
// Attribute   : LSquare WS* Ident [*~|^$]? ('=') WS* (Ident | String) WS* ([is] WS*)? RSquare -> pushMode(Selector);

/** Match any unknown to figure it out at parsing time */
// MatchUnknown      : . ;
