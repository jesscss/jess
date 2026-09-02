/**
 * Shared macro-fused CSS recognition terminals for direct canonical-AST
 * dialect parsers.
 *
 * Consumers macro-fuse this compiled artifact with their local reductions. It
 * contains recognition only: no AST construction or runtime composition seam.
 */
import { choice, keywords, literal, noTrivia, not, optional, regex, rules, sequence, token, word } from 'parseman' with { type: 'macro' };

const cssIdentifier = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const keywordValue = cssIdentifier;
const doubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const singleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const urlOpen = literal(
  'url(',
  { caseInsensitive: true }
);
const urlInner = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);

/* Pseudo names are adjacent to `:`/`::`; ambient trivia must not swallow whitespace here. */
const pseudoColon = regex(/::?(?![ \t\n\r\f])/);
const attributeOperator = keywords(['*=', '~=', '|=', '^=', '$=', '=']);
const attributeModifier = regex(/[a-zA-Z]/);
const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);

/*
 * When a pseudo argument begins like an An+B expression, malformed numeric
 * forms must not fall through to the generic raw pseudo-argument capture.
 * Keep this recognition fact shared and macro-fused: dialect reductions can
 * reject the malformed prefix before their otherwise lossless raw arm.
 */
/*
 * The raw pseudo fallback must not recover malformed `<An+B>` spelling for an
 * `:nth-*` family. In particular, CSS Syntax rejects whitespace that splits a
 * sign, coefficient, or `n` token (`+ n`, `2 n + 2`, `1 - n`). Keep those
 * rejection prefixes beside the existing decimal/dangling-tail guards; the
 * consuming grammars apply this gate only to the `:nth-*` pseudo family, so
 * unknown functional pseudos retain their ordinary `<any-value>` arguments.
 *
 * Derived from WPT css/css-syntax/anb-parsing.html at
 * a95401e4e06351eb1e15f0e15cf50abf08fa545f.
 */
const malformedPseudoNumericArgument = regex(/(?:[-+]?\d*\.\d|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*(?:\)|[^0-9 \t\n\r\f]|\d+[_a-zA-Z\u0080-\uffff\\]))|[+-][ \t\n\r\f]+(?:\d*n|n)|[-+]?\d+[ \t\n\r\f]+n|[-+]?\d+[ \t\n\r\f]*[+-][ \t\n\r\f]*n)/i);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);

/*
 * A closed SCSS media/container fallback for legacy static modifiers such as
 * `only screen`. This is exactly the public grammar's `scssStrictRun`: paired
 * groups, strings, and interpolation have their own grammar productions, while
 * a top-level `$` or `;` must stop the run rather than become opaque AST text.
 */
