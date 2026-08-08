/**
 * Conversion construct-support matrix — what blocks `.less`/`.scss` → `.jess`.
 *
 * This is the inventory behind the cross-dialect equivalence harness designed in
 * `docs/design/JESS-EQUIVALENCE-HARNESS.md`. That harness asserts
 *
 *   .less → .css   ==   .less → .jess → .css
 *
 * with BOTH arms running through jess's own engine. It cannot be built yet: no
 * `.less`/`.scss` → `.jess` converter exists, and no `.jess` source emitter
 * exists (see the design doc for the evidence and the scoping).
 *
 * What CAN be measured today is the harness's PRECONDITION. Conversion is only
 * possible where the `.jess` dialect can express the source construct at all, so
 * every row below is the smallest snippet isolating one construct, recorded
 * against the real `.jess` parser. A row that cannot parse is a construct the
 * converter could not emit even if it existed — which makes this list the
 * concrete blocking-construct roadmap, available before the converter is.
 *
 * RATCHET, not gate. `supported` rows must keep parsing; `!supported` rows are
 * recorded gaps. Closing a gap trips the "unexpectedly supported" check so the
 * inventory can never silently rot — flip the flag in the same commit.
 *
 * `origin` splits the two arms, because they carry different obligations:
 *
 *   'less'  — Less compatibility is a real goal, so a gap here IS a gap.
 *   'sass'  — `.jess`'s SCSS surface is Sass+, a DELIBERATE subset. A Sass
 *             feature Sass+ does not intend to support is out of scope, not a
 *             failure, and is recorded as `scope: 'by-design'`.
 *   'css'   — plain CSS, valid in every dialect. A gap here is unambiguously a
 *             bug: it fails in `.jess` while css/less/scss all accept it.
 *
 * `scope` separates real work from deliberate non-support and from genuinely
 * open questions, so the list stays actionable instead of becoming a wall of
 * undifferentiated failures:
 *
 *   'gap'       — intended surface that does not work. Actionable.
 *   'by-design' — deliberately unsupported. Recorded, not counted as a failure.
 *   'undecided' — intent is not written down anywhere in the repo. For the owner.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

interface Construct {
  group: string;
  name: string;

  /** Smallest `.jess` snippet expressing the construct. */
  src: string;

  /** Whether the `.jess` parser currently accepts it. */
  supported: boolean;
  origin: 'css' | 'less' | 'sass';
  scope?: 'gap' | 'by-design' | 'undecided';

  /** For gaps: the narrower form that DOES work, when one exists. */
  note?: string;
}

