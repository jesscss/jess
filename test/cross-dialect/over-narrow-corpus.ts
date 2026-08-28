/*
 * The OVER-NARROW probe corpus: spec-valid CSS that a grammar may reject.
 *
 * ## Why this exists, and why the acceptance matrix cannot replace it
 *
 * `acceptance-matrix.test.ts` compares the four dialects TO EACH OTHER. That is
 * a real gate, and it found `@charset` and the `@namespace url()` slash defect.
 * But it is structurally BLIND to the case where all four are equally too
 * narrow: four grammars that agree on rejecting `a:not(foo(a/b))` produce a
 * perfectly green matrix. The absolute reference has to come from OUTSIDE the
 * repo — from the specs — which is what every entry below carries.
 *
 * ## The standing ruling this probes
 *
 * "Make the parser less finicky and make it a diagnostic concern." The parser
 * accepts SHAPES, not semantics; validity belongs to eval and the language
 * service. A grammar that encodes a narrow view of CSS rejects valid input, and
 * every instance found so far has been SILENT, because the dialect's own suite
 * passed.
 *
 * ## `valid` is the load-bearing field
 *
 * `valid: true` asserts the input is spec-valid CSS per the cited clause, so a
 * reject is a PARSER DEFECT. `valid: false` entries are the control half: they
 * are invalid CSS, present so that a "generalization" that simply accepts
 * everything is visible as such. A rejection of a `valid: false` probe is not a
 * defect, and an acceptance of one is only a problem when the resulting NODE is
 * wrong — over-accepting into a WRONG node (the SCSS `div:hover, span` →
 * `Declaration` incident) is worse than rejecting.
 *
 * `clause` is mandatory on every `valid: true` entry. An assertion that
 * something "should parse" with no spec behind it is an opinion, and opinions
 * are what produced the narrowness in the first place.
 */

export type Probe = {
  /** Stable id, `<group>-<n>`, quoted in the survey table. */
  readonly id: string;
  /** What the probe is about, one line. */
  readonly name: string;
  /** A COMPLETE stylesheet. Partial input would measure the wrong thing. */
  readonly source: string;
  /** True iff this is spec-valid CSS. See the header. */
  readonly valid: boolean;
  /** Spec clause. Mandatory when `valid`. */
  readonly clause: string;
};

/*
 * Selectors-4. The namespace family is the known-open instance: less accepts,
 * css/scss/jess reject. It is included in full (prefix forms, `*|`, empty
 * prefix, and the attribute-selector position) because a partial fix that
 * handles `ns|a` and misses `[*|href]` would otherwise read as closed.
 */