const mediaModifier = regex(/(?:[^${}()\[\];"'#]|#(?!\{))+/);

/*
 * CSS and SCSS priority matching is ASCII-case-insensitive. Direct dialect
 * grammars own the surrounding `!` and AST reduction.
 */
const important = word(
  'important',
  '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
  { caseInsensitive: true }
);
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);

/*
 * A CSS `<urange>` (`U+26`, `U+0-7F`, `U+0025-00FF`, `U+4??`) is ONE lexical
 * terminal — css-syntax-3 §4.4 consumes it as a unicode-range token before any
 * numeric token, so the `+`/`-` inside it are never operators or signs.
 * @see https://drafts.csswg.org/css-syntax/#urange-syntax
 * Without this fact a dialect re-reads `+0`/`-7F` as signed numbers and turns
 * valid CSS into arithmetic or a space list, silently emitting `U + 0 - 7F`.
 * Recognition only: dialect reductions own the verbatim value node.
 */
const unicodeRange = regex(/[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?/);

/*
 * The one at-keyword boundary. An at-keyword is `@` followed by an
 * ident-sequence, and CSS Syntax L3 §4.3.11 makes every code point >= U+0080 an
 * ident code point, so a keyword only ends where a NON-ident code point starts.
 * Spelling this ASCII-only (`-_0-9A-Za-z`, or the `\w` that means the same
 * thing) drops U+0080-U+FFFF -- 65,408 code points -- and cuts at-keywords in
 * half mid-ident. Every recognizer below shares this const: the set of at-rule
 * names is declared once per name, and both polarities come from `not()`.
 */
const AT_KEYWORD_BOUNDARY = '-_a-zA-Z0-9\\u0080-\\uFFFF';

/*
 * CSS at-keywords are ASCII-case-insensitive. Dialect reductions own the
 * header/body shape; these leaves only establish the keyword boundary.
 */
const conditionalAtKeyword = keywords(
  ['@media', '@container', '@supports'],
  { caseInsensitive: true, boundary: AT_KEYWORD_BOUNDARY }
);

/*
 * Conditional groups do not share one prelude grammar: media/container admit
 * a media-query list while @supports admits a supports-condition only.  Keep
 * that dispatch fact macro-fused with the lexical leaves so direct reductions
 * cannot accidentally route a bare media keyword through @supports.
 */
const mediaContainerAtKeyword = keywords(
  ['@media', '@container'],
  { caseInsensitive: true, boundary: AT_KEYWORD_BOUNDARY }
);
const mediaAtKeyword = word(
  '@media',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);
const containerAtKeyword = word(
  '@container',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);
const supportsAtKeyword = word(
  '@supports',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);
const startingStyleAtKeyword = word(
  '@starting-style',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);

/*
 * `@pageé` is ONE at-keyword, not `@page` plus a prelude starting with `é`.
 * The older ASCII boundary here split it, and that split is superseded --
 * see DESIGN-DECISIONS.md P20. Do not restore `-_0-9A-Za-z` on the authority
 * of a comment that predates the ruling.
 */
const pageAtKeyword = word(
  '@page',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);
const marginAtKeyword = keywords(
  [
    '@top-left-corner',
    '@top-left',
    '@top-center',
    '@top-right-corner',
    '@top-right',
    '@bottom-left-corner',
    '@bottom-left',
    '@bottom-center',
    '@bottom-right-corner',
    '@bottom-right',
    '@left-top',
    '@left-middle',
    '@left-bottom',
    '@right-top',
    '@right-middle',
    '@right-bottom'
  ],
  { caseInsensitive: true, boundary: AT_KEYWORD_BOUNDARY }
);
const queryNot = word(
  'not',
  '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
  { caseInsensitive: true }
);
const queryOnly = word(
  'only',
  '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
  { caseInsensitive: true }
);
const queryAndOr = keywords(
  ['and', 'or'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\' }
);

/*
 * The comparison terminal is shared by every direct media/container reducer.
 * Dialects supply their own typed value production, but the CSS range spelling
 * itself must not drift into parser-local scanner logic.
 */
const queryComparisonOperator = keywords(['<=', '>=', '<', '=', '>']);
const queryFunctionName = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*(?=\()/);
const queryFunctionOpen = noTrivia(sequence(
  cssIdentifier,
  literal('(')
));
const scopeAtKeyword = word(
  '@scope',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);

/*
 * The descriptor at-rules every dialect gives a typed header/body.
 */
const descriptorAtKeywordTyped = keywords(
  ['@font-face', '@counter-style', '@property'],
  { caseInsensitive: true, boundary: AT_KEYWORD_BOUNDARY }
);

/*
 * Descriptor at-rules only the CSS grammar routes. Split out because a dialect
 * must exclude from its generic/opaque branch ONLY the names it actually has a
 * typed route for: excluding a name it cannot otherwise parse makes that at-rule
 * unparseable rather than better-diagnosed. SCSS routes the three above and none
 * of these four, so it inverts `descriptorAtKeywordTyped` and lets these reach
 * its opaque branch. Still one declaration per name — `descriptorAtKeyword`
 * below is the union, so CSS's typed set is unchanged.
 */
const descriptorAtKeywordCssOnly = keywords(
  ['@color-profile', '@font-palette-values', '@position-try', '@view-transition'],
  { caseInsensitive: true, boundary: AT_KEYWORD_BOUNDARY }
);
const descriptorAtKeyword = choice(descriptorAtKeywordTyped, descriptorAtKeywordCssOnly);
const documentAtKeyword = keywords(
  ['@-moz-document', '@document'],
  { caseInsensitive: true, boundary: AT_KEYWORD_BOUNDARY }
);
const layerAtKeyword = word(
  '@layer',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);
const keyframesAtKeyword = regex(/@(?:-[a-z]+-)?keyframes(?![-_a-zA-Z0-9\u0080-\uFFFF])/i);

/*
 * `@font-feature-valuesé` is ONE at-keyword. The older ASCII boundary read it
 * as `@font-feature-values` plus a prelude beginning with `é`; that reading is
 * superseded -- see DESIGN-DECISIONS.md P20.
 */
const fontFeatureValuesAtKeyword = word(
  '@font-feature-values',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);
const importAtKeyword = word(
  '@import',
  AT_KEYWORD_BOUNDARY,
  { caseInsensitive: true }
);

/*
 * `@` followed by an ident-sequence (css-syntax-3 §4.3.11), with no name
 * excluded. The recognizers below carve subsets out of this by composing
 * `not()` over the SAME leaves that define those names positively, so a name is
 * spelled exactly once in this file and cannot drift between polarities.
 */
const atIdentifier = regex(/@-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);

/*
 * The Less at-rule-name body, which does NOT admit CSS escapes: Less keeps
 * `@\\63 olor` out of the at-rule-name position on purpose. Same §4.3.11
 * boundary, narrower body -- a different lexical class, not a second copy of
 * the at-rule NAME SET.
 */
const atIdentifierUnescaped = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);

/*
 * Every at-rule name with a typed header/body. `keywords()` compiles each list
 * to a single sticky regex, so this is an 8-arm choice over 15 names, and it is
 * the ONE place the typed set is enumerated: `atRuleKeyword` matches it and
 * `genericAtRuleName` excludes it, both reading this same const.
 */
const typedAtKeyword = choice(
  descriptorAtKeyword,
  documentAtKeyword,
  fontFeatureValuesAtKeyword,
  keyframesAtKeyword,
  startingStyleAtKeyword,
  pageAtKeyword,
  scopeAtKeyword,
  layerAtKeyword
);

/*
 * `typedAtKeyword` minus the descriptor at-rules only CSS routes. A dialect
 * inverts THIS when it implements every typed at-rule except those four, so it
 * still spells no at-rule name of its own — see `descriptorAtKeywordCssOnly`.
 */
const typedAtKeywordSharedRoutes = choice(
  descriptorAtKeywordTyped,
  documentAtKeyword,
  fontFeatureValuesAtKeyword,
  keyframesAtKeyword,
  startingStyleAtKeyword,
  pageAtKeyword,
  scopeAtKeyword,
  layerAtKeyword
);

const statementAtRuleName = token(noTrivia(sequence(
  not(importAtKeyword),
  atIdentifier
)));

/*
 * Unknown-at-rule blocks are the public grammar's unknown-at-rule branch. Known block
 * names must not fall through here when their typed header/body is malformed:
 * the public CST reports that error instead of silently making it opaque.
 */
const genericAtRuleName = token(noTrivia(sequence(
  not(typedAtKeyword),
  not(conditionalAtKeyword),
  not(importAtKeyword),
  atIdentifier
)));

/*
 * One opener for dispatching typed/generic at-rules after `@import` and
 * conditional groups have already been handled. The typed arm comes first and
 * the unrestricted arm last, so ORDERED CHOICE carries the "specific before
 * general" constraint that used to be hand-encoded as a lookahead name list.
 */
const atRuleKeyword = token(noTrivia(choice(
  typedAtKeyword,
  sequence(
    not(conditionalAtKeyword),
    not(importAtKeyword),
    atIdentifier
  )
)));
const fontFeatureValueAtKeyword = keywords(
  [
    '@stylistic',
    '@styleset',
    '@character-variant',
    '@swash',
    '@ornaments',
    '@annotation',
    '@historical-forms'
  ],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\' }
);

/*
 * These are byte-for-byte the CSS grammar's numeric terminals.  Consumers own
 * their direct Dimension reductions; this artifact only recognizes the split
 * number/unit facts, preserving the `-(?![0-9])` boundary for `17px-1px`.
 */
const number = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const dimensionUnit = regex(/-?[_a-zA-Z\u0080-\uFFFF](?:[_a-zA-Z0-9\u0080-\uFFFF]|-(?![0-9]))*|%/);

/*
 * Less keeps bare identifiers for values, variables, mixins, functions, and
 * selectors.  Ordinary declaration names are a distinct grammar position:
 * Less's public CST accepts CSS escapes and the legacy `*` property hack
 * there, and nowhere does this terminal widen those other positions.
 */
const lessBareIdentifier = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);

/*
 * Keep legacy Less variable names (`@1`, `@{3}`, `@-`) recognizable here so
 * dialect parsers can reject retired syntax with precise diagnostics. This
 * stays separate from the general identifier leaf so that permissive recovery
 * does not leak into declaration names, selectors, or ordinary value keywords.
 */
const lessVariableName = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);

const lessDeclarationProperty = token(noTrivia(sequence(
  optional(literal('*')),
  cssIdentifier
)));

/*
 * Less detached-ruleset maps admit numeric member names (`@grays: { 100: ... }`).
 * Keep this distinct from ordinary CSS declaration properties and value numbers.
 */
const lessNumericMapKey = regex(/[0-9]+/);

/*
 * Detached-ruleset maps also use punctuation members for escaped CSS text
 * (`@escaped-characters: { <: %3c; #: %23; (: %28; }`).
 */
const lessPunctuationMapKey = regex(/[<>()#]/);

/*
 * Percent-encoded CSS bytes in Less maps (`<: %3c`) are literal values, not
 * percent-format calls or dimensions.
 */
const lessPercentEscape = regex(/%[0-9a-fA-F]{2}/);

/*
 * Less direct-AST interpolation terminals. Dialect AST grammars assemble these
 * leaves into `@{…}` / `${…}` structures and reduce them to canonical nodes;
 * recognition stays macro-fused here rather than becoming parser-local scans.
 */
const lessInterpHead = regex(/-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpBareKey = regex(/[-_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpIndexKey = regex(/[0-9]+/);

/*
 * A quoted chunk leaves only a complete strict Less `@{name}` or `${name}`
 * interpolation at the cursor for the typed grammar branch. Invalid
 * interpolation-shaped text remains literal string content, matching Less's
 * quoted-string grammar.
 */
const lessQuotedDoubleChunk = regex(/(?:[^"\\@$]|\\[\s\S]|@(?!\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})|\$(?!\{))+/);
const lessQuotedSingleChunk = regex(/(?:[^'\\@$]|\\[\s\S]|@(?!\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})|\$(?!\{))+/);

/*
 * These are CSS identifier segments, shared by every dialect that permits a
 * structural interpolation inside a declaration name. Dialects own their
 * interpolation delimiters and AST reductions; this artifact only recognizes
 * the static CSS-name bytes around those typed segments.
 */
const interpolatedPropertyStart = regex(/(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const interpolatedPropertyTail = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

/*
 * A CSS custom-property name is a `<dashed-ident>`: `--` followed by ident code
 * points. css-syntax-3 §4.3.9 only inspects the two code points after a leading
 * `-`, so a digit or a further `-` right after the prefix still starts an ident
 * — `--0` and `---x` are ordinary custom properties, not malformed names. The
 * one exclusion is `--` itself, which css-variables-1 §2 reserves for future use
 * by CSS; requiring at least one trailing ident code point rejects it here so a
 * dialect falls through to its ordinary property (and error) path.
 */
const customPropertyName = regex(/--(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

/*
 * A custom-property value is a CSS `<declaration-value>` (css-syntax-3 §7.2):
 * any token sequence without a bad string/url, an unmatched close delimiter, or
 * a top-level `;`. Balanced groups, strings, and comments are grammar structure
 * at the consumer, so these content runs stop at every delimiter and let the
 * consumer's own production own those bytes. They also stop before an
 * interpolation opener (`#{`, `${`, `$[`, `$(`) so a dialect's typed
 * interpolation reaches its own production instead of being swallowed as text;
 * a lone `#`/`$` that opens nothing is still ordinary content, and a lone `/`
 * that does not open a comment is matched here rather than halting the run.
 * The inner variant drops `;` from the stop set: inside a balanced group a
 * semicolon is ordinary content, not a declaration terminator.
 * The outer leaf additionally stops before a *trailing* `!important`: css-syntax-3
 * §5.5.6 removes that marker and sets the declaration's priority flag before the
 * custom-property original-text step, so it is never part of the preserved value.
 * The guard leads with `[ \t\n\r\f]*` so the run also stops before the whitespace
 * that precedes `!` (the value keeps no trailing space), and requires `[;}]` after
 * the marker so a non-final `!important` stays ordinary value text. Only the outer
 * leaf carries this: inside a balanced group the marker is never the declaration's.
 * The `i` flag is inert for the rest of the pattern — its remaining classes are
 * punctuation or already span both cases.
 */
const customOuterContent = regex(/(?:(?![ \t\n\r\f]*!(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*important(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*[;}])(?:\\[^\n\r\f]|[^(){}[\];'"\\/#$]|\/(?!\*)|#(?!\{)|\$(?![[({])))+/i);
const customInnerContent = regex(/(?:\\[^\n\r\f]|[^(){}[\]'"\\/#$]|\/(?!\*)|#(?!\{)|\$(?![[({]))+/);
const customSingleQuoted = regex(/'(?:[^'\n\\]|\\.)*'/);
const customDoubleQuoted = regex(/"(?:[^"\n\\]|\\.)*"/);
const lessInterpolatedCustomPropertyStart = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpolatedCustomPropertyDash = regex(/-/);
const lessInterpolatedCustomPropertyTail = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);
const lessInterpolatedValueStart = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterpolatedValueDash = regex(/-/);
const lessInterpolatedValueTail = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);

/*
 * Custom-property values remain CSS declaration-value text in Less, except for
 * Less variable references that Less evaluates inside those values. These leaves
 * deliberately exclude balanced delimiters, strings, comments, strict `@{…}`
 * interpolation, and raw `@name`-shaped tokens so the direct Less grammar can
 * decide whether the token is a literal at-keyword or a structural variable
 * reference instead of scanning a completed value span.
 * Less's own custom-property leaf. It differs from the shared CSS one only by
 * leaving escapes to the Less custom-property content leaves below. The `+`
 * (not `*`) keeps the reserved bare `--` out, matching css-variables-1 §2 and
 * the other three dialects.
 */
const lessCustomProperty = regex(/--[-_a-zA-Z0-9\u0080-\uffff]+/);

/*
 * The outer leaf additionally stops before a *trailing* `!important`: css-syntax-3
 * §5.5.6 removes that marker and sets the declaration's priority flag before the
 * custom-property original-text step, so it is never part of the preserved value.
 * The guard leads with `[ \t\n\r\f]*` so the run also stops before the whitespace
 * that precedes `!` (the value keeps no trailing space), and requires `[;}]` after
 * the marker so a non-final `!important` stays ordinary value text. Only the outer
 * leaf carries this: inside a balanced group the marker is never the declaration's.
 * The `i` flag is inert for the rest of the pattern — its remaining classes are
 * punctuation or already span both cases.
 */
const lessCustomOuterContent = regex(/(?:(?![ \t\n\r\f]*!(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*important(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*[;}])(?:\\[^\n]|(?!@\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})(?!@[-_a-zA-Z0-9\u0080-\uffff]+)[^(){}[\];'"\/\\]))+|\/(?!\*)/i);
const lessCustomInnerContent = regex(/(?:\\[^\n]|(?!@\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\})(?!@[-_a-zA-Z0-9\u0080-\uffff]+)[^(){}[\]'"\/\\])+|\/(?!\*)/i);
const lessCustomSingleQuoted = regex(/'(?:[^'\n\\]|\\.)*'/);
const lessCustomDoubleQuoted = regex(/"(?:[^"\n\\]|\\.)*"/);
export const cssSyntax = rules(_g => ({
  Identifier: keywordValue,
  AttributeOperator: attributeOperator,
  AttributeModifier: attributeModifier,
  DoubleQuotedText: doubleQuotedText,
  SingleQuotedText: singleQuotedText,
  UrlOpen: urlOpen,
  UrlInner: urlInner,
  SimpleSelectorToken: simpleSelector,
  PseudoSelectorColon: pseudoColon,
  NthExpression: nth,
  MalformedPseudoSelectorNumericArgument: malformedPseudoNumericArgument,
  BlockCommentToken: blockComment,
  LineComment: lineComment,
  MediaModifier: mediaModifier,
  ImportantToken: important,
  HexColor: hexColor,
  UnicodeRangeToken: unicodeRange,
  ConditionalAtKeyword: conditionalAtKeyword,
  MediaContainerAtKeyword: mediaContainerAtKeyword,
  MediaAtKeyword: mediaAtKeyword,
  ContainerAtKeyword: containerAtKeyword,
  SupportsAtKeyword: supportsAtKeyword,
  StartingStyleAtKeyword: startingStyleAtKeyword,
  PageAtKeyword: pageAtKeyword,
  MarginAtKeyword: marginAtKeyword,
  QueryNot: queryNot,
  QueryOnly: queryOnly,
  QueryAndOr: queryAndOr,
  QueryComparisonOperator: queryComparisonOperator,
  QueryFunctionName: queryFunctionName,
  QueryFunctionOpen: queryFunctionOpen,
  ScopeAtKeyword: scopeAtKeyword,
  DescriptorAtKeyword: descriptorAtKeyword,
  DocumentAtKeyword: documentAtKeyword,
  LayerAtKeyword: layerAtKeyword,
  KeyframesAtKeyword: keyframesAtKeyword,
  StatementAtRuleName: statementAtRuleName,
  GenericAtRuleName: genericAtRuleName,
  AtRuleKeyword: atRuleKeyword,

  /*
   * Exposed so dialects that add their OWN at-rule names can exclude the CSS
   * set by composing `not()` over these, instead of re-spelling the names.
   */
  TypedAtKeyword: typedAtKeyword,
  TypedAtKeywordSharedRoutes: typedAtKeywordSharedRoutes,
  ImportAtKeyword: importAtKeyword,
  AtIdentifier: atIdentifier,
  FontFeatureValuesAtKeyword: fontFeatureValuesAtKeyword,
  FontFeatureValueAtKeyword: fontFeatureValueAtKeyword,
  NumberToken: number,
  DimensionUnit: dimensionUnit,
  InterpolatedPropertyStart: interpolatedPropertyStart,
  InterpolatedPropertyTail: interpolatedPropertyTail,
  CustomPropertyName: customPropertyName,
  CustomPropertyToken: customPropertyName,
  CustomOuterContent: customOuterContent,
  CustomInnerContent: customInnerContent,
  CustomSingleQuoted: customSingleQuoted,
  CustomDoubleQuoted: customDoubleQuoted
}));

export const lessSyntax = rules(_g => ({
  /* Same shared at-keyword leaves as cssSyntax: Less inverts these rather than
   * re-spelling the CSS at-rule names. */
  ConditionalAtKeyword: conditionalAtKeyword,
  LayerAtKeyword: layerAtKeyword,
  KeyframesAtKeyword: keyframesAtKeyword,
  ImportAtKeyword: importAtKeyword,
  AtIdentifier: atIdentifier,
  AtIdentifierUnescaped: atIdentifierUnescaped,
  LessIdentifier: lessBareIdentifier,
  VariableNameToken: lessVariableName,
  DeclarationPropertyToken: lessDeclarationProperty,
  NumericMapKeyToken: lessNumericMapKey,
  PunctuationMapKeyToken: lessPunctuationMapKey,
  PercentEscapeToken: lessPercentEscape,
  ValueIdentifier: lessBareIdentifier,
  InterpolationHead: lessInterpHead,
  InterpolationKey: lessInterpBareKey,
  InterpolationIndex: lessInterpIndexKey,
  QuotedDoubleText: lessQuotedDoubleChunk,
  QuotedSingleText: lessQuotedSingleChunk,
  InterpolatedCustomPropertyStart: lessInterpolatedCustomPropertyStart,
  InterpolatedCustomPropertyDash: lessInterpolatedCustomPropertyDash,
  InterpolatedCustomPropertyTail: lessInterpolatedCustomPropertyTail,
  InterpolatedValueStart: lessInterpolatedValueStart,
  InterpolatedValueDash: lessInterpolatedValueDash,
  InterpolatedValueTail: lessInterpolatedValueTail,
  CustomPropertyToken: lessCustomProperty,
  CustomValueOuterContent: lessCustomOuterContent,
  CustomValueInnerContent: lessCustomInnerContent,
  CustomValueSingleQuoted: lessCustomSingleQuoted,
  CustomValueDoubleQuoted: lessCustomDoubleQuoted
}));
