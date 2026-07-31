/*
 * The CSS construct space, enumerated from the specs — NOT from the grammars.
 *
 * Why this file exists
 * --------------------
 * A grammar rewrite once rejected EVERY percentage keyframe selector
 * (`@keyframes x { 0% { a: b } }`) and passed every suite, because no CSS
 * fixture anywhere mentioned `@keyframes`. A check that covers nothing is
 * indistinguishable from a check that passes. The fix is not another fixture
 * for that one at-rule; it is an enumeration derived from the specs, so the
 * checklist cannot inherit the grammars' own blind spots.
 *
 * Derived from: css-syntax-3, css-conditional-3/4/5, css-cascade-5,
 * css-contain-3, css-page-3, css-fonts-4, css-counter-styles-3,
 * css-properties-values-api-1, css-animations-1, css-namespaces-3,
 * selectors-4, css-values-4, css-variables-1.
 *
 * The standing ruling this encodes
 * --------------------------------
 * **Valid CSS is valid in all four dialects**, and it is ONE-WAY: a dialect may
 * add, never subtract. So a single table drives four gates, and a construct
 * accepted by three dialects and rejected by the fourth is a DEFECT in the
 * fourth — not a dialect difference, and not something for a per-dialect
 * expectation to quietly absorb.
 *
 * PINNED DEFECT
 * -------------
 * `brokenIn` lists the dialects that currently REJECT the construct. Those
 * entries assert the CURRENT, WRONG behaviour and carry a `defect` note. They
 * are pins, not endorsements: a pinned wrong answer that changes loudly beats a
 * gap that changes silently. Fixing a defect FAILS its pin — drop the dialect
 * from `brokenIn` and the pin becomes the contract. Grep `PINNED DEFECT` across
 * `packages/syntax` and this file for the whole set (DESIGN-DECISIONS G22).
 *
 * Every entry here is valid CSS. Nothing in this table is a dialect extension;
 * per-dialect syntax belongs in that dialect's own suite.
 */

export const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;

export type Dialect = (typeof DIALECTS)[number];

export interface CssConstruct {
  /** Stable id, used as the test title. */
  readonly id: string;
  readonly group: 'at-rule' | 'selector' | 'value';
  readonly source: string;
  /** Dialects that currently reject this valid CSS. Each one is a defect. */
  readonly brokenIn?: readonly Dialect[];
  /** Required whenever `brokenIn` is present: what is actually wrong. */
  readonly defect?: string;
}

