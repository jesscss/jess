/*
 * The targeted channel of the cross-dialect acceptance matrix.
 *
 * ## What this enumerates, and why it is at-rules
 *
 * There are two families here. The first, and the one this file was built for,
 * lives in the STATEMENT PRELUDE of an at-rule; the second is the VALUE
 * position, added after an at-rule-only corpus proved blind to a live
 * violation (see `VALUE_PROBES` at the bottom).
 *
 * ## The at-rule family
 *
 * Both known violations of the cross-dialect superset ruling found so far live
 * in the STATEMENT PRELUDE of an at-rule:
 *
 *  - `@charset "utf-8";` followed by `@import "a.css";` — the canonical
 *    prologue of css-syntax-3 §3.2 / css-cascade-5 §3 — was rejected by `css`
 *    and accepted by all three supersets, until `7d32a7fca`.
 *  - `@namespace url(http://x);` — css-namespaces-3 §2 admits `<url>` as well
 *    as `<string>` — is rejected by `css` and accepted by all three supersets.
 *    It reproduces with the at-rule ALONE and after a rule, so what is missing
 *    is the generic statement prelude, not anything about namespaces.
 *
 * That is the shape the targeted channel is built to hit: for every at-keyword
 * the specs define, probe it ALONE, IN SEQUENCE with its neighbours, with a
 * QUOTED prelude, with an UNQUOTED `url()` prelude, and WITH and WITHOUT a
 * block. The breadth channel (real stylesheets, see the gate) cannot reach
 * these — a real stylesheet uses one spelling of `@import` and never writes
 * `@namespace` at all.
 *
 * ## The enumeration is from the SPECS, not from the grammars
 *
 * A checklist read off the grammars can only report that the grammars cover
 * what the grammars cover. `@keyframes` had no CSS fixture at all while four
 * suites stayed green, and `@charset` had no named production in scss at all —
 * it was folded into a `@(?:charset|namespace|layer)` regex arm. Neither is
 * visible to anything that reads the grammar sources.
 *
 * ## Names, not counts
 *
 * Every probe carries a stable `id`. The gate's allowlist and its coverage
 * assertions are keyed on those ids, so a probe silently dropping out of this
 * table is a loud failure rather than a slightly smaller corpus.
 *
 * ## These are NOT all valid CSS
 *
 * Deliberately. The matrix asserts two conditional directions, and an input
 * that `css` rejects is simply vacuous for direction 1. The invalid-CSS probes
 * exist for direction 2: three supersets accepting something `css` refuses is
 * the signal, whether or not the input is spec-valid, because nothing genuinely
 * dialect-specific shows up in all three at once. Where the answer turns out to
 * be permissiveness rather than a CSS gap, the gate records it by name.
 */

/** At-keywords enumerated from the CSS specs, for the coverage assertion. */
export const AT_KEYWORDS = [
  '@charset',
  '@import',
  '@namespace',
  '@media',
  '@supports',
  '@layer',
  '@container',
  '@scope',
  '@property',
  '@font-face',
  '@keyframes',
  '@counter-style',
  '@page',
  '@starting-style',
  '@view-transition'
] as const;

export type AtKeyword = (typeof AT_KEYWORDS)[number];

/** The prelude/block axis a probe exercises. Used only for reporting. */
export type ProbeShape =
  | 'alone'
  | 'sequence'
  | 'quoted-prelude'
  | 'url-prelude'
  | 'with-block'
  | 'without-block';

export interface Probe {
  /** Stable id. The allowlist and the coverage assertions key on this. */
  readonly id: string;
  readonly atKeyword: AtKeyword;
  readonly shape: ProbeShape;
  readonly source: string;
}

