/**
 * Shared macro-fused CSS recognition terminals for direct canonical-AST
 * dialect parsers.
 *
 * Consumers macro-fuse this compiled artifact with their local reductions. It
 * contains recognition only: no AST construction or runtime composition seam.
 */
import { regex, rules } from 'parseman' with { type: 'macro' };

const propertyName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const keywordValue = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const doubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const singleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const urlOpen = regex(/url\(/i);
const urlInner = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// Jess's direct static import target deliberately reserves `$` forms for its
// own grammar. Keep this as a macro-recognition leaf, not a parser-local text
// scan, so `url($path)` / `url($[path])` cannot reach a URL reducer.
const staticUrlInner = regex(/(?:[^"'()\\$ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);
const pseudoColon = regex(/::?/);
const attributeOperator = regex(/[*~|^$]?=/);
const attributeModifier = regex(/[a-zA-Z]/);
const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);
// When a pseudo argument begins like an An+B expression, malformed numeric
// forms must not fall through to the generic raw pseudo-argument capture.
// Keep this recognition fact shared and macro-fused: dialect reductions can
// reject the malformed prefix before their otherwise lossless raw arm.
const malformedPseudoNumericArgument = regex(/(?:[-+]?\d*\.\d|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*(?:\)|[^0-9 \t\n\r\f]|\d+[_a-zA-Z\u0080-\uffff\\])))/i);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const scssLineComment = regex(/\/\/[^\n\r]*/);
// A closed SCSS media/container fallback for legacy static modifiers such as
// `only screen`. This is exactly the public grammar's `scssStrictRun`: paired
// groups, strings, and interpolation have their own grammar productions, while
// a top-level `$` or `;` must stop the run rather than become opaque AST text.
const scssStaticMediaModifier = regex(/(?:[^${}()\[\];"'#]|#(?!\{))+/);
// CSS and SCSS priority matching is ASCII-case-insensitive. Direct dialect
// grammars own the surrounding `!` and AST reduction.
const important = regex(/important/i);
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
// CSS at-keywords are ASCII-case-insensitive. Dialect reductions own the
// header/body shape; these leaves only establish the keyword boundary.
const conditionalAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
// Conditional groups do not share one prelude grammar: media/container admit
// a media-query list while @supports admits a supports-condition only.  Keep
// that dispatch fact macro-fused with the lexical leaves so direct reductions
// cannot accidentally route a bare media keyword through @supports.
const mediaContainerAtKeyword = regex(/@(?:media|container)(?![-\w])/i);
const mediaAtKeyword = regex(/@media(?![-\w])/i);
const containerAtKeyword = regex(/@container(?![-\w])/i);
const supportsAtKeyword = regex(/@supports(?![-\w])/i);
const startingStyleAtKeyword = regex(/@starting-style(?![-\w])/i);
// Retain the current public CSS grammar's ASCII `\\w` boundaries exactly.
// This accepts a Unicode character after the keyword (for example `@pageé`),
// which is legacy parser behavior to preserve during the direct-route cutover.
const pageAtKeyword = regex(/@page(?![-\w])/i);
const marginAtKeyword = regex(/@(?:top-(?:left-corner|left|center|right-corner|right)|bottom-(?:left-corner|left|center|right-corner|right)|left-(?:top|middle|bottom)|right-(?:top|middle|bottom))(?![-\w])/i);
const queryNot = regex(/not(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const queryOnly = regex(/only(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const queryAndOr = regex(/(?:and|or)(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
// The comparison terminal is shared by every direct media/container reducer.
// Dialects supply their own typed value production, but the CSS range spelling
// itself must not drift into parser-local scanner logic.
const queryComparisonOperator = regex(/<=|>=|<|=|>/);
const queryFunctionName = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*(?=\()/);
const scopeAtKeyword = regex(/@scope(?![-\w])/i);
const descriptorAtKeyword = regex(/@(?:font-face|counter-style|property|color-profile|font-palette-values|position-try|view-transition)(?![-\w])/i);
const documentAtKeyword = regex(/@(?:-moz-)?document(?![-\w])/i);
const layerAtKeyword = regex(/@layer(?![-\w])/i);
const keyframesAtKeyword = regex(/@(?:-[a-z]+-)?keyframes(?![-\w])/i);
const statementAtRuleName = regex(/@(?!(?:import)(?=[^-_a-zA-Z0-9\u0080-\uffff]|$))-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
// Opaque blocks are the public grammar's unknown-at-rule branch. Known block
// names must not fall through here when their typed header/body is malformed:
// the public CST reports that error instead of silently making it opaque.
const genericAtRuleName = regex(/@(?!(?:import|media|container|supports|starting-style|page|scope|font-face|counter-style|property|color-profile|font-palette-values|position-try|view-transition|-moz-document|document|font-feature-values|layer|(?:-[a-z]+-)?keyframes)(?=[^-\w]|$))-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
// Preserve the public CSS grammar's legacy ASCII boundary. In particular,
// `@font-feature-valuesé` is the recognized at-keyword followed by a prelude
// beginning with `é`, not a distinct at-keyword.
const fontFeatureValuesAtKeyword = regex(/@font-feature-values(?![-\w])/i);
const fontFeatureValueAtKeyword = regex(/@(?:stylistic|styleset|character-variant|swash|ornaments|annotation|historical-forms)(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
// These are byte-for-byte the CSS grammar's numeric terminals.  Consumers own
// their direct Dimension reductions; this artifact only recognizes the split
// number/unit facts, preserving the `-(?![0-9])` boundary for `17px-1px`.
const number = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const dimensionUnit = regex(/-?[_a-zA-Z-￿](?:[_a-zA-Z0-9-￿]|-(?![0-9]))*|%/);
// Less keeps bare identifiers for values, variables, mixins, functions, and
// selectors.  Ordinary declaration names are a distinct grammar position:
// Less's public CST accepts CSS escapes and the legacy `*` property hack
// there, and nowhere does this terminal widen those other positions.
const lessBareIdentifier = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
// Less variable names alone may begin with a digit (`@1`, `@{3}`).  Keep this
// separate from the general identifier leaf so that permission does not leak
// into declaration names, selectors, or ordinary value keywords.
const lessVariableName = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);
// Less's typed CSS color values. This deliberately remains separate from the
// general identifier leaf: the boundary rejects `redder`, `red-2`, and
// `red(...)`. `currentColor` is a CSS-wide keyword, not an RGB color value.
const lessNamedColor = regex(/(?:lightgoldenrodyellow|mediumspringgreen|mediumaquamarine|mediumslateblue|mediumturquoise|mediumvioletred|blanchedalmond|cornflowerblue|darkolivegreen|lightslategray|lightslategrey|lightsteelblue|mediumseagreen|darkgoldenrod|darkslateblue|darkslategray|darkslategrey|darkturquoise|lavenderblush|lightseagreen|palegoldenrod|paleturquoise|palevioletred|rebeccapurple|antiquewhite|darkseagreen|lemonchiffon|lightskyblue|mediumorchid|mediumpurple|midnightblue|darkmagenta|deepskyblue|floralwhite|forestgreen|greenyellow|lightsalmon|lightyellow|navajowhite|saddlebrown|springgreen|transparent|yellowgreen|aquamarine|blueviolet|chartreuse|darkorange|darkorchid|darksalmon|darkviolet|dodgerblue|ghostwhite|lightcoral|lightgreen|mediumblue|papayawhip|powderblue|sandybrown|whitesmoke|aliceblue|burlywood|cadetblue|chocolate|darkgreen|darkkhaki|firebrick|gainsboro|goldenrod|indianred|lawngreen|lightblue|lightcyan|lightgray|lightgrey|lightpink|limegreen|mintcream|mistyrose|olivedrab|orangered|palegreen|peachpuff|rosybrown|royalblue|slateblue|slategray|slategrey|steelblue|turquoise|cornsilk|darkblue|darkcyan|darkgray|darkgrey|deeppink|honeydew|lavender|moccasin|seagreen|seashell|crimson|darkred|dimgray|dimgrey|fuchsia|hotpink|magenta|oldlace|skyblue|thistle|bisque|indigo|maroon|orange|orchid|purple|salmon|sienna|silver|tomato|violet|yellow|azure|beige|black|brown|coral|green|ivory|khaki|linen|olive|wheat|white|aqua|blue|cyan|gold|gray|grey|lime|navy|peru|pink|plum|snow|teal|red|tan)(?![-_a-zA-Z0-9(])/i);
const lessDeclarationProperty = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
// Less detached-ruleset maps admit numeric member names (`@grays: { 100: ... }`).
// Keep this distinct from ordinary CSS declaration properties and value numbers.
const lessNumericMapKey = regex(/[0-9]+/);
// Detached-ruleset maps also use punctuation members for escaped CSS text
// (`@escaped-characters: { <: %3c; #: %23; (: %28; }`).
const lessPunctuationMapKey = regex(/[<>()#]/);
// Percent-encoded CSS bytes in Less maps (`<: %3c`) are literal values, not
// percent-format calls or dimensions.
const lessPercentEscape = regex(/%[0-9a-fA-F]{2}/);
const lessDoubleQuotedText = regex(/[^"\\]*/);
const lessSingleQuotedText = regex(/[^'\\]*/);
// Less direct-AST interpolation terminals. Dialect AST grammars assemble these
// leaves into `@{…}` / `${…}` structures and reduce them to canonical nodes;
// recognition stays macro-fused here rather than becoming parser-local scans.
const lessInterpHead = regex(/-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpBareKey = regex(/[-_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpIndexKey = regex(/[0-9]+/);
// A quoted chunk leaves only a complete strict Less `@{name}` or `${name}`
// interpolation at the cursor for the typed grammar branch. Invalid
// interpolation-shaped text remains literal string content, matching Less's
// quoted-string grammar.
const lessQuotedDoubleChunk = regex(/(?:[^"\\@$]|\\[\s\S]|@(?!\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})|\$(?!\{))+/);
const lessQuotedSingleChunk = regex(/(?:[^'\\@$]|\\[\s\S]|@(?!\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})|\$(?!\{))+/);
// These are CSS identifier segments, shared by every dialect that permits a
// structural interpolation inside a declaration name. Dialects own their
// interpolation delimiters and AST reductions; this artifact only recognizes
// the static CSS-name bytes around those typed segments.
const interpolatedPropertyStart = regex(/(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const interpolatedPropertyTail = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
const lessInterpolatedCustomPropertyStart = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpolatedCustomPropertyDash = regex(/-/);
const lessInterpolatedCustomPropertyTail = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);
const lessInterpolatedValueStart = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpolatedValueDash = regex(/-/);
const lessInterpolatedValueTail = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);
// Custom-property values remain CSS declaration-value text in Less: only a
// strict `@{…}` is a typed Less interpolation.  These leaves deliberately
// exclude balanced delimiters, strings, comments, and a valid interpolation
// opener so the direct Less grammar can retain each of those facts structurally
// rather than scanning a completed value span.
const lessCustomProperty = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
const lessCustomOuterContent = regex(/(?:\\[^\n]|(?!@\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})[^(){}[\];'"\/\\])+|\/(?!\*)/);
const lessCustomInnerContent = regex(/(?:\\[^\n]|(?!@\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})[^(){}[\]'"\/\\])+|\/(?!\*)/);
const lessCustomSingleQuoted = regex(/'(?:[^'\n\\]|\\.)*'/);
const lessCustomDoubleQuoted = regex(/"(?:[^"\n\\]|\\.)*"/);


export const cssAstSyntax = rules(_g => ({
  CssAstSyntaxProperty: propertyName,
  CssAstSyntaxKeyword: keywordValue,
  CssAstSyntaxDoubleQuotedText: doubleQuotedText,
  CssAstSyntaxSingleQuotedText: singleQuotedText,
  CssAstSyntaxUrlOpen: urlOpen,
  CssAstSyntaxUrlInner: urlInner,
  CssAstSyntaxStaticUrlInner: staticUrlInner,
  CssAstSyntaxSimple: simpleSelector,
  CssAstSyntaxPseudoColon: pseudoColon,
  CssAstSyntaxAttributeOperator: attributeOperator,
  CssAstSyntaxAttributeModifier: attributeModifier,
  CssAstSyntaxNth: nth,
  CssAstSyntaxMalformedPseudoNumericArgument: malformedPseudoNumericArgument,
  CssAstSyntaxBlockComment: blockComment,
  ScssAstSyntaxLineComment: scssLineComment,
  ScssAstSyntaxStaticMediaModifier: scssStaticMediaModifier,
  CssAstSyntaxImportant: important,
  CssAstSyntaxHexColor: hexColor,
  CssAstSyntaxConditionalAtKeyword: conditionalAtKeyword,
  CssAstSyntaxMediaContainerAtKeyword: mediaContainerAtKeyword,
  CssAstSyntaxMediaAtKeyword: mediaAtKeyword,
  CssAstSyntaxContainerAtKeyword: containerAtKeyword,
  CssAstSyntaxSupportsAtKeyword: supportsAtKeyword,
  CssAstSyntaxStartingStyleAtKeyword: startingStyleAtKeyword,
  CssAstSyntaxPageAtKeyword: pageAtKeyword,
  CssAstSyntaxMarginAtKeyword: marginAtKeyword,
  CssAstSyntaxQueryNot: queryNot,
  CssAstSyntaxQueryOnly: queryOnly,
  CssAstSyntaxQueryAndOr: queryAndOr,
  CssAstSyntaxQueryComparisonOperator: queryComparisonOperator,
  CssAstSyntaxQueryFunctionName: queryFunctionName,
  CssAstSyntaxScopeAtKeyword: scopeAtKeyword,
  CssAstSyntaxDescriptorAtKeyword: descriptorAtKeyword,
  CssAstSyntaxDocumentAtKeyword: documentAtKeyword,
  CssAstSyntaxLayerAtKeyword: layerAtKeyword,
  CssAstSyntaxKeyframesAtKeyword: keyframesAtKeyword,
  CssAstSyntaxStatementAtRuleName: statementAtRuleName,
  CssAstSyntaxGenericAtRuleName: genericAtRuleName,
  CssAstSyntaxFontFeatureValuesAtKeyword: fontFeatureValuesAtKeyword,
  CssAstSyntaxFontFeatureValueAtKeyword: fontFeatureValueAtKeyword,
  CssAstSyntaxNumber: number,
  CssAstSyntaxDimensionUnit: dimensionUnit,
  CssAstSyntaxInterpolatedPropertyStart: interpolatedPropertyStart,
  CssAstSyntaxInterpolatedPropertyTail: interpolatedPropertyTail
}));

export const lessAstSyntax = rules(_g => ({
  LessAstSyntaxIdentifier: lessBareIdentifier,
  LessAstSyntaxVariableName: lessVariableName,
  LessAstSyntaxProperty: lessBareIdentifier,
  LessAstSyntaxDeclarationProperty: lessDeclarationProperty,
  LessAstSyntaxNumericMapKey: lessNumericMapKey,
  LessAstSyntaxPunctuationMapKey: lessPunctuationMapKey,
  LessAstSyntaxPercentEscape: lessPercentEscape,
  LessAstSyntaxKeyword: lessBareIdentifier,
  LessAstSyntaxNamedColor: lessNamedColor,
  LessAstSyntaxDoubleQuotedText: lessDoubleQuotedText,
  LessAstSyntaxSingleQuotedText: lessSingleQuotedText,
  LessAstSyntaxInterpHead: lessInterpHead,
  LessAstSyntaxInterpBareKey: lessInterpBareKey,
  LessAstSyntaxInterpIndexKey: lessInterpIndexKey,
  LessAstSyntaxQuotedDoubleChunk: lessQuotedDoubleChunk,
  LessAstSyntaxQuotedSingleChunk: lessQuotedSingleChunk,
  LessAstSyntaxInterpolatedCustomPropertyStart: lessInterpolatedCustomPropertyStart,
  LessAstSyntaxInterpolatedCustomPropertyDash: lessInterpolatedCustomPropertyDash,
  LessAstSyntaxInterpolatedCustomPropertyTail: lessInterpolatedCustomPropertyTail,
  LessAstSyntaxInterpolatedValueStart: lessInterpolatedValueStart,
  LessAstSyntaxInterpolatedValueDash: lessInterpolatedValueDash,
  LessAstSyntaxInterpolatedValueTail: lessInterpolatedValueTail,
  LessAstSyntaxCustomProperty: lessCustomProperty,
  LessAstSyntaxCustomOuterContent: lessCustomOuterContent,
  LessAstSyntaxCustomInnerContent: lessCustomInnerContent,
  LessAstSyntaxCustomSingleQuoted: lessCustomSingleQuoted,
  LessAstSyntaxCustomDoubleQuoted: lessCustomDoubleQuoted
}));
