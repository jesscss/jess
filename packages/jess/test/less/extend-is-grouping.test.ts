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
  it('splits a mixed-specificity hoisted sibling group and keeps an equal one', async () => {
    await expect(render('.t { th, .x { x: 1 } } .foo:extend(.t th) {}', false))
      .resolves.toBe('.t th,\n.t .x,\n.foo {\n  x: 1;\n}\n');
    await expect(render('.t { th, td { x: 1 } } .foo:extend(.t th) {}', false))
      .resolves.toBe('.t :is(th, td),\n.foo {\n  x: 1;\n}\n');
  });
});