export const TARGETED_PROBES: readonly Probe[] = [
  // ------------------------------------------------------------- @charset
  { id: '@charset alone', atKeyword: '@charset', shape: 'alone', source: '@charset "utf-8";' },
  {
    id: '@charset then @import — the canonical prologue',
    atKeyword: '@charset',
    shape: 'sequence',
    source: '@charset "utf-8";\n@import "a.css";'
  },
  {
    id: '@charset then @namespace',
    atKeyword: '@charset',
    shape: 'sequence',
    source: '@charset "utf-8";\n@namespace "http://x";'
  },
  {
    id: '@charset then a rule',
    atKeyword: '@charset',
    shape: 'sequence',
    source: '@charset "utf-8";\na { color: red }'
  },
  {
    id: '@charset with a url() prelude',
    atKeyword: '@charset',
    shape: 'url-prelude',
    source: '@charset url(utf-8);'
  },

  // -------------------------------------------------------------- @import
  { id: '@import quoted', atKeyword: '@import', shape: 'quoted-prelude', source: '@import "a.css";' },
  { id: '@import url() quoted', atKeyword: '@import', shape: 'quoted-prelude', source: '@import url("a.css");' },
  { id: '@import url() unquoted', atKeyword: '@import', shape: 'url-prelude', source: '@import url(a.css);' },
  {
    id: '@import url() unquoted with media',
    atKeyword: '@import',
    shape: 'url-prelude',
    source: '@import url(a.css) screen;'
  },
  { id: '@import with layer()', atKeyword: '@import', shape: 'quoted-prelude', source: '@import "a.css" layer(base);' },
  { id: '@import with bare layer', atKeyword: '@import', shape: 'quoted-prelude', source: '@import "a.css" layer;' },
  {
    id: '@import with supports()',
    atKeyword: '@import',
    shape: 'quoted-prelude',
    source: '@import "a.css" supports(display: grid);'
  },
  {
    id: '@import then a rule',
    atKeyword: '@import',
    shape: 'sequence',
    source: '@import "a.css";\na { color: red }'
  },
  {
    id: '@import after a rule',
    atKeyword: '@import',
    shape: 'sequence',
    source: 'a { color: red }\n@import "a.css";'
  },
  { id: '@import with a block', atKeyword: '@import', shape: 'with-block', source: '@import "a.css" { color: red }' },

  // ----------------------------------------------------------- @namespace
  { id: '@namespace quoted', atKeyword: '@namespace', shape: 'quoted-prelude', source: '@namespace "http://x";' },
  {
    id: '@namespace url() quoted',
    atKeyword: '@namespace',
    shape: 'quoted-prelude',
    source: '@namespace url("http://x");'
  },
  { id: '@namespace url() unquoted', atKeyword: '@namespace', shape: 'url-prelude', source: '@namespace url(http://x);' },
  {
    id: '@namespace prefixed quoted',
    atKeyword: '@namespace',
    shape: 'quoted-prelude',
    source: '@namespace svg "http://x";'
  },
  {
    id: '@namespace prefixed url() unquoted',
    atKeyword: '@namespace',
    shape: 'url-prelude',
    source: '@namespace svg url(http://x);'
  },
  {
    id: '@namespace url() unquoted after a rule',
    atKeyword: '@namespace',
    shape: 'sequence',
    source: 'a { color: red }\n@namespace url(http://x);'
  },
  {
    id: '@namespace url() unquoted after @charset',
    atKeyword: '@namespace',
    shape: 'sequence',
    source: '@charset "utf-8";\n@namespace url(http://x);'
  },

  // --------------------------------------------------------------- @media
  { id: '@media with a block', atKeyword: '@media', shape: 'with-block', source: '@media screen { a { color: red } }' },
  { id: '@media empty block', atKeyword: '@media', shape: 'with-block', source: '@media screen {}' },
  { id: '@media without a block', atKeyword: '@media', shape: 'without-block', source: '@media screen;' },
  {
    id: '@media feature range',
    atKeyword: '@media',
    shape: 'with-block',
    source: '@media (400px <= width <= 700px) { a { color: red } }'
  },
  {
    id: '@media then a rule',
    atKeyword: '@media',
    shape: 'sequence',
    source: '@media screen { a { color: red } }\nb { color: blue }'
  },

  // ------------------------------------------------------------ @supports
  {
    id: '@supports with a block',
    atKeyword: '@supports',
    shape: 'with-block',
    source: '@supports (display: grid) { a { color: red } }'
  },
  { id: '@supports without a block', atKeyword: '@supports', shape: 'without-block', source: '@supports (display: grid);' },
  {
    id: '@supports selector()',
    atKeyword: '@supports',
    shape: 'with-block',
    source: '@supports selector(a > b) { a { color: red } }'
  },

  // --------------------------------------------------------------- @layer
  { id: '@layer statement', atKeyword: '@layer', shape: 'without-block', source: '@layer base;' },
  { id: '@layer statement list', atKeyword: '@layer', shape: 'without-block', source: '@layer a, b;' },
  { id: '@layer anonymous block', atKeyword: '@layer', shape: 'with-block', source: '@layer { a { color: red } }' },
  { id: '@layer named block', atKeyword: '@layer', shape: 'with-block', source: '@layer base { a { color: red } }' },
  {
    id: '@layer statement then @import',
    atKeyword: '@layer',
    shape: 'sequence',
    source: '@layer base;\n@import "a.css";'
  },
  { id: '@layer with a url() prelude', atKeyword: '@layer', shape: 'url-prelude', source: '@layer url(base);' },

  // ----------------------------------------------------------- @container
  {
    id: '@container unnamed',
    atKeyword: '@container',
    shape: 'with-block',
    source: '@container (min-width: 1px) { a { color: red } }'
  },
  {
    id: '@container named',
    atKeyword: '@container',
    shape: 'with-block',
    source: '@container card (min-width: 1px) { a { color: red } }'
  },
  {
    id: '@container style()',
    atKeyword: '@container',
    shape: 'with-block',
    source: '@container style(--x: 1) { a { color: red } }'
  },
  {
    id: '@container without a block',
    atKeyword: '@container',
    shape: 'without-block',
    source: '@container (min-width: 1px);'
  },

  // --------------------------------------------------------------- @scope
  { id: '@scope bare', atKeyword: '@scope', shape: 'with-block', source: '@scope { a { color: red } }' },
  { id: '@scope with a root', atKeyword: '@scope', shape: 'with-block', source: '@scope (.a) { a { color: red } }' },
  {
    id: '@scope with a root and a limit',
    atKeyword: '@scope',
    shape: 'with-block',
    source: '@scope (.a) to (.b) { a { color: red } }'
  },
  { id: '@scope without a block', atKeyword: '@scope', shape: 'without-block', source: '@scope (.a);' },

  // ------------------------------------------------------------ @property
  {
    id: '@property with a block',
    atKeyword: '@property',
    shape: 'with-block',
    source: '@property --x { syntax: "*"; inherits: false; }'
  },
  {
    id: '@property with an initial-value',
    atKeyword: '@property',
    shape: 'with-block',
    source: '@property --x { syntax: "<length>"; inherits: false; initial-value: 0px; }'
  },
  { id: '@property without a block', atKeyword: '@property', shape: 'without-block', source: '@property --x;' },

  // ----------------------------------------------------------- @font-face
  {
    id: '@font-face with a block',
    atKeyword: '@font-face',
    shape: 'with-block',
    source: '@font-face { font-family: a; src: url(a.woff2); }'
  },
  {
    id: '@font-face src url() unquoted with format()',
    atKeyword: '@font-face',
    shape: 'url-prelude',
    source: '@font-face { font-family: a; src: url(a.woff2) format("woff2"); }'
  },
  { id: '@font-face empty block', atKeyword: '@font-face', shape: 'with-block', source: '@font-face {}' },
  { id: '@font-face without a block', atKeyword: '@font-face', shape: 'without-block', source: '@font-face;' },

  // ----------------------------------------------------------- @keyframes
  {
    id: '@keyframes percentage selectors',
    atKeyword: '@keyframes',
    shape: 'with-block',
    source: '@keyframes a { 0% { opacity: 0 } 100% { opacity: 1 } }'
  },
  {
    id: '@keyframes from/to selectors',
    atKeyword: '@keyframes',
    shape: 'with-block',
    source: '@keyframes a { from { opacity: 0 } to { opacity: 1 } }'
  },
  { id: '@keyframes empty block', atKeyword: '@keyframes', shape: 'with-block', source: '@keyframes a {}' },
  { id: '@keyframes without a block', atKeyword: '@keyframes', shape: 'without-block', source: '@keyframes a;' },

  // ------------------------------------------------------- @counter-style
  {
    id: '@counter-style with a block',
    atKeyword: '@counter-style',
    shape: 'with-block',
    source: '@counter-style a { system: cyclic; symbols: "x"; suffix: " "; }'
  },
  {
    id: '@counter-style without a block',
    atKeyword: '@counter-style',
    shape: 'without-block',
    source: '@counter-style a;'
  },

  // ---------------------------------------------------------------- @page
  { id: '@page bare', atKeyword: '@page', shape: 'with-block', source: '@page { margin: 1cm }' },
  { id: '@page with a pseudo', atKeyword: '@page', shape: 'with-block', source: '@page :first { margin: 1cm }' },
  { id: '@page named', atKeyword: '@page', shape: 'with-block', source: '@page narrow { margin: 1cm }' },
  {
    id: '@page with a margin at-rule',
    atKeyword: '@page',
    shape: 'with-block',
    source: '@page { @top-center { content: "x" } }'
  },
  { id: '@page without a block', atKeyword: '@page', shape: 'without-block', source: '@page;' },

  // ------------------------------------------------------- @starting-style
  {
    id: '@starting-style with a block',
    atKeyword: '@starting-style',
    shape: 'with-block',
    source: '@starting-style { a { opacity: 0 } }'
  },
  {
    id: '@starting-style nested in a rule',
    atKeyword: '@starting-style',
    shape: 'with-block',
    source: 'a { @starting-style { opacity: 0 } }'
  },
  {
    id: '@starting-style without a block',
    atKeyword: '@starting-style',
    shape: 'without-block',
    source: '@starting-style;'
  },

  // ------------------------------------------------------ @view-transition
  {
    id: '@view-transition with a block',
    atKeyword: '@view-transition',
    shape: 'with-block',
    source: '@view-transition { navigation: auto; }'
  },
  {
    id: '@view-transition without a block',
    atKeyword: '@view-transition',
    shape: 'without-block',
    source: '@view-transition;'
  }
];