const SELECTORS: readonly Probe[] = [
  { id: 'sel-01', name: 'namespace prefix on a type selector', source: 'svg|circle { fill: red }', valid: true, clause: 'selectors-4 §6.1' },
  { id: 'sel-02', name: 'universal namespace prefix', source: '*|a { color: red }', valid: true, clause: 'selectors-4 §6.1' },
  { id: 'sel-03', name: 'empty namespace prefix (no namespace)', source: '|a { color: red }', valid: true, clause: 'selectors-4 §6.1' },
  { id: 'sel-04', name: 'namespace prefix with universal local name', source: 'svg|* { fill: red }', valid: true, clause: 'selectors-4 §6.1' },
  { id: 'sel-05', name: 'namespace in an attribute selector', source: 'a[*|href=x] { color: red }', valid: true, clause: 'selectors-4 §6.2' },
  { id: 'sel-06', name: 'declared namespace then a prefixed selector', source: '@namespace svg url(http://www.w3.org/2000/svg);\nsvg|circle { fill: red }', valid: true, clause: 'css-namespaces-3 §2' },

  { id: 'sel-10', name: 'attribute matcher ~=', source: '[a~=b] { color: red }', valid: true, clause: 'selectors-4 §5.2' },
  { id: 'sel-11', name: 'attribute matcher |=', source: '[a|=b] { color: red }', valid: true, clause: 'selectors-4 §5.2' },
  { id: 'sel-12', name: 'attribute matcher ^=', source: '[a^=b] { color: red }', valid: true, clause: 'selectors-4 §5.3' },
  { id: 'sel-13', name: 'attribute matcher $=', source: '[a$=b] { color: red }', valid: true, clause: 'selectors-4 §5.3' },
  { id: 'sel-14', name: 'attribute matcher *=', source: '[a*=b] { color: red }', valid: true, clause: 'selectors-4 §5.3' },
  { id: 'sel-15', name: 'attribute value as a string', source: '[a="b c"] { color: red }', valid: true, clause: 'selectors-4 §5.1' },
  { id: 'sel-16', name: 'attribute case-insensitive flag i', source: '[a=b i] { color: red }', valid: true, clause: 'selectors-4 §5.4' },
  { id: 'sel-17', name: 'attribute case-sensitive flag s', source: '[a=b s] { color: red }', valid: true, clause: 'selectors-4 §5.4' },
  { id: 'sel-18', name: 'flag on a quoted value', source: '[a="b" i] { color: red }', valid: true, clause: 'selectors-4 §5.4' },
  { id: 'sel-19', name: 'uppercase flag I', source: '[a=b I] { color: red }', valid: true, clause: 'selectors-4 §5.4 (ASCII case-insensitive)' },
  { id: 'sel-20', name: 'attribute name only, spaced brackets', source: '[ a ] { color: red }', valid: true, clause: 'selectors-4 §5.1 + css-syntax-3 §5.4.9' },
  { id: 'sel-21', name: 'escaped space inside an attribute value ident', source: '[a=b\\ c] { color: red }', valid: true, clause: 'css-syntax-3 §4.3.7 + selectors-4 §5.1' },
  { id: 'sel-22', name: 'escaped dot inside an attribute value ident', source: '[a=b\\.c] { color: red }', valid: true, clause: 'css-syntax-3 §4.3.7' },
  { id: 'sel-23', name: 'numeric escape starting an attribute value', source: '[a=\\31 23] { color: red }', valid: true, clause: 'css-syntax-3 §4.3.7' },
  { id: 'sel-24', name: 'escaped attribute NAME', source: '[a\\.b=c] { color: red }', valid: true, clause: 'css-syntax-3 §4.3.7' },

  { id: 'sel-30', name: 'nth-child An+B', source: 'li:nth-child(2n+1) { color: red }', valid: true, clause: 'css-syntax-3 §9 (An+B)' },
  { id: 'sel-31', name: 'nth-child with of S', source: 'li:nth-child(2n+1 of .a) { color: red }', valid: true, clause: 'selectors-4 §6.6.2' },
  { id: 'sel-32', name: 'nth-last-child with a complex of S', source: 'li:nth-last-child(odd of .a > .b) { color: red }', valid: true, clause: 'selectors-4 §6.6.3' },
  { id: 'sel-33', name: 'An+B with whitespace around the sign', source: 'li:nth-child(2n + 1) { color: red }', valid: true, clause: 'css-syntax-3 §9' },
  { id: 'sel-34', name: 'An+B negative B', source: 'li:nth-child(-n+3) { color: red }', valid: true, clause: 'css-syntax-3 §9' },

  { id: 'sel-40', name: ':is with a complex argument', source: ':is(.a > .b, .c ~ .d) { color: red }', valid: true, clause: 'selectors-4 §3.4' },
  { id: 'sel-41', name: ':where nested inside :is', source: ':is(:where(.a, .b) .c) { color: red }', valid: true, clause: 'selectors-4 §3.4' },
  { id: 'sel-42', name: ':has with a relative selector', source: 'a:has(> img) { color: red }', valid: true, clause: 'selectors-4 §4.5' },
  { id: 'sel-43', name: ':has with a leading sibling combinator', source: 'a:has(~ .b) { color: red }', valid: true, clause: 'selectors-4 §4.5' },
  { id: 'sel-44', name: ':not with a compound argument list', source: 'a:not(.b, [c], :hover) { color: red }', valid: true, clause: 'selectors-4 §4.3' },
  { id: 'sel-45', name: 'pseudo argument containing a nested function with a slash', source: 'a:not(foo(a/b)) { color: red }', valid: true, clause: 'selectors-4 §3.5 + css-syntax-3 §5.4.9 (any-value)' },
  { id: 'sel-46', name: 'pseudo argument containing a bare slash', source: 'a:foo(a/b) { color: red }', valid: true, clause: 'css-syntax-3 §5.4.9' },
  { id: 'sel-47', name: 'unknown functional pseudo with an arbitrary token stream', source: 'a:foo(1 + 2, [x], "s") { color: red }', valid: true, clause: 'css-syntax-3 §5.4.9' },
  { id: 'sel-48', name: 'pseudo-element with arguments', source: 'a::part(label) { color: red }', valid: true, clause: 'css-shadow-parts-1 §3' },
  { id: 'sel-49', name: 'double-colon legacy pseudo-element', source: 'a::before { content: "" }', valid: true, clause: 'selectors-4 §3.6' },

  { id: 'sel-60', name: 'column combinator ||', source: 'col || td { color: red }', valid: true, clause: 'selectors-4 §15.1' },
  { id: 'sel-61', name: 'combinator with no surrounding whitespace', source: '.a>.b+.c~.d { color: red }', valid: true, clause: 'selectors-4 §15' },
  { id: 'sel-62', name: 'nesting selector at the top of a nested rule', source: '.a { & .b { color: red } }', valid: true, clause: 'css-nesting-1 §2' },
  { id: 'sel-63', name: 'bare nested type selector', source: '.a { b { color: red } }', valid: true, clause: 'css-nesting-1 §2' },
  { id: 'sel-64', name: 'escaped class name', source: '.a\\/b { color: red }', valid: true, clause: 'css-syntax-3 §4.3.7' },
  { id: 'sel-65', name: 'class name starting with a numeric escape', source: '.\\31 23 { color: red }', valid: true, clause: 'css-syntax-3 §4.3.7' },
  { id: 'sel-66', name: 'non-ASCII identifier', source: '.café { color: red }', valid: true, clause: 'css-syntax-3 §4.3.9 (ident-start code point)' },
  { id: 'sel-67', name: 'astral-plane identifier', source: '.𝒜 { color: red }', valid: true, clause: 'css-syntax-3 §4.3.9' }
];

