/*
 * The targeted channel of the cross-dialect acceptance matrix.
 *
 * ## What this enumerates, and why it is at-rules
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
