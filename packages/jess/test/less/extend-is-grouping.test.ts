/**
 * Extend's own `:is()` groups — the `all` graft (ledger X3) and sibling
 * compaction (EXTEND-SEMANTICS §7c) — follow the shared `:is()` grouping guard
 * in EVERY output mode (owner 2026-10-05): members of different specificity
 * split into equal-specificity groups, and a member that cannot sit inside
 * `:is()` is written as its own branch (the Less 4.x expanded form). Unlike the
 * nesting fold, extend grouping does not depend on `collapseNesting`.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type Mode = false | 'native' | 'compact';
const MODES: readonly Mode[] = [false, 'native', 'compact'];

async function render(src: string, collapseNesting: Mode): Promise<string> {
  const c = new Compiler({ output: { collapseNesting } });
  return String(await c.renderString(src, { extension: '.less', suppressWarnings: true }));
}

/** The header of the block that holds `marker`, branches joined by `, `. */
function headerOf(css: string, marker: string): string {
  const at = css.indexOf(marker);
  const open = css.lastIndexOf('{', at);
  const start = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', open - 1), css.lastIndexOf(';', open)) + 1;
  return css.slice(start, open).trim().replace(/,\s+/g, ', ');
}

/** The header holding `marker` in every output mode (they must agree). */
async function extendHeader(src: string, marker = 'm: 1'): Promise<string> {
  const headers = await Promise.all(MODES.map(async mode => headerOf(await render(src, mode), marker)));
  expect(new Set(headers).size, headers.join(' | ')).toBe(1);
  return headers[0]!;
}