/*
 * ---------------------------------------------------------------------------
 * The VALUE-position channel.
 *
 * ## Why it exists
 *
 * The at-rule probes above found nothing in the value position, because they
 * never look at one. `min(U+0-7F)` was measured as
 * `css/less/scss accept, jess reject` — a live DIRECTION 1 violation over
 * plain CSS — with this gate fully green. The cause was that the jess grammar
 * had NO `<urange>` production at all, so `a { b: U+0-7F }` did not parse
 * either; the math-function spelling was just where it was first noticed.
 * An at-rule-only corpus cannot see any of that.
 *
 * ## What the axes are
 *
 * The declaration value is where the four grammars diverge most: each dialect
 * adds its own operand forms (`@var`, `$var`, `${…}`) to a CSS production, and
 * a dialect's copy of the CSS value ladder can silently DROP an arm. So the
 * axes are the CSS value ATOM kinds (`<urange>`, `<string>`, `<hex-color>`,
 * `<dimension>`, custom property, `var()`), each probed BARE and again as a
 * math-function ARGUMENT — the two ladders a dialect can implement
 * inconsistently, and the pair that separated jess's defect from its symptom.
 *
 * ## Why the §6.2 neighbours are in here
 *
 * `docs/design/RESOLVED-SEMANTICS-AND-NAMING.md` §6.2 refuted routing math
 * arguments through a `<calc-sum>` ladder, and named the constructs that would
 * regress if anyone tried again: space-separated runs (`min(1px 2px)`,
 * `min(red blue)`, `clamp(1px 2px, 3px)`), the inert `%` (`min(10px%3)`), and
 * `/` as a separator rather than division (`min(4px / 2)`, `min(a / b)`). None
 * is valid CSS as written and that is irrelevant — the parser accepts SHAPES,
 * not semantics, all four accept them today, and narrowing any of them is a
 * regression. Pinning them here is what makes that refutation enforceable
 * rather than a paragraph.
 */