/*
 * Values. css-values-4 component types plus css-syntax-3 tokenization. The
 * `unicode-range` and escape families are here because both are routinely
 * over-narrowed: a hand-rolled ident regex that forgets `\\` rejects a whole
 * spec-blessed spelling class, and `U+0-7F` looks like an ident followed by
 * arithmetic to a grammar that has not been told otherwise.
 */
const VALUES: readonly Probe[] = [
  { id: 'val-01', name: 'unicode-range single code point', source: '@font-face { unicode-range: U+26 }', valid: true, clause: 'css-syntax-3 §4.4 / css-fonts-4 §4.5' },
  { id: 'val-02', name: 'unicode-range interval', source: '@font-face { unicode-range: U+0-7F }', valid: true, clause: 'css-syntax-3 §4.4' },
  { id: 'val-03', name: 'unicode-range wildcard', source: '@font-face { unicode-range: U+4?? }', valid: true, clause: 'css-syntax-3 §4.4' },
  { id: 'val-04', name: 'unicode-range list', source: '@font-face { unicode-range: U+0-7F, U+A0-FF }', valid: true, clause: 'css-fonts-4 §4.5' },
  { id: 'val-05', name: 'lowercase u+ range', source: '@font-face { unicode-range: u+0-7f }', valid: true, clause: 'css-syntax-3 §4.4 (ASCII case-insensitive)' },
  { id: 'val-06', name: 'unicode-range-shaped token inside a math function', source: 'a { width: min(U+0-7F) }', valid: false, clause: 'not a <calc-value>; SHAPE is well-formed so a parser need not reject it' },

  { id: 'val-10', name: 'unquoted url', source: 'a { background: url(a/b.png) }', valid: true, clause: 'css-values-4 §4.5.1' },
  { id: 'val-11', name: 'quoted url', source: 'a { background: url("a b.png") }', valid: true, clause: 'css-values-4 §4.5.1' },
  { id: 'val-12', name: 'url with internal whitespace padding', source: 'a { background: url(  a.png  ) }', valid: true, clause: 'css-syntax-3 §4.3.6' },
  { id: 'val-13', name: 'url containing an escape', source: 'a { background: url(a\\ b.png) }', valid: true, clause: 'css-syntax-3 §4.3.6' },
  { id: 'val-14', name: 'src() as a url alternative', source: 'a { background: src("a.png") }', valid: true, clause: 'css-values-5 §5.2' },
  { id: 'val-15', name: 'data URI with a comma and semicolons', source: 'a { background: url(data:image/svg+xml;base64,AA==) }', valid: true, clause: 'css-syntax-3 §4.3.6' },

  { id: 'val-20', name: 'string with an escaped quote', source: 'a { content: "a\\"b" }', valid: true, clause: 'css-syntax-3 §4.3.5' },
  { id: 'val-21', name: 'string with an escaped newline continuation', source: 'a { content: "a\\\nb" }', valid: true, clause: 'css-syntax-3 §4.3.5' },
  { id: 'val-22', name: 'string with a numeric escape', source: 'a { content: "\\31 23" }', valid: true, clause: 'css-syntax-3 §4.3.7' },
  { id: 'val-23', name: 'single-quoted string', source: 'a { content: \'x\' }', valid: true, clause: 'css-syntax-3 §4.3.5' },
  { id: 'val-24', name: 'custom-ident with an escaped space', source: 'a { grid-area: b\\ c }', valid: true, clause: 'css-values-4 §3.2 + css-syntax-3 §4.3.7' },
  { id: 'val-25', name: 'custom-ident that is a numeric escape', source: 'a { grid-area: \\31 23 }', valid: true, clause: 'css-values-4 §3.2' },
  { id: 'val-26', name: 'ident with an escaped dot', source: 'a { font-family: b\\.c }', valid: true, clause: 'css-syntax-3 §4.3.7' },

  { id: 'val-30', name: 'unusual dimension unit', source: 'a { width: 1q }', valid: true, clause: 'css-values-4 §5.2' },
  { id: 'val-31', name: 'container query length unit', source: 'a { width: 1cqw }', valid: true, clause: 'css-contain-3 §4.1' },
  { id: 'val-32', name: 'unknown dimension unit (shape is a dimension)', source: 'a { width: 1foo }', valid: false, clause: 'unknown unit — a <dimension-token> nonetheless (css-syntax-3 §4.3.3)' },
  { id: 'val-33', name: 'scientific notation number', source: 'a { width: 1e3px }', valid: true, clause: 'css-syntax-3 §4.3.3' },
  { id: 'val-34', name: 'negative exponent', source: 'a { opacity: 1e-3 }', valid: true, clause: 'css-syntax-3 §4.3.3' },
  { id: 'val-35', name: 'percentage', source: 'a { width: 50% }', valid: true, clause: 'css-values-4 §5.5' },
  { id: 'val-36', name: 'plus-signed number', source: 'a { z-index: +1 }', valid: true, clause: 'css-syntax-3 §4.3.3' },
  { id: 'val-37', name: 'leading-dot number', source: 'a { opacity: .5 }', valid: true, clause: 'css-syntax-3 §4.3.3' },

  { id: 'val-40', name: '!important', source: 'a { color: red !important }', valid: true, clause: 'css-cascade-5 §3.2' },
  { id: 'val-41', name: '!important with no space after !', source: 'a { color: red ! important }', valid: true, clause: 'css-syntax-3 §5.4.4 (whitespace allowed after !)' },
  { id: 'val-42', name: '!important uppercase', source: 'a { color: red !IMPORTANT }', valid: true, clause: 'css-cascade-5 §3.2 (ASCII case-insensitive)' },
  { id: 'val-43', name: '!important with a comment between', source: 'a { color: red !/*c*/important }', valid: true, clause: 'css-syntax-3 §5.4.4 (comments are removed at tokenization)' },

  { id: 'val-50', name: 'nested functions', source: 'a { width: clamp(1px, calc(2px + var(--x)), 3px) }', valid: true, clause: 'css-values-4 §10' },
  { id: 'val-51', name: 'unknown function with arbitrary arguments', source: 'a { width: foo(1, "a", [b], {c}) }', valid: false, clause: 'unknown function — SHAPE is a well-formed function token (css-syntax-3 §5.4.9)' },
  { id: 'val-52', name: 'calc with nested parentheses', source: 'a { width: calc((1px + 2px) * 3) }', valid: true, clause: 'css-values-4 §10.1' },
  { id: 'val-53', name: 'math function with a keyword argument', source: 'a { width: calc(infinity * 1px) }', valid: true, clause: 'css-values-4 §10.9' },
  { id: 'val-54', name: 'round() with a rounding-strategy keyword', source: 'a { width: round(up, 1.2px, 1px) }', valid: true, clause: 'css-values-4 §10.6' },
  { id: 'val-55', name: 'progress-style math function (newer §10)', source: 'a { width: calc(sign(-1) * 1px) }', valid: true, clause: 'css-values-4 §10.8' },
  { id: 'val-56', name: 'anchor() in a math context', source: 'a { top: calc(anchor(top) + 1px) }', valid: true, clause: 'css-anchor-position-1 §3' },
  { id: 'val-57', name: 'var() with a comma-bearing fallback', source: 'a { width: var(--x, 1px, 2px) }', valid: true, clause: 'css-variables-1 §3' },
  { id: 'val-58', name: 'var() with an empty fallback', source: 'a { width: var(--x,) }', valid: true, clause: 'css-variables-1 §3' },
  { id: 'val-59', name: 'nested calc without the calc keyword', source: 'a { width: calc(1px + (2px * 3)) }', valid: true, clause: 'css-values-4 §10.1' },

  { id: 'val-70', name: 'slash-separated value', source: 'a { font: 12px/1.5 serif }', valid: true, clause: 'css-fonts-4 §4.9' },
  { id: 'val-71', name: 'grid-area with slashes', source: 'a { grid-area: 1 / 2 / 3 / 4 }', valid: true, clause: 'css-grid-2 §8.4' },
  { id: 'val-72', name: 'grid line names in brackets', source: 'a { grid-template-columns: [full-start] 1fr [full-end] }', valid: true, clause: 'css-grid-2 §7.2' },
  { id: 'val-73', name: 'color function with slash alpha', source: 'a { color: rgb(0 0 0 / 50%) }', valid: true, clause: 'css-color-4 §5' },
  { id: 'val-74', name: 'relative color syntax', source: 'a { color: rgb(from red r g b / 50%) }', valid: true, clause: 'css-color-5 §4' },
  { id: 'val-75', name: 'hex color with alpha', source: 'a { color: #ff000080 }', valid: true, clause: 'css-color-4 §5.2' },
  { id: 'val-76', name: 'four-digit hex color', source: 'a { color: #f008 }', valid: true, clause: 'css-color-4 §5.2' }
];

