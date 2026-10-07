/**
 * `collapseNesting` flatten styles: `false` (nested, default), `'native'` (parent
 * `:is()`; child branches share an `:is()` only where that keeps native
 * specificity, matching and invalid-selector behaviour), and `'compact'` (folds
 * every descendant child branch, group-max specificity).
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function render(src: string, collapseNesting: false | 'native' | 'compact'): Promise<string> {
  const c = new Compiler({ output: { collapseNesting } });
  return String(await c.renderString(src, { extension: '.less', suppressWarnings: true }));
}

/** The flattened header of a single `{ x: 1 }` rule, branches joined by `, `. */
async function header(src: string, collapseNesting: 'native' | 'compact' = 'native'): Promise<string> {
  const out = await render(src, collapseNesting);
  return out.slice(0, out.indexOf(' {')).replace(/,\n/g, ', ');
}

/** Every top-level rule's flattened header in order, branches joined by `, ` and rules by ` | `. */
async function headers(src: string, collapseNesting: 'native' | 'compact' = 'native'): Promise<string> {
  const out = await render(src, collapseNesting);
  return [...out.matchAll(/^([^{}\s][^{}]*?) \{$/gmu)].map(m => m[1]!.replace(/,\n/g, ', ')).join(' | ');
}

describe('collapseNesting native vs compact', () => {
  it(`'native' folds an equal-specificity child list`, async () => {
    await expect(render('.t { th, td { x: 1 } }', 'native')).resolves.toBe('.t :is(th, td) {\n  x: 1;\n}\n');
    await expect(header('.t { input[type="radio"], input[type="checkbox"] { x: 1 } }'))
      .resolves.toBe('.t :is(input[type="radio"], input[type="checkbox"])');
  });

  it(`'native' folds the child list under a parent :is()`, async () => {
    await expect(header('.a, .b { .c, .d { x: 1 } }')).resolves.toBe(':is(.a, .b) :is(.c, .d)');
  });

  it(`'native' distributes a mixed-specificity child list`, async () => {
    await expect(header('.t { th, .x, #y { x: 1 } }')).resolves.toBe('.t th, .t .x, .t #y');
  });

  it(`'native' keeps a branch with a combinator out of the fold (an :is() argument would match differently)`, async () => {
    await expect(header('.t { .a .b, .c .d { x: 1 } }')).resolves.toBe('.t .a .b, .t .c .d');
    await expect(header('.table-borderless { th, td, thead th, tbody + tbody { x: 1 } }'))
      .resolves.toBe('.table-borderless :is(th, td), .table-borderless thead th, .table-borderless tbody + tbody');
  });

  /*
   * Order inside one selector list changes neither the cascade nor specificity
   * (owner 2026-10-05), so equal-specificity branches group however far apart they
   * are; groups come out in order of first appearance.
   */
  it(`'native' groups non-adjacent equal-specificity branches, in order of first appearance`, async () => {
    await expect(header('.t { .a, .b, #c, .d, .e { x: 1 } }'))
      .resolves.toBe('.t :is(.a, .b, .d, .e), .t #c');
    await expect(header('.t { th, .x, td { x: 1 } }')).resolves.toBe('.t :is(th, td), .t .x');
    await expect(header('.t { > .a, .b, > .c, .d { x: 1 } }')).resolves.toBe('.t > .a, .t :is(.b, .d), .t > .c');
  });

  it(`'native' hoists a leading combinator and folds the descendant run`, async () => {
    await expect(header('.x { > .a, .b, .c { x: 1 } }')).resolves.toBe('.x > .a, .x :is(.b, .c)');
    await expect(header('.x { > .a, > .b { x: 1 } }')).resolves.toBe('.x > .a, .x > .b');
  });

  it(`a pseudo-element blocks the 'native' fold`, async () => {
    await expect(header('.t { .a::before, .b::before { x: 1 } }')).resolves.toBe('.t .a::before, .t .b::before');
    await expect(header('.t { .a:before, .b:after { x: 1 } }')).resolves.toBe('.t .a:before, .t .b:after');
  });

  it(`a vendor-prefixed or unknown pseudo-class blocks the 'native' fold`, async () => {
    await expect(header('.t { input:-webkit-autofill, input:invalid { x: 1 } }'))
      .resolves.toBe('.t input:-webkit-autofill, .t input:invalid');
    await expect(header('.t { a:foo, a:hover { x: 1 } }')).resolves.toBe('.t a:foo, .t a:hover');
    await expect(header('.t { a:hover, a:focus-visible { x: 1 } }')).resolves.toBe('.t :is(a:hover, a:focus-visible)');
    await expect(header('.t { a:HOVER, a:focus { x: 1 } }')).resolves.toBe('.t :is(a:HOVER, a:focus)');
    await expect(header('.t { a:hover(x), b:focus { x: 1 } }')).resolves.toBe('.t a:hover(x), .t b:focus');
    await expect(header('.t { a:matches(.x), b.y { x: 1 } }')).resolves.toBe('.t a:matches(.x), .t b.y');
  });

  /*
   * Inside `@scope`, a selector with no `:scope` gets an implicit `:scope `
   * prefix; `.t :is(:scope, .x)` contains one, so `.t .x` would lose its prefix.
   */
  it(`:scope blocks the 'native' fold`, async () => {
    await expect(header('.t { :scope, .x { x: 1 } }')).resolves.toBe('.t :scope, .t .x');
    await expect(header('.t { a:is(:scope), b.x { x: 1 } }')).resolves.toBe('.t a:is(:scope), .t b.x');
  });

  it(`a namespace prefix or the 's' attribute flag blocks the 'native' fold`, async () => {
    // `svg|*` is universal (0,0,0); an undeclared prefix invalidates the selector.
    await expect(header('.t { svg|*, a { x: 1 } }')).resolves.toBe('.t svg|*, .t a');
    await expect(header('.t { ns|a, b { x: 1 } }')).resolves.toBe('.t ns|a, .t b');
    await expect(header('.t { *|a, *|b { x: 1 } }')).resolves.toBe('.t *|a, .t *|b');
    await expect(header('.t { [ns|a], [b] { x: 1 } }')).resolves.toBe('.t [ns|a], .t [b]');

    // Chromium does not implement the `s` flag, so the plain list drops whole.
    await expect(header('.t { [a="b" s], [c] { x: 1 } }')).resolves.toBe('.t [a="b" s], .t [c]');
    await expect(header('.t { [a="b"S], [c] { x: 1 } }')).resolves.toBe('.t [a="b"S], .t [c]');
    await expect(header('.t { [a="b" i], [lang|=en], [d="x|y"], [e=cats] { x: 1 } }'))
      .resolves.toBe('.t :is([a="b" i], [lang|=en], [d="x|y"], [e=cats])');
  });

  it(`the universal selector scores zero`, async () => {
    await expect(header('.t { *, a { x: 1 } }')).resolves.toBe('.t *, .t a');
    await expect(header('.t { *.a, .b { x: 1 } }')).resolves.toBe('.t :is(*.a, .b)');
  });

  it(`an interpolated branch stays distributed`, async () => {
    await expect(header('@s: ~".x"; .t { @{s}, .y { x: 1 } }')).resolves.toBe('.t .x, .t .y');
  });

  it(`:where() scores zero`, async () => {
    await expect(header('.t { p:where(#x), q { x: 1 } }')).resolves.toBe('.t :is(p:where(#x), q)');
    await expect(header('.t { p:where(.x), .y { x: 1 } }')).resolves.toBe('.t p:where(.x), .t .y');
  });

  it(`:is(), :not() and :has() score their most specific argument`, async () => {
    await expect(header('.t { a:not(.x, #y), b#z { x: 1 } }')).resolves.toBe('.t :is(a:not(.x, #y), b#z)');
    await expect(header('.t { a:is(.x, .y), b.z { x: 1 } }')).resolves.toBe('.t :is(a:is(.x, .y), b.z)');
    await expect(header('.t { a:has(> .x), b.y { x: 1 } }')).resolves.toBe('.t :is(a:has(> .x), b.y)');
    await expect(header('.t { a:not(#y), b.z { x: 1 } }')).resolves.toBe('.t a:not(#y), .t b.z');
  });

  it(`an invalid selector-function form blocks the 'native' fold`, async () => {
    // Double-colon spellings are pseudo-element syntax; `:has()` may not nest.
    await expect(header('.t { a::not(.x), b.y { x: 1 } }')).resolves.toBe('.t a::not(.x), .t b.y');
    await expect(header('.t { a::is(.x), b.y { x: 1 } }')).resolves.toBe('.t a::is(.x), .t b.y');
    await expect(header('.t { a::where(.x), b { x: 1 } }')).resolves.toBe('.t a::where(.x), .t b');
    await expect(header('.t { a:has(:has(.x)), b.c { x: 1 } }')).resolves.toBe('.t a:has(:has(.x)), .t b.c');
    await expect(header('.t { a:has(:is(:has(.x))), b.c { x: 1 } }')).resolves.toBe('.t a:has(:is(:has(.x))), .t b.c');
  });

  /*
   * Their arguments reach core as joined text, so neither the `of S`
   * specificity nor the argument's validity can be read from the IR.
   */
  it(`a functional pseudo-class with a text argument blocks the 'native' fold`, async () => {
    await expect(header('.t { li:nth-child(2n of .x), li.y:first-child { x: 1 } }'))
      .resolves.toBe('.t li:nth-child(2n of .x), .t li.y:first-child');
    await expect(header('.t { li:nth-of-type(2n), li:first-child { x: 1 } }'))
      .resolves.toBe('.t li:nth-of-type(2n), .t li:first-child');
    await expect(header('.t { p:lang(en, fr), p:first-child { x: 1 } }'))
      .resolves.toBe('.t p:lang(en, fr), .t p:first-child');
  });

  it(`'compact' folds every descendant branch regardless of specificity`, async () => {
    await expect(header('.a, .b { .c, .d { x: 1 } }', 'compact')).resolves.toBe(':is(.a, .b) :is(.c, .d)');
    await expect(header('.tb { th, td, thead th { x: 1 } }', 'compact')).resolves.toBe('.tb :is(th, td, thead th)');
    await expect(header('.t { .a::before, #b, .c { x: 1 } }', 'compact')).resolves.toBe('.t .a::before, .t :is(#b, .c)');
    await expect(header('.t { > .a, .b, > .c, #d { x: 1 } }', 'compact')).resolves.toBe('.t > .a, .t :is(.b, #d), .t > .c');
  });

  /*
   * A pseudo-element is invalid inside `:is()`, so a fold over one matches
   * nothing; no fold mode puts it there (DESIGN-DECISIONS O14, orchestrator
   * judgment under owner delegation 2026-10-06). An extended header folds by the
   * same key.
   */
  it(`a pseudo-element blocks the 'compact' fold too`, async () => {
    await expect(header('.t { .a::before, .b::before { x: 1 } }', 'compact')).resolves.toBe('.t .a::before, .t .b::before');
    await expect(header('.t { .a:before, .b:AFTER, .c:first-line { x: 1 } }', 'compact'))
      .resolves.toBe('.t .a:before, .t .b:AFTER, .t .c:first-line');
    await expect(header('.t { .a > .b::part(x), .c::slotted(p), .d { x: 1 } }', 'compact'))
      .resolves.toBe('.t .a > .b::part(x), .t .c::slotted(p), .t .d');
    await expect(header('.t { .a::before, .b::before { x: 1 } } .foo:extend(.t .a::before) {}', 'compact'))
      .resolves.toBe('.t .a::before, .t .b::before, .foo');
  });

  /* An interpolated branch may resolve to a pseudo-element, so it stays out of the fold, as 'native' keeps it. */
  it(`an interpolated branch stays out of the 'compact' fold`, async () => {
    await expect(header('@pe: ~"::before"; .t { .a@{pe}, .b@{pe} { x: 1 } }', 'compact')).resolves.toBe('.t .a::before, .t .b::before');
    await expect(header('@pe: before; .t { .a::@{pe}, .b::@{pe} { x: 1 } }', 'compact')).resolves.toBe('.t .a::before, .t .b::before');
    await expect(header('@s: ~".a::before"; .t { @{s}, .b { x: 1 } }', 'compact')).resolves.toBe('.t .a::before, .t .b');
    const scss = await new Compiler({ output: { collapseNesting: 'compact' } })
      .renderString('$pe: "::before"; .t { .a#{$pe}, .b#{$pe} { x: 1 } }', { extension: '.scss' });
    expect(String(scss)).toBe('.t .a::before,\n.t .b::before {\n  x: 1;\n}\n');
  });

  /*
   * A child under a NESTED multi-branch rule keeps every branch of that rule as
   * its ancestor. It used to keep only the first, silently dropping selectors
   * (bootstrap's `.btn-group-toggle > .btn-group > .btn input[type="radio"]`).
   */
  it('keeps every branch of a nested multi-branch rule as the ancestor of its children', async () => {
    await expect(render('.a { .b, .c { e { y: 2; } } }', 'native'))
      .resolves.toBe('.a :is(.b, .c) e {\n  y: 2;\n}\n');
    await expect(render('.a { .b, #c { e { y: 2; } } }', 'native'))
      .resolves.toBe(':is(.a .b, .a #c) e {\n  y: 2;\n}\n');
    await expect(render('.a { .b, .c { e { y: 2; } } }', 'compact'))
      .resolves.toBe('.a :is(.b, .c) e {\n  y: 2;\n}\n');
    await expect(render('.t { > .b, > .g > .b { i, j { y: 2; } } }', 'native'))
      .resolves.toBe(':is(.t > .b, .t > .g > .b) :is(i, j) {\n  y: 2;\n}\n');

    // jess#357: relative children of a relative selector list keep every parent branch.
    await expect(render('.a { > .b, > .c { + .d, + .e { x: 1 } } }', 'native'))
      .resolves.toBe(':is(.a > .b, .a > .c) + .d,\n:is(.a > .b, .a > .c) + .e {\n  x: 1;\n}\n');
  });

  /*
   * A parent ending with a pseudo-element is written on its own where its `&` keeps
   * the pseudo-element last — a bare `&` followed only by user-action pseudo-classes
   * (Selectors 4 §3.6.3) — in every flattening mode, since `:is()` cannot hold one and
   * `:is(.a::before, .b::before):hover` matches nothing; the other parents still share
   * the `:is()`. Such a unit that carries anything after its pseudo-element gets a rule
   * of its own, its declarations written again: Chromium drops `.a::before:hover` and
   * every selector list that holds it, so in one list with `:is(.b, .c):hover` it would
   * take `.b:hover` down with it. Anywhere else nothing may follow the pseudo-element, the
   * branch is invalid whatever is done, and the parent stays in the forgiving `:is()`: a
   * plain branch (`.a::before .e`) would drop every branch of its list (owner principle
   * 2026-10-06, O17: an output transformation never makes output more invalid or match
   * fewer elements; units of their own, orchestrator judgment under owner delegation
   * 2026-10-07).
   */
  it('writes a parent ending with a pseudo-element on its own only where `&` keeps it last', async () => {
    for (const mode of ['native', 'compact'] as const) {
      const cases: Array<[string, string]> = [
        ['.a::before, .b::before { &:hover { x: 1 } }', '.a::before:hover | .b::before:hover'],
        ['.t { .a::before, .b::before { &:hover { x: 1 } } }', '.t .a::before:hover | .t .b::before:hover'],
        ['.a::before, .b, .c { &:hover:focus { x: 1 } }', '.a::before:hover:focus | :is(.b, .c):hover:focus'],
        ['.a::before, .b { .x & { x: 1 } }', '.x .a::before, .x .b'],
        ['.a::before, .b::before { &:hover { &:focus { x: 1 } } }', '.a::before:hover:focus | .b::before:hover:focus'],
        ['.m() { &:hover { x: 1 } } .a::before, .b::before { .m(); }', '.a::before:hover | .b::before:hover'],
        ['.a::before { &:hover, .x & { x: 1 } }', '.a::before:hover | .x .a::before'],
        ['.a::-webkit-scrollbar, .b::before { &:hover { x: 1 } }', '.a::-webkit-scrollbar:hover | .b::before:hover'],
        ['.a::before, .b::after, .c, .d { .e { x: 1 } }', ':is(.a::before, .b::after, .c, .d) .e'],
        ['.c, .a:before, .d { &.k { x: 1 } }', ':is(.c, .a:before, .d).k'],
        ['.a::before, .b { & + & { x: 1 } }', ':is(.a::before, .b) + .a::before, :is(.a::before, .b) + .b'],

        // A list the author wrote is theirs: only what the flattening composes is split.
        ['.a::before:hover, .b:hover { x: 1 }', '.a::before:hover, .b:hover'],
        ['.p { .a::before:hover, .b:hover { x: 1 } }', '.p .a::before:hover, .p .b:hover']
      ];
      for (const [src, expected] of cases) {
        await expect(headers(src, mode), `${mode}: ${src}`).resolves.toBe(expected);
      }

      // Each rule writes the declarations; the order of the blocks is kept around a child.
      await expect(render('.a::before, .b, .c { &:hover { x: 1 } }', mode))
        .resolves.toBe('.a::before:hover {\n  x: 1;\n}\n:is(.b, .c):hover {\n  x: 1;\n}\n');
      await expect(render('.a::before, .b { &:hover { x: 1; .c { y: 2 } z: 3 } }', mode)).resolves.toBe([
        '.a::before:hover {\n  x: 1;\n}', '.b:hover {\n  x: 1;\n}', ':is(.a::before:hover, .b:hover) .c {\n  y: 2;\n}',
        '.a::before:hover {\n  z: 3;\n}', '.b:hover {\n  z: 3;\n}', ''
      ].join('\n'));
      await expect(render('.a::before, .b { @media print { &:hover { x: 1 } } }', mode))
        .resolves.toBe('@media print {\n  .a::before:hover {\n    x: 1;\n  }\n  .b:hover {\n    x: 1;\n  }\n}\n');

      // An at-rule bubbled out of the `&:hover` rule writes its declarations the same way.
      const printSplit = '@media print {\n  .a::before:hover {\n    x: 1;\n  }\n  .b:hover {\n    x: 1;\n  }\n}\n';
      await expect(render('.a::before, .b { &:hover { @media print { x: 1 } } }', mode)).resolves.toBe(printSplit);
      await expect(render('.a::before, .b { &:hover { y: 0; @media print { x: 1 } } }', mode)).resolves.toBe(
        '.a::before:hover {\n  y: 0;\n}\n.b:hover {\n  y: 0;\n}\n' + printSplit
      );
      await expect(render('.a::before, .b { &:hover { @supports (display: grid) { @media print { x: 1 } } } }', mode)).resolves.toBe(
        '@supports (display: grid) {\n  @media print {\n    .a::before:hover {\n      x: 1;\n    }\n    .b:hover {\n      x: 1;\n    }\n  }\n}\n'
      );
      await expect(render('.a::before, .b::after { &:hover { @media print { x: 1 } } }', mode)).resolves.toBe(
        '@media print {\n  .a::before:hover {\n    x: 1;\n  }\n  .b::after:hover {\n    x: 1;\n  }\n}\n'
      );
      const compressed = new Compiler({ output: { collapseNesting: mode, compress: true } });
      await expect(compressed.renderString('.a::before, .b { &:hover { x: 1 } }', { extension: '.less', suppressWarnings: true }).then(String))
        .resolves.toBe('.a::before:hover{x:1}.b:hover{x:1}');

      // An at-rule bubbled out of the rule writes a branch per parent.
      await expect(render('.a::before, .b { @media print { .c { x: 1 } } }', mode))
        .resolves.toBe('@media print {\n  :is(.a::before) .c,\n  .b .c {\n    x: 1;\n  }\n}\n');

      // A rule an extend writes takes the same units, its own `:is()` grouping kept outside the pseudo-element.
      const extended: Array<[string, string]> = [
        ['.a::before, .b::before { &:hover { x: 1 } } .z:extend(.a::before:hover) {}', ':is(.a, .b)::before:hover | .z'],
        ['.a::before, .b::before { &:hover { x: 1 } } .z:extend(.a all) {}', ':is(.a, .z, .b)::before:hover'],
        ['.a::before, .b::before { &:hover { x: 1 } } .z:extend(.a::before all) {}', '.a::before:hover | .z:hover | .b::before:hover'],
        ['.a::before, .c, .d { &:hover { x: 1 } } .z:extend(.c all) {}', '.a::before:hover | :is(.c, .d, .z):hover'],
        ['.a::before { &:hover { x: 1 } } .z:extend(.a all) {}', ':is(.a, .z)::before:hover'],
        ['.a::before, .b { &:hover { x: 1 } } .z:extend(.b:hover) {}', '.a::before:hover | .b:hover, .z'],
        ['.m() { &:hover { x: 1 } } .a::before, .b { .m(); } .z:extend(.b:hover) {}', '.a::before:hover | .b:hover, .z'],

        /*
         * An extended header is the extend's list: whatever produced the target, a branch in it
         * carrying a pseudo-element followed by more is a rule of its own, the extender included.
         */
        ['.b:hover { x: 1 } .q::after:focus:extend(.b:hover) {}', '.b:hover | .q::after:focus'],
        ['.a::before, .b { &:hover { x: 1 } } .q::after:focus:extend(.b:hover) {}', '.a::before:hover | .b:hover | .q::after:focus'],
        ['.b { &:hover { x: 1 } } .a::before:extend(.b all) {}', '.b:hover | .a::before:hover'],
        ['.a::before:hover, .b:hover { x: 1 } .q:extend(.b:hover) {}', '.a::before:hover | .b:hover, .q'],
        ['.b { &:hover { x: 1 } } .m() { .q::after:extend(.b all) {} } .m();', '.b:hover | .q::after:hover'],
        ['@s: ~".p::before, .q"; @{s} { x: 1; } .u:extend(.zz) {}', '.p::before, .q']
      ];
      for (const [src, expected] of extended) {
        await expect(headers(src, mode), `${mode}: ${src}`).resolves.toBe(expected);
      }
    }
    await expect(header('.a, #b { .c { x: 1 } }')).resolves.toBe(':is(.a, #b) .c');
    await expect(headers('@pe: before; .a:@{pe}, .b:@{pe} { &:hover { x: 1 } }')).resolves.toBe('.a:before:hover | .b:before:hover');
    await expect(header('@state: valid; .a:@{state}, .b:@{state} { &:hover { x: 1 } }')).resolves.toBe(':is(.a:valid, .b:valid):hover');

    // Recorded per composed list, never by selector text: a same-text parent list elsewhere is unaffected.
    const unrelated = await render('@s: ~".a"; @{s} { x: 1; } .a, #b { .c { y: 2; } &:hover { z: 3; } }', 'native');
    expect(unrelated).toContain(':is(.a, #b) .c {');
    expect(unrelated).toContain(':is(.a, #b):hover {');
  });

  /*
   * An extend's expanded placement that leaves a pseudo-element followed by more
   * (`.a .p::before:hover`) gets a rule of its own in every output mode, nested
   * included, so Chromium does not drop the list holding it (SETTLED — orchestrator
   * judgment under owner delegation 2026-10-07, principle O17; ledger O10).
   */
  it('writes an extended branch with a pseudo-element followed by more as its own rule, nested output included', async () => {
    const oneLine = async (src: string, mode: false | 'native' | 'compact'): Promise<string> => (await render(src, mode)).replace(/\s+/g, ' ').trim();
    for (const mode of [false, 'native', 'compact'] as const) {
      await expect(oneLine('.a .c:hover { x: 1 } .p::before:extend(.c all) {}', mode), String(mode))
        .resolves.toBe('.a .c:hover { x: 1; } .a .p::before:hover { x: 1; }');
      await expect(oneLine('.a .c:hover { x: 1 } .q:extend(.c all) {} .p::before:extend(.c all) {}', mode), String(mode))
        .resolves.toBe('.a :is(.c, .q):hover { x: 1; } .a .p::before:hover { x: 1; }');
    }
    await expect(oneLine('.x { .c:hover { x: 1; .d { y: 1 } } } .p::before:extend(.c all) {}', false))
      .resolves.toBe('.x { .c:hover { x: 1; .d { y: 1; } } .p::before:hover { x: 1; .d { y: 1; } } }');
    await expect(oneLine('.x { .a::before:hover, .c:hover { x: 1 } } .q:extend(.zz) {}', false))
      .resolves.toBe('.x { .a::before:hover, .c:hover { x: 1; } }');
  });

  it(`'false' preserves authored nesting (no :is())`, async () => {
    const out = await render('.a, .b { .c, .d { x: 1 } }', false);
    expect(out).not.toContain(':is(');
    expect(out).toMatch(/\.a,\s*\.b/);
  });
});