describe('extend :is() grouping keeps native specificity in every output mode', () => {
  it('keeps an equal-specificity `all` graft as one :is()', async () => {
    await expect(extendHeader('.error.intrusion { m: 1 } .badError:extend(.error all) {}'))
      .resolves.toBe(':is(.error, .badError).intrusion');
  });

  it('splits a mixed graft into equal-specificity groups (extend-nest)', async () => {
    /*
     * `.sidebar`, `.sidebar2` score (0,1,0); `.type1 .sidebar3` and
     * `.type2.sidebar4` score (0,2,0). The graft leads the selector, so its complex
     * member keeps its matching inside `:is()`.
     */
    const src = `
      .sidebar { width: 300px; .box { m: 1 } }
      .sidebar2 { &:extend(.sidebar all); }
      .type1 { .sidebar3 { &:extend(.sidebar all); } }
      .type2 { &.sidebar4 { &:extend(.sidebar all); } }
    `;
    await expect(extendHeader(src))
      .resolves.toBe(':is(.sidebar, .sidebar2) .box, :is(.type1 .sidebar3, .type2.sidebar4) .box');
  });

  it('gathers non-adjacent equal-specificity members, in order of first appearance', async () => {
    await expect(extendHeader('.a.x { m: 1 } #b:extend(.a all) {} .c:extend(.a all) {}'))
      .resolves.toBe(':is(.a, .c).x, #b.x');
  });

  it('writes a complex member that follows a combinator as its own branch', async () => {
    // `.intrusion :is(.type1 .sidebar3)` would let `.type1` sit above `.intrusion`.
    await expect(extendHeader('.intrusion .error { m: 1 } .type1 { .sidebar3:extend(.error all) {} }'))
      .resolves.toBe('.intrusion .error, .intrusion .type1 .sidebar3');
  });

  it('expands a complex member into a partial compound the way 4.x does', async () => {
    /*
     * The simples before the match join the member's first compound and those after it
     * its last compound. `.a > .p .m.q` (the rest merged into the last compound) would
     * match a `.m.q` whose `.p` is the child of `.a`, which neither form does.
     */
    await expect(extendHeader('.a > .m.c { m: 1 } .p .q:extend(.c all) {}'))
      .resolves.toBe('.a > .m.c, .a > .m.p .q');
    await expect(extendHeader('.a > .m.c.n { m: 1 } .p > .r .q:extend(.c all) {}'))
      .resolves.toBe('.a > .m.c.n, .a > .m.p > .r .q.n');

    // At the head too: `.m:is(.p .q)` is `.p .m.q`, not 4.x's `.m.p .q`.
    await expect(extendHeader('.m.c .d { m: 1 } .p .q:extend(.c all) {} .y:extend(.c all) {}'))
      .resolves.toBe('.m:is(.c, .y) .d, .m.p .q .d');

    // Leading the head compound, a complex member is the same selector inside `:is()`.
    await expect(extendHeader('.c.k .d { m: 1 } .p .q:extend(.c all) {} .r .s:extend(.c all) {}'))
      .resolves.toBe('.c.k .d, :is(.p .q, .r .s).k .d');
  });

  it('checks a chained group again where its member is spliced', async () => {
    // `.a > :is(.p .q, .r .s).k` would match a `.p` above `.a`.
    await expect(extendHeader('.a > .c { m: 1 } .j.k:extend(.c all) {} .p .q:extend(.j all) {} .r .s:extend(.j all) {}'))
      .resolves.toBe('.a > .c, .a > .j.k, .a > .p .q.k, .a > .r .s.k');
  });

  it('never returns a split alternative to an authored :is() list', async () => {
    /*
     * `:is(#b.k, .z) .d` would raise every `.z .d` to (1,1,0). The authored list keeps
     * the alternative holding the matched selector; the other one stands alone.
     */
    await expect(extendHeader(':is(.c.k, .z) .d { m: 1 } #b:extend(.c all) {}'))
      .resolves.toBe(':is(.c.k, .z) .d, #b.k .d');
    await expect(extendHeader(':is(.c.k, .z) .d { m: 1 } .y:extend(.c all) {}'))
      .resolves.toBe(':is(:is(.c, .y).k, .z) .d');

    // A complex alternative is written in place too, never as a one-arm `:is()`.
    await expect(extendHeader(':is(.c.k, .z) .d { m: 1 } .p .q:extend(.c all) {}'))
      .resolves.toBe(':is(.c.k, .z) .d, .p .q.k .d');
  });

  it('appends an extender that matches a whole authored :is() arm only under the guard', async () => {
    // `#b` would raise `.c .d` and `.z .d` to (1,0,1): the authored list keeps (0,1,1).
    await expect(extendHeader(':is(.c, .z) .d { m: 1 } #b:extend(.c all) {}'))
      .resolves.toBe(':is(.c, .z) .d, #b .d');
    await expect(extendHeader(':is(.c, .z) .d { m: 1 } .y:extend(.c all) {}'))
      .resolves.toBe(':is(.c, .z, .y) .d');

    // `.a :is(.c, .z, .p .q)` would let `.p` sit above `.a`.
    await expect(extendHeader('.a :is(.c, .z) { m: 1 } .p .q:extend(.c all) {}'))
      .resolves.toBe('.a :is(.c, .z), .a .p .q');
  });

  it('appends to the nesting :is(parents) under the guard too', async () => {
    for (const mode of ['native', 'compact'] as const) {
      expect(headerOf(await render('.b, .c { .p { m: 1 } } #x:extend(.b all) {}', mode), 'm: 1'))
        .toBe(':is(.b, .c) .p, #x .p');
      expect(headerOf(await render('.b, .c { .p { m: 1 } } .x:extend(.b all) {}', mode), 'm: 1'))
        .toBe(':is(.b, .c, .x) .p');
    }
  });

  it('compacts a changed top-level rule\'s siblings in nested output too, each member once', async () => {
    await expect(extendHeader('.button:hover { m: 1 } .submit:hover:extend(.button:hover) {}'))
      .resolves.toBe(':is(.button, .submit):hover');
    await expect(extendHeader('.c.x { m: 1 } #b:extend(.c all) {} .e.x:extend(.c.x) {}'))
      .resolves.toBe(':is(.c, .e).x, #b.x');
    await expect(extendHeader('.c.x { m: 1 } #b:extend(.c all) {} #b.x:extend(.c.x) {}'))
      .resolves.toBe('.c.x, #b.x');
  });

  it('merges a repeated element type instead of writing 4.x\'s invalid `divdiv.b`', async () => {
    await expect(extendHeader('div.a { m: 1 } div.b:extend(.a all) {}')).resolves.toBe('div.a, div.b');
  });

  it('keeps an equal-specificity sibling compaction and splits a mixed one', async () => {
    const sibling = (extender: string): string =>
      `.button { color: black; &:hover { m: 1 } } ${extender} { &:extend(.button); &:hover:extend(.button:hover) {} }`;
    await expect(extendHeader(sibling('.submit'))).resolves.toBe(':is(.button, .submit):hover');
    await expect(extendHeader(sibling('#submit'))).resolves.toBe('.button:hover, #submit:hover');
  });

  it('is guarded under collapseNesting \'compact\' too (only the nesting fold is unguarded)', async () => {
    const css = await render('.error.intrusion { m: 1 } #bad:extend(.error all) {} .worse:extend(.error all) {}', 'compact');
    expect(headerOf(css, 'm: 1')).toBe(':is(.error, .worse).intrusion, #bad.intrusion');
  });

  it('folds an extended header\'s nesting branches by the nesting mode and its extenders by the guard', async () => {
    // Orchestrator judgment 2026-10-05: `'compact'` folds the child list unguarded.
    const mixed = '.t { th, .x { m: 1 } } .foo:extend(.t th) {}';
    expect(headerOf(await render(mixed, 'compact'), 'm: 1')).toBe('.t :is(th, .x), .foo');
    expect(headerOf(await render(mixed, 'native'), 'm: 1')).toBe('.t th, .t .x, .foo');
    for (const mode of MODES) {
      expect(headerOf(await render('.t { th, td { m: 1 } } .foo:extend(.t th) {}', mode), 'm: 1'))
        .toBe('.t :is(th, td), .foo');
    }

    // What the extend adds keeps to the guard under `'compact'` too.
    expect(headerOf(await render('.t { th, .x { m: 1 } } #y:extend(.x all) {}', 'compact'), 'm: 1'))
      .toBe('.t :is(th, .x), .t #y');
    expect(headerOf(await render('.t { th, .x { m: 1 } } #y:extend(.x all) {}', 'native'), 'm: 1'))
      .toBe('.t th, .t .x, .t #y');
  });

  it('keeps a pseudo-element out of a sibling group', async () => {
    const css = await render('.p { .arrow::before, .arrow::after { m: 1 } } .q:extend(.p all) {}', false);
    expect(headerOf(css, 'm: 1')).toBe(':is(.p, .q) .arrow::before, :is(.p, .q) .arrow::after');
  });

  it('keeps a vendor-prefixed pseudo-class out of a group', async () => {
    const nested = await render('.p { a:hover, a:-moz-focusring { m: 1 } } .q:extend(.p all) {}', false);
    expect(headerOf(nested, 'm: 1')).toBe(':is(.p, .q) a:hover, :is(.p, .q) a:-moz-focusring');
    await expect(extendHeader('.a.y { m: 1 } :-moz-focusring:extend(.a all) {} .c:extend(.a all) {}'))
      .resolves.toBe(':is(.a, .c).y, :-moz-focusring.y');
  });
});