/** The value-atom axis a probe exercises. Used only for reporting. */
export type ValueAxis =
  | 'urange'
  | 'string'
  | 'color'
  | 'dimension'
  | 'custom-property'
  | 'var'
  | 'space-run'
  | 'operator';

/** The ladder the atom sits in: a bare value, or a math-function argument. */
export type ValuePosition = 'bare' | 'math-argument';

export interface ValueProbe {
  /** Stable id. The allowlist and the coverage assertions key on this. */
  readonly id: string;
  readonly axis: ValueAxis;
  readonly position: ValuePosition;
  readonly source: string;
}

/** The value-atom axes enumerated above, for the coverage assertion. */
export const VALUE_AXES = [
  'urange',
  'string',
  'color',
  'dimension',
  'custom-property',
  'var',
  'space-run',
  'operator'
] as const satisfies readonly ValueAxis[];

export const VALUE_PROBES: readonly ValueProbe[] = [
  // ----------------------------------------------------------------- urange
  /*
   * css-syntax-3 §4.3.15 / css-values-4 §3.4. The whole family is here because
   * jess had no `<urange>` rule at all: bare, in its real home (`@font-face`),
   * comma-separated, wildcarded, and inside both math ladders.
   */
  { id: 'urange bare', axis: 'urange', position: 'bare', source: 'a { b: U+0-7F }' },
  {
    id: 'urange in unicode-range',
    axis: 'urange',
    position: 'bare',
    source: '@font-face { unicode-range: U+0-7F }'
  },
  { id: 'urange comma list', axis: 'urange', position: 'bare', source: 'a { b: U+26, U+27 }' },
  { id: 'urange wildcard', axis: 'urange', position: 'bare', source: 'a { b: U+4?? }' },
  { id: 'urange lowercase', axis: 'urange', position: 'bare', source: 'a { b: u+400-4ff }' },
  {
    id: 'urange in min() — the measured violation',
    axis: 'urange',
    position: 'math-argument',
    source: 'a { b: min(U+0-7F) }'
  },
  { id: 'urange in calc()', axis: 'urange', position: 'math-argument', source: 'a { b: calc(U+0-7F) }' },
  {
    id: 'urange in clamp()',
    axis: 'urange',
    position: 'math-argument',
    source: 'a { b: clamp(U+26, U+27, U+28) }'
  },

  // ------------------------------------------- the other CSS value atoms
  /*
   * The same atom kinds, bare and as a math argument. A dialect that drops an
   * arm from its copy of one ladder and not the other shows up as a row where
   * the two positions disagree.
   */
  { id: 'string bare', axis: 'string', position: 'bare', source: 'a { b: "x" }' },
  { id: 'string in min()', axis: 'string', position: 'math-argument', source: 'a { b: min("x") }' },
  { id: 'hex color bare', axis: 'color', position: 'bare', source: 'a { b: #fff }' },
  { id: 'hex color in min()', axis: 'color', position: 'math-argument', source: 'a { b: min(#fff) }' },
  { id: 'dimension bare', axis: 'dimension', position: 'bare', source: 'a { b: 1px }' },
  { id: 'dimension in min()', axis: 'dimension', position: 'math-argument', source: 'a { b: min(1px, 2px) }' },
  { id: 'percentage in min()', axis: 'dimension', position: 'math-argument', source: 'a { b: min(50%, 2px) }' },
  { id: 'custom property bare', axis: 'custom-property', position: 'bare', source: 'a { b: --x }' },
  {
    id: 'custom property in min()',
    axis: 'custom-property',
    position: 'math-argument',
    source: 'a { b: min(--x) }'
  },
  { id: 'var() bare', axis: 'var', position: 'bare', source: 'a { b: var(--x) }' },
  { id: 'var() in min()', axis: 'var', position: 'math-argument', source: 'a { b: min(1px, var(--x)) }' },

  // --------------------------------------- the §6.2 neighbours, pinned
  /*
   * Not valid CSS, deliberately. §6.2 measured 17 regressions in a 25-case
   * battery from routing math arguments through `<calc-sum>`, and these are the
   * named survivors of that refutation. All four dialects accept them today.
   */
  { id: 'space-run in min()', axis: 'space-run', position: 'math-argument', source: 'a { b: min(1px 2px) }' },
  { id: 'keyword space-run in min()', axis: 'space-run', position: 'math-argument', source: 'a { b: min(red blue) }' },
  {
    id: 'space-run in clamp()',
    axis: 'space-run',
    position: 'math-argument',
    source: 'a { b: clamp(1px 2px, 3px) }'
  },
  { id: 'inert % in min()', axis: 'operator', position: 'math-argument', source: 'a { b: min(10px%3) }' },
  { id: 'slash in min()', axis: 'operator', position: 'math-argument', source: 'a { b: min(4px / 2) }' },
  { id: 'keyword slash in min()', axis: 'operator', position: 'math-argument', source: 'a { b: min(a / b) }' },
  { id: 'calc() addition', axis: 'operator', position: 'math-argument', source: 'a { b: calc(1px + 2px) }' }
];