/*
 * At-rules. The generic-arm question is the whole point: css-syntax-3 §5.4.2
 * parses ANY at-rule, known or not, in both statement and block form. A grammar
 * with a closed at-rule enumeration is over-narrow by construction, and the
 * eight statement forms the supersets reject while css accepts are the recorded
 * evidence that at least one of them is.
 */
const AT_RULES: readonly Probe[] = [
  { id: 'at-01', name: 'unknown at-rule, block form', source: '@foo bar { color: red }', valid: true, clause: 'css-syntax-3 §5.4.2' },
  { id: 'at-02', name: 'unknown at-rule, statement form', source: '@foo bar;', valid: true, clause: 'css-syntax-3 §5.4.2' },
  { id: 'at-03', name: 'unknown at-rule, empty prelude block', source: '@foo { color: red }', valid: true, clause: 'css-syntax-3 §5.4.2' },
  { id: 'at-04', name: 'unknown at-rule, bare statement', source: '@foo;', valid: true, clause: 'css-syntax-3 §5.4.2' },
  { id: 'at-05', name: 'escaped at-rule name', source: '@f\\6f o;', valid: true, clause: 'css-syntax-3 §4.3.7' },

  { id: 'at-10', name: '@charset prologue', source: '@charset "utf-8";\na { color: red }', valid: true, clause: 'css-syntax-3 §3.2' },
  { id: 'at-11', name: '@import with a string', source: '@import "a.css";', valid: true, clause: 'css-cascade-5 §3' },
  { id: 'at-12', name: '@import with url()', source: '@import url(a.css);', valid: true, clause: 'css-cascade-5 §3' },
  { id: 'at-13', name: '@import with a layer() and supports()', source: '@import "a.css" layer(base) supports(display: grid) screen;', valid: true, clause: 'css-cascade-5 §3.1' },
  { id: 'at-14', name: '@layer statement form with a list', source: '@layer base, components;', valid: true, clause: 'css-cascade-5 §6.1' },
  { id: 'at-15', name: '@layer statement then @import', source: '@layer base;\n@import "a.css";', valid: true, clause: 'css-cascade-5 §6.1 (layer statements may precede imports)' },
  { id: 'at-16', name: '@layer block form', source: '@layer base { a { color: red } }', valid: true, clause: 'css-cascade-5 §6.1' },
  { id: 'at-17', name: 'anonymous @layer block', source: '@layer { a { color: red } }', valid: true, clause: 'css-cascade-5 §6.1' },
  { id: 'at-18', name: '@namespace with a string', source: '@namespace "http://x";', valid: true, clause: 'css-namespaces-3 §2' },
  { id: 'at-19', name: '@namespace with url()', source: '@namespace url(http://x);', valid: true, clause: 'css-namespaces-3 §2' },
  { id: 'at-20', name: '@namespace with a prefix', source: '@namespace svg url(http://x);', valid: true, clause: 'css-namespaces-3 §2' },

  { id: 'at-30', name: '@media with a range query', source: '@media (400px <= width <= 700px) { a { color: red } }', valid: true, clause: 'mediaqueries-4 §2.2' },
  { id: 'at-31', name: '@media with not/and', source: '@media not all and (monochrome) { a { color: red } }', valid: true, clause: 'mediaqueries-4 §3.1' },
  { id: 'at-32', name: '@media with an unknown feature', source: '@media (foo: bar) { a { color: red } }', valid: true, clause: 'mediaqueries-5 §3 (unknown features parse, then evaluate false)' },
  { id: 'at-33', name: '@supports with a declaration', source: '@supports (display: grid) { a { color: red } }', valid: true, clause: 'css-conditional-3 §2' },
  { id: 'at-34', name: '@supports selector()', source: '@supports selector(a:has(b)) { a { color: red } }', valid: true, clause: 'css-conditional-4 §3' },
  { id: 'at-35', name: '@supports font-tech()', source: '@supports font-tech(color-COLRv1) { a { color: red } }', valid: true, clause: 'css-conditional-5 §3' },
  { id: 'at-36', name: '@supports with a general enclosed', source: '@supports foo(bar) { a { color: red } }', valid: true, clause: 'css-conditional-3 §2.2 (<general-enclosed>)' },
  { id: 'at-37', name: '@container with a name and query', source: '@container card (min-width: 1px) { a { color: red } }', valid: true, clause: 'css-contain-3 §3' },
  { id: 'at-38', name: '@container style() query', source: '@container style(--x: 1) { a { color: red } }', valid: true, clause: 'css-contain-3 §3.3' },
  { id: 'at-39', name: '@container scroll-state()', source: '@container scroll-state(stuck: top) { a { color: red } }', valid: true, clause: 'css-conditional-5 §5' },

  { id: 'at-50', name: '@page with a pseudo-page', source: '@page :first { margin: 1in }', valid: true, clause: 'css-page-3 §3' },
  { id: 'at-51', name: '@page with a named page and pseudo', source: '@page narrow:left { margin: 1in }', valid: true, clause: 'css-page-3 §3' },
  { id: 'at-52', name: '@page with a margin at-rule', source: '@page { @top-center { content: "x" } }', valid: true, clause: 'css-page-3 §5' },
  { id: 'at-53', name: '@font-face', source: '@font-face { font-family: x; src: url(a.woff2) }', valid: true, clause: 'css-fonts-4 §4' },
  { id: 'at-54', name: '@font-feature-values with a nested at-rule', source: '@font-feature-values x { @styleset { a: 1 } }', valid: true, clause: 'css-fonts-4 §6.5' },
  { id: 'at-55', name: '@counter-style', source: '@counter-style x { system: cyclic; symbols: "a" }', valid: true, clause: 'css-counter-styles-3 §3' },
  { id: 'at-56', name: '@property', source: '@property --x { syntax: "<length>"; inherits: false; initial-value: 0px }', valid: true, clause: 'css-properties-values-api-1 §2' },
  { id: 'at-57', name: '@keyframes with a percentage list selector', source: '@keyframes x { 0%, 50% { opacity: 0 } to { opacity: 1 } }', valid: true, clause: 'css-animations-1 §4' },
  { id: 'at-58', name: '@scope with from/to', source: '@scope (.a) to (.b) { c { color: red } }', valid: true, clause: 'css-cascade-6 §3' },
  { id: 'at-59', name: '@starting-style', source: '@starting-style { a { opacity: 0 } }', valid: true, clause: 'css-transitions-2 §3' },
  { id: 'at-60', name: '@position-try', source: '@position-try --x { top: 1px }', valid: true, clause: 'css-anchor-position-1 §6' },
  { id: 'at-61', name: '@view-transition', source: '@view-transition { navigation: auto }', valid: true, clause: 'css-view-transitions-2 §2' },
  { id: 'at-62', name: 'nested @media inside a rule', source: 'a { @media screen { color: red } }', valid: true, clause: 'css-nesting-1 §3' },
  { id: 'at-63', name: 'declaration then nested at-rule with no semicolon', source: 'a { color: red @media all { b { color: red } } }', valid: false, clause: 'a declaration must be separated; kept as a SHAPE control' }
];