const CONSTRUCTS: Construct[] = [
  /*
   * ── baseline: the documented migration mapping ─────────────────────────────
   * Every row here is a spelling asserted by
   * `packages/docs/docs-content/docs/shared/04-guides/03-migrating-to-jess.mdx`.
   */
  { group: 'documented-mapping', name: '@-import file-relative', src: '@-import "./variables";', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: '@-compose module', src: '@-compose "./theme";', supported: true, origin: 'sass' },
  { group: 'documented-mapping', name: '@-compose ... as', src: '@-compose "./theme" as t;', supported: true, origin: 'sass' },
  { group: 'documented-mapping', name: '$var declaration', src: '$color: #06c;', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: '$^var declaration', src: '$^color: #06c;', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: '$^var reference (from Less @var)', src: '$color: #06c;\n.a { value: $^color; }', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: '$var reference (from Sass $var)', src: '$color: #06c;\n.a { value: $color; }', supported: true, origin: 'sass' },
  { group: 'documented-mapping', name: 'expression $(^w + 1)', src: '$width: 1px;\n.a { value: $(^width + 1); }', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: 'expression $($w / 2)', src: '$width: 1px;\n.a { value: $($width / 2); }', supported: true, origin: 'sass' },
  { group: 'documented-mapping', name: 'mixin def .box()', src: '.box() {}', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: 'mixin def, multiline params', src: '.with-params(\n  $param1: 1,\n  $param2: 2\n) {}', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: 'mixin def box() (from @mixin)', src: 'box() {}', supported: true, origin: 'sass' },
  { group: 'documented-mapping', name: 'mixin call $ > .box()', src: '.box() {}\n$ > .box();', supported: true, origin: 'less' },
  { group: 'documented-mapping', name: 'mixin call $ > box()', src: 'box() {}\n$ > box();', supported: true, origin: 'sass' },
  {
    group: 'documented-mapping',
    name: '@-compose ... with { } configuration',
    src: '@-compose "./theme" with { $a: 1; };',
    supported: false,
    origin: 'sass',
    scope: 'gap',
    note:
      'The migration guide documents `with { }` as THE Sass `@use ... with` mapping, but the '
      + '`@-compose` production accepts only `<quoted> [as <name>] [;]` — there is no `with` '
      + 'clause in the grammar at all. `@-compose "./t" as t;` works.'
  },

  // ── plain CSS: a gap here is unambiguously a bug ───────────────────────────
  { group: 'css', name: '& parent reference', src: '.a { &:hover { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: '&__el BEM concatenation', src: '.a { &__el { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: '& + & repeated', src: '.a { & + & { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: ':not(&)', src: '.a { :not(&) { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: '// line comment', src: '// c\n.a { color: red; }', supported: true, origin: 'less' },
  { group: 'css', name: 'calc() without an operator', src: '.a { width: calc(1px); }', supported: true, origin: 'css' },
  { group: 'css', name: 'clamp() / min() / max()', src: '.a { width: clamp(1px, 2vw, 3px); }', supported: true, origin: 'css' },
  { group: 'css', name: '@layer', src: '@layer base { .a { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: '@container', src: '@container (min-width: 1px) { .a { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: '@property', src: '@property --x { syntax: "<length>"; inherits: false; initial-value: 0px; }', supported: true, origin: 'css' },
  { group: 'css', name: '@media range syntax', src: '@media (400px <= width <= 700px) { .a { color: red; } }', supported: true, origin: 'css' },
  { group: 'css', name: 'calc() with an operator', src: '.a { width: calc(100% - 10px); }', supported: true, origin: 'css' },
  {
    group: 'css',
    name: 'unicode-range',
    src: '@font-face { unicode-range: U+0-7F; }',
    supported: false,
    origin: 'css',
    scope: 'gap',
    note:
      'css/less/scss parsers all accept this; `.jess` alone rejects it, in every form tried '
      + '(`U+26`, `U+0-7F`, `U+4??`). Blocks any @font-face-bearing stylesheet.'
  },

  // ── control flow ───────────────────────────────────────────────────────────
  { group: 'control-flow', name: '$if', src: '$a: 1;\n$if ($a = 1) { .x {} }', supported: true, origin: 'less' },
  { group: 'control-flow', name: '$if / $else', src: '$a: 1;\n$if ($a = 1) { .x {} } $else { .y {} }', supported: true, origin: 'less' },
  { group: 'control-flow', name: '$else if', src: '$a: 1;\n$if ($a = 1) { .x {} } $else if ($a = 2) { .y {} }', supported: true, origin: 'sass' },
  { group: 'control-flow', name: '$for over a list (from @each)', src: '$l: 1, 2;\n$for ($v of $l) { .a { width: $v; } }', supported: true, origin: 'sass' },
  { group: 'control-flow', name: '$for with value and key', src: '$l: 1, 2;\n$for ($v, $k of $l) { .a { width: $v; } }', supported: true, origin: 'sass' },
  { group: 'control-flow', name: '$while', src: '$i: 0;\n$while ($i < 3) { .a { color: red; } }', supported: true, origin: 'sass' },

  // ── mixins ─────────────────────────────────────────────────────────────────
  { group: 'mixins', name: 'guard: when (cond)', src: '.m($x) when ($x = 1) { w: $x; }', supported: true, origin: 'less' },
  { group: 'mixins', name: 'guard: grouped and', src: '.m($x) when (($x = 1) and ($x > 0)) { w: $x; }', supported: true, origin: 'less' },
  { group: 'mixins', name: 'guard: grouped not', src: '.m($x) when ((not ($x = 1))) { w: $x; }', supported: true, origin: 'less' },
  { group: 'mixins', name: 'guard: default()', src: '.m($x) when (default()) { w: $x; }', supported: true, origin: 'less' },
  { group: 'mixins', name: 'default parameter value', src: '.m($x: dark) { c: black; }', supported: true, origin: 'less' },
  { group: 'mixins', name: 'namespaced call', src: '#ns() { .m() { c: red; } }\n.a { $ > #ns > .m(); }', supported: true, origin: 'less' },
  { group: 'mixins', name: 'anonymous-mixin declaration', src: '$d: { color: red; };', supported: true, origin: 'less' },
  {
    group: 'mixins',
    name: 'guard calling a function',
    src: '.m($x) when (iscolor($x)) { w: $x; }',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note:
      'Type-check guards (`iscolor`/`isnumber`/`ispixel`…) are idiomatic Less and have no working '
      + 'spelling: neither `when (iscolor($x))` nor `when iscolor($x)` parses. Comparison guards '
      + 'like `when (($x = 1) and ($x > 0))` do work, so this is the call form specifically.'
  },
  {
    group: 'mixins',
    name: 'rest/variadic parameters',
    src: '.m($a...) { w: $a; }',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note: 'No variadic spelling parses: `$a...`, `...$a`, and bare `...` all fail.'
  },
  {
    group: 'mixins',
    name: 'literal-value pattern matching',
    src: '.m(dark) { c: black; }',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note:
      'Less dispatches on a literal argument (`.m(dark)` vs `.m(light)`). Only the named-parameter '
      + 'form `.m($x: dark)` parses, and that is a default value, not a dispatch key.'
  },
  {
    group: 'mixins',
    name: 'anonymous-mixin call',
    src: '$d: { color: red; };\n.a { $ > $d(); }',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note:
      'The DECLARATION parses but nothing calls it: neither `$ > $d()` nor `$ > $d`. Less detached '
      + 'rulesets are a common parameterisation idiom, so this strands the value once bound.'
  },
  {
    group: 'mixins',
    name: '!important on a mixin call',
    src: '.m() { w: 1; }\n.a { $ > .m() !important; }',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note: 'Less propagates `!important` to every declaration the mixin emits.'
  },

  // ── values and at-rule preludes ────────────────────────────────────────────
  { group: 'values', name: 'escaped value ~"…"', src: '.a { w: ~"calc(1px)"; }', supported: true, origin: 'less' },
  { group: 'values', name: 'e() escape function', src: '.a { w: e("x"); }', supported: true, origin: 'less' },
  { group: 'values', name: 'property-name interpolation', src: '$p: color;\n.a { ${p}: red; }', supported: true, origin: 'less' },
  { group: 'values', name: 'selector interpolation', src: '$s: foo;\n.${s} { color: red; }', supported: true, origin: 'less' },
  { group: 'values', name: 'string interpolation', src: '$n: a;\n.a { content: "${n}"; }', supported: true, origin: 'less' },
  { group: 'values', name: 'indirect reference $[$n]', src: '$n: color;\n$color: red;\n.a { c: $[$n]; }', supported: true, origin: 'less' },
  { group: 'values', name: 'collection lookup $m[k]', src: '$m: { k: 1; };\n.a { w: $m[k]; }', supported: true, origin: 'sass' },
  { group: 'values', name: '@media prelude via ${…}', src: '$m: screen;\n@media ${m} { .a { c: red; } }', supported: true, origin: 'less' },
  {
    group: 'values',
    name: '@media prelude via $[…]',
    src: '$m: screen;\n@media $[m] { .a { c: red; } }',
    supported: false,
    origin: 'less',
    scope: 'undecided',
    note:
      'The value-position form `$(m)` works. Whether the accessor form `$[m]` is ALSO meant to be '
      + 'valid in an at-rule prelude is not written down — the interpolation model says `$[…]` is '
      + 'the accessor "everywhere" and `$(…)` is value-only, which points the opposite way. Owner call.'
  },
  {
    group: 'values',
    name: '!important on a variable declaration',
    src: '$a: 1px !important;',
    supported: false,
    origin: 'less',
    scope: 'undecided',
    note:
      'Less accepts `@a: 1px !important;` and carries the flag through substitution. Whether Jess '
      + 'intends to keep that behaviour is not recorded anywhere.'
  },

  // ── imports and extend ─────────────────────────────────────────────────────
  { group: 'imports', name: '@-reference', src: '@-reference "./x";', supported: true, origin: 'less' },
  { group: 'imports', name: '@-plugin', src: '@-plugin "./p.js";', supported: true, origin: 'less' },
  { group: 'imports', name: ':extend() in a selector', src: '.a { c: red; }\n.b:extend(.a) {}', supported: true, origin: 'less' },
  { group: 'imports', name: ':extend(… all)', src: '.a { c: red; }\n.b:extend(.a all) {}', supported: true, origin: 'less' },
  {
    group: 'imports',
    name: '&:extend() in a rule body',
    src: '.a { c: red; }\n.b { &:extend(.a); }',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note:
      'Less offers both placements; only the selector placement parses. Neither `&:extend(.a);` nor '
      + '`:extend(.a);` works in body position.'
  },
  {
    group: 'imports',
    name: '@import (optional)',
    src: '@-import (optional) "./x";',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note:
      'No import OPTION keyword parses on `@-import`. `(reference)` has a dedicated `@-reference` '
      + 'at-rule, but `(optional)` / `(css)` / `(inline)` / `(once)` have no equivalent, and '
      + '`(optional)` in particular changes resolve-failure from a hard eval error to a skip.'
  },
  {
    group: 'imports',
    name: '@import (css)',
    src: '@-import (css) "./x.css";',
    supported: false,
    origin: 'less',
    scope: 'gap',
    note: 'Forces pass-through instead of evaluation. No `@-import` option syntax exists.'
  }
];

const parses = (src: string): boolean => {
  try {
    parse(src, { filename: 'construct.jess' });
    return true;
  } catch {
    return false;
  }
};

describe('conversion construct support', () => {
  const groups = [...new Set(CONSTRUCTS.map(c => c.group))];

  for (const group of groups) {
    describe(group, () => {
      for (const c of CONSTRUCTS.filter(x => x.group === group)) {
        it(`${c.supported ? 'supports' : 'does not support'}: ${c.name}`, () => {
          expect(parses(c.src)).toBe(c.supported);
        });
      }
    });
  }

  it('records a scope and a note for every gap', () => {
    const undocumented = CONSTRUCTS.filter(c => !c.supported && (!c.scope || !c.note));
    expect(undocumented.map(c => c.name)).toEqual([]);
  });

  it('never marks a supported construct as scoped', () => {
    const mislabelled = CONSTRUCTS.filter(c => c.supported && c.scope);
    expect(mislabelled.map(c => c.name)).toEqual([]);
  });
});

/**
 * The baseline — NAMED sets, never counts.
 *
 * A floor of "at least 29 supported `less` constructs" is met by any 29 of them,
 * so a commit that gains one construct and loses another reads as no change at
 * all. These lists name every construct, so the assertion failure and the git
 * diff both say which construct moved and which way.
 *
 * `vitest --run -u` does NOT regenerate these: they are hand-edited on purpose.
 * Closing a gap is a two-line edit (flip `supported`, move the name here); the
 * gate refuses to pass until both halves are done.
 */
const SUPPORTED_BASELINE: Record<'css' | 'less' | 'sass', readonly string[]> = {
  css: [
    '& + & repeated',
    '& parent reference',
    '&__el BEM concatenation',
    ':not(&)',
    '@container',
    '@layer',
    '@media range syntax',
    '@property',
    'calc() with an operator',
    'calc() without an operator',
    'clamp() / min() / max()'
  ],
  less: [
    '$^var declaration',
    '$^var reference (from Less @var)',
    '$if',
    '$if / $else',
    '$var declaration',
    '// line comment',
    ':extend() in a selector',
    ':extend(… all)',
    '@-import file-relative',
    '@-plugin',
    '@-reference',
    '@media prelude via ${…}',
    'anonymous-mixin declaration',
    'default parameter value',
    'e() escape function',
    'escaped value ~"…"',
    'expression $(^w + 1)',
    'guard: default()',
    'guard: grouped and',
    'guard: grouped not',
    'guard: when (cond)',
    'indirect reference $[$n]',
    'mixin call $ > .box()',
    'mixin def .box()',
    'mixin def, multiline params',
    'namespaced call',
    'property-name interpolation',
    'selector interpolation',
    'string interpolation'
  ],
  sass: [
    '$else if',
    '$for over a list (from @each)',
    '$for with value and key',
    '$var reference (from Sass $var)',
    '$while',
    '@-compose ... as',
    '@-compose module',
    'collection lookup $m[k]',
    'expression $($w / 2)',
    'mixin call $ > box()',
    'mixin def box() (from @mixin)'
  ]
};

/** Which gap sits in which scope, by name — not how many sit in each. */
const GAP_SCOPE_BASELINE: Record<'gap' | 'by-design' | 'undecided', readonly string[]> = {
  gap: [
    '!important on a mixin call',
    '&:extend() in a rule body',
    '@-compose ... with { } configuration',
    '@import (css)',
    '@import (optional)',
    'anonymous-mixin call',
    'guard calling a function',
    'literal-value pattern matching',
    'rest/variadic parameters',
    'unicode-range'
  ],
  'by-design': [],
  undecided: [
    '!important on a variable declaration',
    '@media prelude via $[…]'
  ]
};

describe('conversion support ratchet', () => {
  for (const origin of ['css', 'less', 'sass'] as const) {
    it(`${origin}: supported construct SET matches the baseline`, () => {
      const supported = CONSTRUCTS.filter(c => c.origin === origin && c.supported).map(c => c.name).sort();
      expect(supported).toEqual([...SUPPORTED_BASELINE[origin]].sort());
    });
  }

  for (const scope of ['gap', 'by-design', 'undecided'] as const) {
    it(`${scope}: gap SET matches the baseline`, () => {
      const named = CONSTRUCTS.filter(c => !c.supported && c.scope === scope).map(c => c.name).sort();
      expect(named).toEqual([...GAP_SCOPE_BASELINE[scope]].sort());
    });
  }
});