export const CSS_CONSTRUCTS: readonly CssConstruct[] = [
  // ---------------------------------------------------------------- at-rules
  {
    id: '@charset',
    group: 'at-rule',
    source: '@charset "utf-8";'
  },
  {
    id: '@import with layer()',
    group: 'at-rule',
    source: '@import url("a.css") layer(base);'
  },
  {
    id: '@import with bare layer',
    group: 'at-rule',
    source: '@import "a.css" layer;'
  },
  {
    id: '@import with supports() and media',
    group: 'at-rule',
    source: '@import "a.css" supports(display: grid) screen;'
  },
  {
    id: '@import with a media-query list',
    group: 'at-rule',
    source: '@import "a.css" screen and (min-width: 1px), print;'
  },
  {
    id: '@namespace prefixed',
    group: 'at-rule',
    source: '@namespace svg url("http://www.w3.org/2000/svg");'
  },
  {
    id: '@namespace default',
    group: 'at-rule',
    source: '@namespace url("http://www.w3.org/2000/svg");'
  },
  {
    id: '@media with a legacy min-/max- feature',
    group: 'at-rule',
    source: '@media only screen and (min-width: 100px) { a { color: red } }'
  },
  {
    id: '@media with a two-sided range',
    group: 'at-rule',
    source: '@media (400px <= width <= 700px) { a { color: red } }'
  },
  {
    id: '@media with a one-sided range',
    group: 'at-rule',
    source: '@media (width >= 600px) { a { color: red } }'
  },
  {
    id: '@media with a negated query',
    group: 'at-rule',
    source: '@media not screen { a { color: red } }'
  },
  {
    id: '@media with a general-enclosed feature',
    group: 'at-rule',
    source: '@media (foo: bar) { a { color: red } }'
  },
  {
    id: '@media nested inside a rule',
    group: 'at-rule',
    source: 'a { @media screen { color: red } }'
  },
  {
    id: '@supports with selector()',
    group: 'at-rule',
    source: '@supports selector(a:has(b)) { a { color: red } }'
  },
  {
    id: '@supports with a functional selector() argument',
    group: 'at-rule',
    source: '@supports selector(:has(> a)) { a { color: red } }'
  },
  {
    id: '@supports with not',
    group: 'at-rule',
    source: '@supports not (display: grid) { a { color: red } }'
  },
  {
    id: '@supports with nested and/or groups',
    group: 'at-rule',
    source: '@supports (a: b) and ((c: d) or (e: f)) { a { color: red } }'
  },
  {
    id: '@supports with font-tech()',
    group: 'at-rule',
    source: '@supports font-tech(color-COLRv1) { a { color: red } }'
  },
  {
    id: '@layer statement with one name',
    group: 'at-rule',
    source: '@layer a;'
  },
  {
    id: '@layer statement with a name list',
    group: 'at-rule',
    source: '@layer a, b;'
  },
  {
    id: '@layer statement with a dotted sub-layer name',
    group: 'at-rule',
    source: '@layer a, b.c;',
    brokenIn: ['jess'],
    defect:
      'Jess consumes nothing. css-cascade-5 §6.1 spells `<layer-name>` as '
      + '`<ident> ["." <ident>]*`, so `b.c` is ONE layer name; the Jess prelude '
      + 'appears to see the class-selector/mixin-call reading of `.c` instead. '
      + 'The undotted forms above parse in all four.'
  },
  {
    id: '@layer block',
    group: 'at-rule',
    source: '@layer base { a { color: red } }'
  },
  {
    id: '@layer anonymous block',
    group: 'at-rule',
    source: '@layer { a { color: red } }'
  },
  {
    id: '@layer nested in @layer',
    group: 'at-rule',
    source: '@layer a { @layer b { c { color: red } } }'
  },
  {
    id: '@layer inside @media',
    group: 'at-rule',
    source: '@media screen { @layer a { c { color: red } } }'
  },
  {
    id: '@container with a size query',
    group: 'at-rule',
    source: '@container (min-width: 200px) { a { color: red } }'
  },
  {
    id: '@container with a name and a range query',
    group: 'at-rule',
    source: '@container card (width > 400px) { a { color: red } }'
  },
  {
    id: '@container with and-joined size queries',
    group: 'at-rule',
    source: '@container (min-width: 1px) and (max-width: 2px) { a { color: red } }'
  },
  {
    id: '@container with a parenthesised condition group',
    group: 'at-rule',
    source: '@container ((width > 1px) and (height > 1px)) { a { color: red } }',
    brokenIn: ['css', 'jess'],
    defect:
      'css-contain-3 §3 makes `<container-condition>` a `<boolean-expr>`, whose '
      + 'general form permits a parenthesised group. Less and SCSS accept it; CSS '
      + 'and Jess reject it, so the BASE dialect is stricter than two supersets — '
      + 'the one-way ruling inverted.'
  },
  {
    id: '@container with style()',
    group: 'at-rule',
    source: '@container style(--x: 1) { a { color: red } }',
    brokenIn: ['jess'],
    defect: 'Jess rejects the css-contain-3 §3.3 `<style-query>` that the other three accept.'
  },
  {
    id: '@container with a parenthesised style()',
    group: 'at-rule',
    source: '@container (style(--x: 1)) { a { color: red } }',
    brokenIn: ['css', 'less', 'jess'],
    defect:
      'Only SCSS accepts the parenthesised style query. Same root as the '
      + 'condition-group entry above: the boolean-expression parens are missing '
      + 'from three container preludes.'
  },
  {
    id: '@keyframes with percentage and to selectors',
    group: 'at-rule',
    source: '@keyframes x { 0% { opacity: 1 } 50%,to { opacity: 0 } }'
  },
  {
    id: '@keyframes with a from selector',
    group: 'at-rule',
    source: '@keyframes x { from { opacity: 1 } }'
  },
  {
    id: '@-webkit-keyframes',
    group: 'at-rule',
    source: '@-webkit-keyframes x { 0% { opacity: 1 } }'
  },
  {
    id: '@font-face with src and unicode-range',
    group: 'at-rule',
    source: '@font-face { font-family: X; src: url(a.woff2) format("woff2"); unicode-range: U+0-7F; }',
    brokenIn: ['jess'],
    defect:
      'Jess consumes nothing. The `unicode-range` descriptor is the cause — see '
      + 'the `U+` value entries below; the same body without it parses in Jess.'
  },
  {
    id: '@font-feature-values with descriptor sub-at-rules',
    group: 'at-rule',
    source: '@font-feature-values Fam { @swash { s: 1 } @annotation { a: 2 } @ornaments { o: 3 } }'
  },
  {
    id: '@font-palette-values',
    group: 'at-rule',
    source: '@font-palette-values --Alt { font-family: Bixa; base-palette: 1; }'
  },
  {
    id: '@counter-style with the full descriptor set',
    group: 'at-rule',
    source:
      '@counter-style x { system: fixed 3; symbols: "\\25CF" "\\25CB"; '
      + 'additive-symbols: 5 "V"; negative: "-"; range: 1 5; pad: 3 "0"; speak-as: numbers; }'
  },
  {
    id: '@property with a terminated descriptor body',
    group: 'at-rule',
    source: '@property --c { syntax: "<color>"; inherits: false; initial-value: red; }'
  },
  {
    id: '@property with an unterminated last descriptor',
    group: 'at-rule',
    source: '@property --x { syntax: "*"; inherits: true }',
    brokenIn: ['jess'],
    defect:
      'Jess requires a trailing `;` on the last descriptor of an `@property` '
      + 'body. css-syntax-3 §5.4.4 makes the final `;` optional in ANY declaration '
      + 'list; adding it makes this exact source parse in Jess.'
  },
  {
    id: '@page bare',
    group: 'at-rule',
    source: '@page { margin: 1cm; }'
  },
  {
    id: '@page with a pseudo-page selector',
    group: 'at-rule',
    source: '@page :first { margin: 1cm; }',
    brokenIn: ['jess'],
    defect:
      'Jess consumes nothing for ANY `<pseudo-page>` (`:first`, `:left`, '
      + '`:right`, `:blank`), spaced or not. css-page-3 §3 requires them. '
      + '`@page wide { … }` — a bare page name — does parse in Jess.'
  },
  {
    id: '@page with a name and a pseudo-page',
    group: 'at-rule',
    source: '@page wide:left { margin: 1cm; }',
    brokenIn: ['jess'],
    defect: 'Same defect as the bare `<pseudo-page>` entry above.'
  },
  {
    id: '@page with margin at-rules',
    group: 'at-rule',
    source: '@page { @top-left-corner { content: "a" } @bottom-right { content: "b" } @left-middle { content: "c" } }'
  },
  {
    id: '@scope with from and to',
    group: 'at-rule',
    source: '@scope (.card) to (.content) { a { color: red } }'
  },
  {
    id: '@scope bare',
    group: 'at-rule',
    source: '@scope { a { color: red } }'
  },
  {
    id: '@scope nested inside a rule',
    group: 'at-rule',
    source: '.card { @scope (.a) to (.b) { c { color: red } } }'
  },
  {
    id: '@starting-style',
    group: 'at-rule',
    source: '@starting-style { a { opacity: 0 } }'
  },
  {
    id: '@starting-style nested inside a rule',
    group: 'at-rule',
    source: 'a { @starting-style { opacity: 0 } }'
  },
  {
    id: '@view-transition',
    group: 'at-rule',
    source: '@view-transition { navigation: auto; }'
  },
  {
    id: '@position-try',
    group: 'at-rule',
    source: '@position-try --f { top: 0; left: 0; }'
  },

  // --------------------------------------------------------------- selectors
  {
    id: 'child, adjacent and sibling combinators chained',
    group: 'selector',
    source: 'a > b + c ~ d { color: red }'
  },
  {
    id: 'column combinator',
    group: 'selector',
    source: 'col || td { color: red }'
  },
  {
    id: 'namespaced type selector',
    group: 'selector',
    source: 'svg|circle { color: red }',
    brokenIn: ['scss', 'jess'],
    defect:
      'css-namespaces-3 §5 type selector. CSS and Less accept it; SCSS and Jess '
      + 'consume nothing.'
  },
  {
    id: 'any-namespace type selector',
    group: 'selector',
    source: '*|a { color: red }',
    brokenIn: ['scss', 'jess'],
    defect: 'Same defect as the namespaced type selector above.'
  },
  {
    id: 'no-namespace type selector',
    group: 'selector',
    source: '|a { color: red }',
    brokenIn: ['css', 'scss', 'jess'],
    defect:
      'css-namespaces-3 §5 `|E` (no namespace). Only Less accepts it, so the '
      + 'BASE dialect is stricter than a superset.'
  },
  {
    id: 'namespaced attribute selector',
    group: 'selector',
    source: 'a[svg|href="x"] { color: red }',
    brokenIn: ['css', 'scss', 'jess'],
    defect:
      'selectors-4 §6.1 / css-namespaces-3 §6. Only Less accepts it. The base '
      + 'CSS grammar rejecting what a superset accepts inverts the one-way ruling.'
  },
  {
    id: 'any-namespace attribute selector',
    group: 'selector',
    source: 'a[*|href] { color: red }',
    brokenIn: ['css', 'scss', 'jess'],
    defect: 'Same defect as the namespaced attribute selector above.'
  },
  {
    id: 'attribute presence selector',
    group: 'selector',
    source: 'a[href] { color: red }'
  },
  {
    id: 'attribute selector with every matcher',
    group: 'selector',
    source: 'a[href^="x"] b[href$="x"] c[href*="x"] d[lang|="en"] e[rel~="x"] f[data-x=y-z] { color: red }'
  },
  {
    id: 'attribute selector with an empty string value',
    group: 'selector',
    source: 'a[data-x=""] { color: red }'
  },
  {
    id: ':not() with a selector list',
    group: 'selector',
    source: 'a:not(.b, .c) { color: red }'
  },
  {
    id: ':is() with a selector list',
    group: 'selector',
    source: 'a:is(.b, .c) { color: red }'
  },
  {
    id: ':where() with a selector list',
    group: 'selector',
    source: 'a:where(.b, .c) { color: red }'
  },
  {
    id: ':has() with a compound argument',
    group: 'selector',
    source: 'a:has(.b) { color: red }'
  },
  {
    id: ':has() nested in :has()',
    group: 'selector',
    source: 'a:has(.b:has(.c)) { color: red }'
  },
  {
    id: ':is() nested in :not()',
    group: 'selector',
    source: 'a:not(:is(.b, .c)) { color: red }'
  },
  {
    id: ':nth-child() with an An+B microsyntax',
    group: 'selector',
    source: 'a:nth-child(2n+1) { color: red }'
  },
  {
    id: ':nth-child() with a negative An+B',
    group: 'selector',
    source: 'a:nth-child(-n+3) { color: red }'
  },
  {
    id: ':nth-child() with even and odd keywords',
    group: 'selector',
    source: 'a:nth-child(even) b:nth-last-of-type(odd) { color: red }'
  },
  {
    id: ':nth-child() with an of clause',
    group: 'selector',
    source: 'a:nth-child(2n+1 of .b) { color: red }'
  },
  {
    id: ':nth-child() with a complex of clause',
    group: 'selector',
    source: 'a:nth-child(2n of .b > .c) { color: red }'
  },
  {
    id: ':nth-last-child() with an of clause',
    group: 'selector',
    source: 'a:nth-last-child(1 of .b) { color: red }'
  },
  {
    id: ':nth-of-type()',
    group: 'selector',
    source: 'a:nth-of-type(2n) { color: red }'
  },
  {
    id: ':dir() and :lang()',
    group: 'selector',
    source: 'a:dir(rtl):lang(en) { color: red }'
  },
  {
    id: 'structural pseudo-classes without arguments',
    group: 'selector',
    source: ':root a:only-child:empty { color: red }'
  },
  {
    id: '::part()',
    group: 'selector',
    source: 'a::part(x) { color: red }'
  },
  {
    id: '::slotted()',
    group: 'selector',
    source: 'a::slotted(.b) { color: red }'
  },
  {
    id: '::highlight()',
    group: 'selector',
    source: 'a::highlight(x) { color: red }'
  },
  {
    id: '::view-transition-group()',
    group: 'selector',
    source: '::view-transition-group(x) { color: red }'
  },
  {
    id: ':host() and :host-context()',
    group: 'selector',
    source: ':host(.b) :host-context(.c) { color: red }'
  },
  {
    id: 'tree-abiding pseudo-elements',
    group: 'selector',
    source: 'a::marker b::backdrop c::selection d::before { color: red }'
  },
  {
    id: 'legacy single-colon pseudo-element',
    group: 'selector',
    source: 'a:first-line { color: red }'
  },
  {
    id: 'escaped delimiter in a class name',
    group: 'selector',
    source: '.a\\.b { color: red }'
  },
  {
    id: 'numeric unicode escape starting a class name',
    group: 'selector',
    source: '.\\30 a { color: red }'
  },
  {
    id: 'non-ASCII identifier',
    group: 'selector',
    source: '.é { color: red }'
  },

  // ------------------------------------------------------------------ values
  {
    id: 'var() with a fallback',
    group: 'value',
    source: 'a { color: var(--x, red) }'
  },
  {
    id: 'var() with a nested var() fallback',
    group: 'value',
    source: 'a { color: var(--x, var(--y, red)) }'
  },
  {
    id: 'var() with an empty fallback',
    group: 'value',
    source: 'a { color: var(--x,) }',
    brokenIn: ['scss'],
    defect:
      'css-variables-1 §3 makes the fallback `<declaration-value>?`, so the '
      + 'empty fallback is well-formed and means "the empty value". SCSS alone '
      + 'rejects it, with or without a space before the `)`.'
  },
  {
    id: 'calc() nested in calc()',
    group: 'value',
    source: 'a { width: calc(100% - calc(2 * 1px)) }'
  },
  {
    id: 'calc() over a var()',
    group: 'value',
    source: 'a { width: calc(var(--x) * 2) }'
  },
  {
    id: 'var() fallback containing calc()',
    group: 'value',
    source: 'a { width: calc(var(--x, calc(1px + 2px))) }'
  },
  {
    id: 'clamp() over min() and max()',
    group: 'value',
    source: 'a { width: clamp(1px, 2vw, min(3px, max(4px, 5px))) }'
  },
  {
    id: 'url() unquoted',
    group: 'value',
    source: 'a { background: url(a/b.png) }'
  },
  {
    id: 'url() quoted with a data URI',
    group: 'value',
    source: 'a { background: url(data:image/svg+xml;base64,AAA=) }'
  },
  {
    id: 'url() empty',
    group: 'value',
    source: 'a { background: url() }'
  },
  {
    id: 'url() with an escaped space',
    group: 'value',
    source: 'a { background: url(a\\ b.png) }',
    brokenIn: ['jess'],
    defect:
      'css-syntax-3 §4.3.6 consumes a url-token with escapes, so `\\ ` and '
      + '`\\)` are ordinary escaped code points inside an unquoted url. Jess '
      + 'rejects both.'
  },
  {
    id: 'url() with an escaped close paren',
    group: 'value',
    source: 'a { background: url(a\\)b.png) }',
    brokenIn: ['jess'],
    defect: 'Same defect as the escaped-space url() above.'
  },
  {
    id: 'attr() bare',
    group: 'value',
    source: 'a { content: attr(data-x) }'
  },
  {
    id: 'attr() with a type and a fallback',
    group: 'value',
    source: 'a { content: attr(data-x string, "y") }'
  },
  {
    id: 'env() with a fallback',
    group: 'value',
    source: 'a { padding: env(safe-area-inset-top, 0px) }'
  },
  {
    id: 'gradient functions',
    group: 'value',
    source: 'a { background: linear-gradient(to right, red 0%, blue 100%) } b { background: conic-gradient(from 0deg, red, blue) }'
  },
  {
    id: 'modern colour functions',
    group: 'value',
    source: 'a { color: oklch(0.7 0.1 200 / 50%) } b { color: color(display-p3 1 0 0) }'
  },
  {
    id: 'four- and eight-digit hex colours',
    group: 'value',
    source: 'a { color: #abcd } b { color: #aabbccdd }'
  },
  {
    id: 'scientific notation',
    group: 'value',
    source: 'a { width: 1e3px } b { width: 1.5e-3px }'
  },
  {
    id: 'unicode-range with a range',
    group: 'value',
    source: 'a { x: U+0-7F }',
    brokenIn: ['jess'],
    defect:
      'css-syntax-3 §4.3.14 consumes a unicode-range token. Jess consumes '
      + 'nothing for ANY `U+` form — single (`U+26`), range (`U+0-7F`) or '
      + 'wildcard (`U+4??`) — which is also why the `@font-face` entry above '
      + 'fails in Jess.'
  },
  {
    id: 'unicode-range with a wildcard',
    group: 'value',
    source: 'a { x: U+4?? }',
    brokenIn: ['jess'],
    defect: 'Same defect as the unicode-range entry above.'
  },
  {
    id: 'empty custom property',
    group: 'value',
    source: 'a { --x:; }'
  },
  {
    id: 'custom property holding a block',
    group: 'value',
    source: 'a { --x: { b: c } }'
  },
  {
    id: 'slash-separated shorthand',
    group: 'value',
    source: 'a { font: 12px/1.5 serif } b { grid-area: 1 / 2 / 3 / 4 }'
  },
  {
    id: '!important with interior whitespace',
    group: 'value',
    source: 'a { color: red !  important }'
  },
  {
    id: '!important with an interior comment',
    group: 'value',
    source: 'a { color: red !/*x*/important }',
    brokenIn: ['scss'],
    defect:
      'css-syntax-3 §5.4.4 skips comments wherever whitespace is allowed, and '
      + 'the spaced form above parses in all four. SCSS alone rejects the '
      + 'comment form.'
  },
  {
    id: '!IMPORTANT case-insensitive',
    group: 'value',
    source: 'a { color: red !IMPORTANT }'
  },
  {
    id: 'CDO and CDC at the top level',
    group: 'value',
    source: '<!-- a { color: red } -->',
    brokenIn: ['css', 'less', 'scss', 'jess'],
    defect:
      'css-syntax-3 §5.4.1 "Consume a stylesheet" consumes and DISCARDS <!-- '
      + 'and --> at the top level. All four dialects consume nothing, so an HTML-'
      + 'comment-wrapped stylesheet — the legacy `<style>` idiom — is a total '
      + 'parse failure everywhere.'
  }
];

/** Constructs a dialect must accept. */
export function acceptedIn(dialect: Dialect): readonly CssConstruct[] {
  return CSS_CONSTRUCTS.filter(construct => !(construct.brokenIn ?? []).includes(dialect));
}

/** Constructs a dialect currently rejects — pinned defects, one entry each. */
export function pinnedDefectsIn(dialect: Dialect): readonly CssConstruct[] {
  return CSS_CONSTRUCTS.filter(construct => (construct.brokenIn ?? []).includes(dialect));
}