/*
 * Custom properties are the most permissive thing in CSS: css-variables-1 §2
 * gives the value <declaration-value>, which is any token stream that is not a
 * top-level `!`, `;`, or an unmatched close bracket. A grammar that parses a
 * custom-property value with the ordinary value production is over-narrow by
 * construction.
 */
const CUSTOM_PROPERTIES: readonly Probe[] = [
  { id: 'cp-01', name: 'ordinary custom property', source: 'a { --x: red }', valid: true, clause: 'css-variables-1 §2' },
  { id: 'cp-02', name: 'empty custom property', source: 'a { --x: }', valid: true, clause: 'css-variables-1 §2 (guaranteed-invalid, still parses)' },
  { id: 'cp-03', name: 'custom property holding a declaration block', source: 'a { --x: { color: red } }', valid: true, clause: 'css-variables-1 §2' },
  { id: 'cp-04', name: 'custom property holding arbitrary punctuation', source: 'a { --x: a + b * c }', valid: true, clause: 'css-variables-1 §2' },
  { id: 'cp-05', name: 'custom property holding a lone at-keyword', source: 'a { --x: @foo }', valid: true, clause: 'css-variables-1 §2' },
  { id: 'cp-06', name: 'custom property holding an unmatched-looking function', source: 'a { --x: foo(] bar) }', valid: false, clause: 'brackets must match in a <declaration-value>; recorded control' },
  { id: 'cp-07', name: 'custom property holding a semicolon inside brackets', source: 'a { --x: (a;b) }', valid: true, clause: 'css-variables-1 §2 (top-level ; only)' },
  { id: 'cp-08', name: 'custom property whose name is only dashes', source: 'a { --: red }', valid: true, clause: 'css-variables-1 §2 (custom property name is `--` + anything)' },
  { id: 'cp-09', name: 'custom property with an escape in the name', source: 'a { --a\\.b: red }', valid: true, clause: 'css-syntax-3 §4.3.7' },
  { id: 'cp-10', name: 'custom property holding a string with a semicolon', source: 'a { --x: "a;b" }', valid: true, clause: 'css-variables-1 §2' },
  { id: 'cp-11', name: 'custom property at the top level of @property-style rules', source: ':root { --x: 1; --y: var(--x) }', valid: true, clause: 'css-variables-1 §2' },
  { id: 'cp-12', name: 'custom property preserving comments at the edges', source: 'a { --x: /*c*/ red /*d*/ }', valid: true, clause: 'css-variables-1 §2' }
];

