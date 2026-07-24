/**
 * SCSS construct-support matrix — the categorized gap inventory.
 *
 * Each case is the SMALLEST snippet that isolates one construct, so a failure
 * names the construct rather than the file that happened to contain it. This is
 * what turns the Bootstrap corpus outcome ("63/92 files fail to parse") into an
 * actionable list.
 *
 * SCSS is an explicit NON-GOAL for feature completeness — it only has to prove
 * the eval MODEL/shape is right. So this is a RATCHET, not a gate: `supported`
 * cases must keep parsing, `unsupported` cases are recorded as known gaps. When
 * a gap is closed, flip its flag; a gap that closes on its own trips the
 * "unexpectedly supported" check below so the inventory can never silently rot.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

interface Construct {
  /** Category the construct belongs to, used to group the inventory. */
  group: string;
  name: string;
  src: string;
  /** Whether the SCSS parser currently accepts it. */
  supported: boolean;
  /** For gaps: the narrower form that DOES work, when one exists. */
  note?: string;
}

const CONSTRUCTS: Construct[] = [
  // ── baseline: things that work ─────────────────────────────────────────────
  { group: 'baseline', name: 'plain rule', src: '.a { color: red; }', supported: true },
  { group: 'baseline', name: 'nesting with &', src: '.a { &:hover { color: red; } }', supported: true },
  { group: 'baseline', name: 'nested selector list', src: '.a {\n  &:hover,\n  &:focus { color: red; }\n}', supported: true },
  { group: 'baseline', name: 'nested @media', src: '.a { @media (min-width: 1px) { color: red; } }', supported: true },

  // ── variables and values ───────────────────────────────────────────────────
  { group: 'variables', name: '$var declaration', src: '$a: 1px;', supported: true },
  { group: 'variables', name: '$var !default', src: '$a: 1px !default;', supported: true },
  { group: 'variables', name: '$var !global', src: '.a { $x: 1 !global; }', supported: true },
  { group: 'variables', name: 'null keyword', src: '$a: null;', supported: true },
  { group: 'variables', name: 'negative variable', src: '.a { margin: -$x; }', supported: true },
  { group: 'variables', name: 'string concatenation', src: '$a: "x" + "y";', supported: true },

  // ── maps and lists ─────────────────────────────────────────────────────────
  { group: 'maps', name: 'map literal', src: '$m: (a: 1, b: 2);', supported: true },
  { group: 'maps', name: 'map literal, multiline', src: '$m: (\n  a: 1,\n  b: 2\n);', supported: true },
  { group: 'maps', name: 'nested map', src: '$m: (a: (b: 1));', supported: true },
  { group: 'maps', name: 'function call in map value', src: '$m: (a: rgba(0,0,0,.5));', supported: true },
  { group: 'maps', name: 'map-get / map-keys / map-merge', src: '$u: map-merge(\n  (\n    "a": 1\n  ),\n  $x\n);', supported: true },
  { group: 'maps', name: 'nested paren list, single line', src: '$e: (("<", "%3c"), (">", "%3e"));', supported: true },
  {
    group: 'maps',
    name: 'nested paren list, multiline',
    src: '$e: (\n  ("<", "%3c"),\n  (">", "%3e")\n);',
    supported: false,
    note: 'the single-line form parses; a newline before the inner `(` does not'
  },
  {
    group: 'maps',
    name: 'multiline paren list as a function argument',
    src: '$u: f(\n  $x,\n  (\n    "a",\n    "b"\n  )\n);',
    supported: false,
    note: 'same boundary as the multiline nested paren list'
  },
  {
    group: 'maps',
    name: 'line comment inside a paren list',
    src: '$m: (\n  // c\n  a: 1\n);',
    supported: false,
    note: 'comments parse fine at top level and inside rule bodies'
  },

  // ── control flow ───────────────────────────────────────────────────────────
  { group: 'control flow', name: '@if with a comparison', src: '@if $x == 1 { c: red; }', supported: true },
  { group: 'control flow', name: '@if with `and` of comparisons', src: '@if $x != 1 and $y != 2 { c: red; }', supported: true },
  { group: 'control flow', name: '@else / @else if', src: '@if $x == 1 { c: red; } @else if $y == 2 { c: blue; } @else { c: green; }', supported: true },
  { group: 'control flow', name: '@if with a boolean literal', src: '@if true { c: red; }', supported: true },
  {
    group: 'control flow',
    name: '@if with a bare truthy variable',
    src: '@if $x { c: red; }',
    supported: false,
    note: 'the condition grammar requires a binary comparison; a bare operand is rejected'
  },
  {
    group: 'control flow',
    name: '@if with a bare function call',
    src: '@if fn($x) { c: red; }',
    supported: false,
    note: 'same bare-operand boundary'
  },
  {
    group: 'control flow',
    name: '@if with `not`',
    src: '@if not $x { c: red; }',
    supported: false,
    note: 'same bare-operand boundary'
  },
  {
    group: 'control flow',
    name: '@if with a parenthesized bare operand',
    src: '@if ($x) { c: red; }',
    supported: false,
    note: 'same bare-operand boundary'
  },
  { group: 'control flow', name: '@each over a list', src: '@each $x in a, b { .#{$x}-y { color: red; } }', supported: true },
  { group: 'control flow', name: '@each with destructuring', src: '@each $k, $v in $map { .k-#{$k} { color: $v; } }', supported: true },
  { group: 'control flow', name: '@each over a function call', src: '@each $b in map-keys($grid) { .b-#{$b} { color: red; } }', supported: true },
  { group: 'control flow', name: '@for', src: '@for $i from 1 through 3 { .a-#{$i} { width: $i; } }', supported: true },
  { group: 'control flow', name: '@while', src: '@while $i > 0 { .a { width: 1px; } }', supported: false },

  // ── mixins and functions ───────────────────────────────────────────────────
  { group: 'mixins', name: '@mixin without args', src: '@mixin m { color: red; }', supported: true },
  { group: 'mixins', name: '@mixin with args', src: '@mixin m($a, $b) { color: $a; }', supported: true },
  { group: 'mixins', name: '@mixin with default arg', src: '@mixin m($a: 1px) { color: $a; }', supported: true },
  { group: 'mixins', name: '@mixin default arg from a function call', src: '@mixin m($a: map-keys($x)) { color: $a; }', supported: true },
  { group: 'mixins', name: '@mixin varargs', src: '@mixin m($a...) { color: $a; }', supported: true },
  { group: 'mixins', name: '@mixin multiline params', src: '@mixin m(\n  $a,\n  $b: 2\n) { color: $a; }', supported: true },
  { group: 'mixins', name: '@mixin body containing a ruleset', src: '@mixin m { .a { color: red; } }', supported: true },
  { group: 'mixins', name: '@include', src: '.a { @include m(1px); }', supported: true },
  {
    group: 'mixins',
    name: '@include with a trailing content block',
    src: '.a { @include m { color: red; } }',
    supported: false,
    note: 'argument-only @include parses'
  },
  { group: 'mixins', name: '@content', src: '@mixin m { @content; }', supported: false },
  { group: 'mixins', name: '@content with args', src: '@mixin m { @content($a); }', supported: false },
  { group: 'mixins', name: '@function / @return', src: '@function f($a) { @return $a * 2; }', supported: true },
  { group: 'mixins', name: '@extend', src: '.a { @extend .b; }', supported: true },
  { group: 'mixins', name: 'placeholder selector', src: '%p { color: red; } .a { @extend %p; }', supported: true },

  // ── selectors ──────────────────────────────────────────────────────────────
  { group: 'selectors', name: 'interpolation glued to a class', src: '.#{$x} { color: red; }', supported: true },
  { group: 'selectors', name: 'interpolation glued to a type selector', src: 'a#{$x} { color: red; }', supported: true },
  { group: 'selectors', name: 'interpolation glued after &', src: '.a { &-#{$x} { color: red; } }', supported: true },
  { group: 'selectors', name: 'attribute selector', src: '[data-bs-theme="light"] { color: red; }', supported: true },
  { group: 'selectors', name: 'bare pseudo-class, nested', src: '.a { :last-child { margin: 0; } }', supported: true },
  { group: 'selectors', name: 'explicit & with combinator', src: '.a { & > :last-child { margin: 0; } }', supported: true },
  {
    group: 'selectors',
    name: 'leading combinator (implicit &)',
    src: '.a { > .b { margin: 0; } }',
    supported: false,
    note: 'the explicit `& > .b` form parses; the implicit-& shorthand does not'
  },
  {
    group: 'selectors',
    name: 'interpolation as a standalone compound',
    src: '#{$x} .b { color: red; }',
    supported: false,
    note: 'glued forms (`.#{$x}`, `a#{$x}`) parse; a compound that is ONLY interpolation does not'
  },
  {
    group: 'selectors',
    name: 'interpolated pseudo-element',
    src: '.a { &::#{$x} { color: red; } }',
    supported: false,
    note: 'also fails for `:#{$x}` and without the leading &'
  },

  // ── custom properties ──────────────────────────────────────────────────────
  {
    group: 'custom properties',
    name: 'plain custom property declaration',
    src: '.a { --x: red; }',
    supported: false,
    note: 'INVERSION: the interpolated-name form `--#{$p}x: red` DOES parse. Plain CSS custom properties are supposed to be permissive at the CSS base — this looks like a real bug, not an SCSS feature gap.'
  },
  { group: 'custom properties', name: 'interpolated custom property name', src: '.a { --#{$p}x: red; }', supported: true },
  { group: 'custom properties', name: 'var() reference', src: '.a { w: var(--x); }', supported: true },
  { group: 'custom properties', name: 'var() with fallback', src: '.a { w: var(--x, red); }', supported: true },
  { group: 'custom properties', name: 'var() inside a function call', src: '.a { w: rgba(var(--x), .5); }', supported: true },
  {
    group: 'custom properties',
    name: 'interpolation inside a var() name',
    src: '.a { w: var(--#{$p}x); }',
    supported: false,
    note: 'plain `var(--x)` parses'
  },

  // ── module system / diagnostics / misc ─────────────────────────────────────
  { group: 'module system', name: '@import', src: '@import "x";', supported: true },
  { group: 'module system', name: '@use', src: '@use "sass:math";', supported: true },
  { group: 'module system', name: '@forward', src: '@forward "x";', supported: true },
  {
    group: 'module system',
    name: 'namespaced module function call',
    src: '.a { w: math.div(1, 2); }',
    supported: false,
    note: '@use itself parses, but the `ns.fn()` call form does not. Bootstrap 5.3 uses the legacy global functions, so this blocks no Bootstrap file.'
  },
  {
    group: 'module system',
    name: 'namespaced module variable',
    src: '.a { w: math.$pi; }',
    supported: false
  },
  { group: 'diagnostics', name: '@warn', src: '@mixin m { @warn "x"; }', supported: false },
  { group: 'diagnostics', name: '@error', src: '@mixin m { @error "x"; }', supported: false },
  { group: 'diagnostics', name: '@debug', src: '@debug "x";', supported: false },
  { group: 'misc', name: '@at-root', src: '.a { @at-root .b { color: red; } }', supported: false },
  { group: 'misc', name: 'if() function in a value', src: '.a { w: if($x, 1, 2); }', supported: true },
  { group: 'misc', name: 'interpolation in a media query', src: '@media (min-width: #{$x}) { .a { color: red; } }', supported: true },
  { group: 'misc', name: 'interpolation inside a string', src: '$a: "#{$x}-y";', supported: true }
];

const parses = (src: string): boolean => {
  try {
    parse(src);
    return true;
  } catch {
    return false;
  }
};

describe('SCSS construct support matrix', () => {
  describe('supported — must keep parsing', () => {
    CONSTRUCTS.filter(c => c.supported).forEach((c) => {
      it(`${c.group}: ${c.name}`, () => {
        expect(parses(c.src), `${c.name} regressed — it used to parse`).toBe(true);
      });
    });
  });

  describe('known gaps — recorded, not gated', () => {
    CONSTRUCTS.filter(c => !c.supported).forEach((c) => {
      it(`${c.group}: ${c.name}${c.note ? ` (${c.note})` : ''}`, () => {
        // Reporting-only. If this starts parsing, the inventory is stale — flip
        // `supported` to true so the construct becomes a real gate.
        expect(
          parses(c.src),
          `${c.name} now PARSES — flip \`supported: true\` in this matrix`
        ).toBe(false);
      });
    });
  });
});

export { CONSTRUCTS, type Construct };