describe('nested output of an extended nested rule', () => {
  /*
   * A flattened nested rule carries its full composed header, so it lands at the
   * top level. It used to rise one block only, leaving `.a { :is(.a .b, .a .c) e }`,
   * which needs two `.a` ancestors.
   */
  it('emits a deeper flattened rule at the top level', async () => {
    await expect(render('.a { .b, .c { e { y: 2; } } } .d:extend(.a .b e) {}', false))
      .resolves.toBe(':is(.a .b, .a .c) e,\n.d {\n  y: 2;\n}\n');
  });

  it('takes an at-rule it rises out of along with it', async () => {
    // Left inside `.a`, the full header would need two `.a` ancestors.
    const expected = '@media screen {\n  :is(.a .b, .a .c) e,\n  .d {\n    y: 2;\n  }\n}\n';
    await expect(render('.a { @media screen { .b, .c { e { y: 2; } } } } .d:extend(.a .b e) {}', false))
      .resolves.toBe(expected);
    await expect(render('.a { .b, .c { @media screen { e { y: 2; } } } } .d:extend(.a .b e) {}', false))
      .resolves.toBe(expected);
    await expect(render('.a { @media screen { .b { y: 1; } } } .d:extend(.a .b all) {}', false))
      .resolves.toBe('@media screen {\n  .a .b,\n  .d {\n    y: 1;\n  }\n}\n');
  });

  it('splits a mixed-specificity hoisted sibling group and keeps an equal one', async () => {
    await expect(render('.t { th, .x { x: 1 } } .foo:extend(.t th) {}', false))
      .resolves.toBe('.t th,\n.t .x,\n.foo {\n  x: 1;\n}\n');
    await expect(render('.t { th, td { x: 1 } } .foo:extend(.t th) {}', false))
      .resolves.toBe('.t :is(th, td),\n.foo {\n  x: 1;\n}\n');
  });
});