/*
 * Syntax-level shapes that are not tied to one construct: error-recovery inputs
 * css-syntax-3 defines an outcome for, and tokenization edge cases.
 */
const SYNTAX: readonly Probe[] = [
  { id: 'syn-01', name: 'CDO/CDC at the top level', source: '<!-- a { color: red } -->', valid: true, clause: 'css-syntax-3 §5.4.1' },
  { id: 'syn-02', name: 'unclosed block at EOF', source: 'a { color: red', valid: true, clause: 'css-syntax-3 §5.3.2 (EOF closes open blocks)' },
  { id: 'syn-03', name: 'unclosed string at EOF', source: 'a { content: "x', valid: true, clause: 'css-syntax-3 §4.3.5 (EOF ends the string)' },
  { id: 'syn-04', name: 'unclosed comment at EOF', source: 'a { color: red } /* x', valid: true, clause: 'css-syntax-3 §4.3.2' },
  { id: 'syn-05', name: 'stray semicolons between rules', source: ';;a { color: red };;', valid: true, clause: 'css-syntax-3 §5.4.1' },
  { id: 'syn-06', name: 'form feed as whitespace', source: 'a{ color: red }', valid: true, clause: 'css-syntax-3 §4.2' },
  { id: 'syn-07', name: 'CR LF line ending', source: 'a {\r\n color: red\r\n}', valid: true, clause: 'css-syntax-3 §3.3' },
  { id: 'syn-08', name: 'BOM at the start', source: '﻿a { color: red }', valid: true, clause: 'css-syntax-3 §3.2' },
  { id: 'syn-09', name: 'NULL byte becomes U+FFFD', source: 'a { content: " " }', valid: true, clause: 'css-syntax-3 §3.3' },
  { id: 'syn-10', name: 'declaration with no trailing semicolon before }', source: 'a { color: red }', valid: true, clause: 'css-syntax-3 §5.4.7' }
];

export const OVER_NARROW_PROBES: readonly Probe[] = [
  ...SELECTORS,
  ...VALUES,
  ...AT_RULES,
  ...CUSTOM_PROPERTIES,
  ...SYNTAX
];

export const PROBE_GROUPS = {
  selectors: SELECTORS,
  values: VALUES,
  atRules: AT_RULES,
  customProperties: CUSTOM_PROPERTIES,
  syntax: SYNTAX
} as const;
