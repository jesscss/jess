/**
 * extend-cross-import.test.ts — OUTPUT-level coverage for extend semantics that cross an
 * `@import` boundary, at the rendered-CSS level:
 *
 *   1. CROSS-IMPORT TRANSITIVE CLOSURE. `.a:extend(.b)` (main) and `.b:extend(.c)` (imported)
 *      split across an `@import`. The closure `.c ← .b ← .a` must resolve THROUGH the import so
 *      the imported `.c` block gains BOTH `.b` and `.a`.
 *
 *   2. REFERENCE-IMPORT VISIBILITY (negative). `@import (reference)` hides the imported sheet's
 *      own rules from output, but an extend that MATCHES a referenced target pulls in only the
 *      matched rule under the EXTENDER's selector — the referenced `.target` header itself never
 *      surfaces on its own (ledger X13).
 *
 *   3. GRAPH-WIDE TARGETS. An imported sheet with no `:extend()` of its own is still a target for
 *      an extend anywhere else in the import graph (EXTEND-SEMANTICS §6).
 *
 *   4. `@media` SCOPE ACROSS IMPORTS. An imported sheet's at-rule blocks, and an import nested in
 *      an at-rule block, scope extends exactly as the inlined sheet would (EXTEND-SEMANTICS §8).
 *
 * The expectations follow from the extend rules: matching runs on the compiled output of the one
 * render walk (ledger X5, X12), so an import contributes its rules wherever it lands. less 4.x
 * renders the same bytes except where v5 grafts `:is()` instead of duplicating (ledger X3).
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const fixtures = path.join(__dirname, 'fixtures', 'extend-cross-import');

const mkCompiler = () =>
  new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin()] }
  });

async function renderFile(rel: string): Promise<string> {
  const result = await mkCompiler().renderToResult(path.join(fixtures, rel));
  return result.css.trim();
}

describe('extend across @import', () => {
  it('transitive closure resolves through the import boundary (.c ← .b ← .a)', async () => {
    const css = await renderFile('main.less');
    expect(css).toBe(
      [
        '.c,',
        '.b,',
        '.a {',
        '  color: red;',
        '}',
        '.b,',
        '.a {',
        '  background: blue;',
        '}',
        '.a {',
        '  font-weight: bold;',
        '}'
      ].join('\n')
    );
  });

  /*
   * The referenced `.target` never surfaces on its own; only the extender `.ext` renders,
   * once with the pulled-in referenced declaration and once with its own body.
   */
  it('reference-import: referenced target stays hidden; only the extender surfaces', async () => {
    const css = await renderFile('ref-main.less');

    // Negative-visibility guard: the referenced `.target` header must NOT appear in output.
    expect(css).not.toContain('.target');
    expect(css).toBe(
      ['.ext {', '  color: red;', '}', '.ext {', '  background: blue;', '}'].join('\n')
    );
  });

  /*
   * less 4.x renders the same:
   *   .grid-column, .col-1, .col-2, .col-3 { color: red; }
   * An IMPORTED mixin whose body carries `&:extend()` (Bootstrap's `#make-grid-columns()`
   * grid-column shape) must arm walk-time dynamic extend recording — the imported
   * extend-admission gate has to descend into MixinDefinition bodies, not just loops.
   */
  it('imported mixin-body &:extend() accumulates the extenders onto the target', async () => {
    const css = await renderFile('main-mixin-extend.less');
    expect(css).toBe(
      ['.grid-column,', '.col-1,', '.col-2,', '.col-3 {', '  color: red;', '}'].join('\n')
    );
  });

  /*
   * The imported sheet has NO `:extend()` of its own. Its rules are still extend
   * targets for every other document in the import graph (jess#349).
   */
  describe('imported sheet without its own extend is still a target', () => {
    const smX = ['.sm,', '.x {', '  b: 2;', '}'].join('\n');

    it('plain import', async () => {
      expect(await renderFile('plain-main.less')).toBe(smX);
    });

    it('(reference) import, exact extend', async () => {
      expect(await renderFile('ref-exact-main.less')).toBe(['.x {', '  b: 2;', '}'].join('\n'));
    });

    it('(multiple) import', async () => {
      expect(await renderFile('multiple-main.less')).toBe(`${smX}\n${smX}`);
    });

    it('nested import chain', async () => {
      expect(await renderFile('chain-main.less')).toBe(smX);
    });

    it('extender in a LATER import targets an earlier import', async () => {
      expect(await renderFile('later-main.less')).toBe(smX);
    });

    // less 4.x duplicates per extender (`.sm .y, .x .y`); v5 grafts `:is()` (ledger X3).
    it('extend all, including inside an imported @media', async () => {
      expect(await renderFile('all-main.less')).toBe(
        [
          smX,
          ':is(.sm, .x) .y {',
          '  c: 3;',
          '}',
          '@media (min-width: 1px) {',
          '  :is(.sm, .x):hover {',
          '    d: 4;',
          '  }',
          '}'
        ].join('\n')
      );
    });
  });

  /*
   * An extend reached only through a mixin or loop body of the ROOT still makes the import
   * graph extend-bearing, so a compound target in a plain import keeps its extender.
   */
  describe('extender in a root mixin or loop body', () => {
    const pqX = (...extenders: string[]) =>
      ['.p.q,', '.p.r,', ...extenders.map((x, i) => (i === extenders.length - 1 ? `${x} {` : `${x},`)), '  a: 1;', '}'].join('\n');

    it('mixin call', async () => {
      expect(await renderFile('root-mixin-main.less')).toBe(pqX('.x'));
    });

    it('guarded recursive mixin loop', async () => {
      expect(await renderFile('root-loop-main.less')).toBe(pqX('.x2', '.x1'));
    });

    it('mixin call before the import that holds the target', async () => {
      expect(await renderFile('root-mixin-before-main.less')).toBe(pqX('.x'));
    });
  });

  describe('@media scope across imports', () => {
    const sm = ['.sm {', '  b: 2;', '}'].join('\n');
    const printY = ['@media print {', '  .y {', '    d: 1;', '  }', '}'].join('\n');
    const mediaSm = (query: string) => [`@media ${query} {`, '  .sm {', '    b: 2;', '  }', '}'].join('\n');
    const printSmX = ['@media print {', '  .sm,', '  .x {', '    b: 2;', '  }', '}'].join('\n');

    it('an imported @media extend does not reach a top-level rule of a LATER import', async () => {
      expect(await renderFile('media-before-main.less')).toBe(`${printY}\n${sm}`);
    });

    it('an imported @media extend does not reach a top-level rule of an EARLIER import', async () => {
      expect(await renderFile('media-after-main.less')).toBe(`${sm}\n${printY}`);
    });

    it('an imported @media extend does not reach another sheet\'s @media block', async () => {
      expect(await renderFile('media-other-block-main.less')).toBe(`${mediaSm('print')}\n${printY}`);
    });

    it('an imported @media print extend does not reach @media screen', async () => {
      expect(await renderFile('media-screen-main.less')).toBe(`${mediaSm('screen')}\n${printY}`);
    });

    it('an import inside @media shares that block\'s scope with its extender', async () => {
      expect(await renderFile('media-import-main.less')).toBe(printSmX);
    });

    it('an import inside @media is planned when it is the only import', async () => {
      expect(await renderFile('media-import-only-main.less')).toBe(printSmX);
    });

    it('an import with a media query scopes the imported sheet\'s own extend', async () => {
      expect(await renderFile('media-query-import-main.less')).toBe(printSmX);
    });

    it('an extender imported inside @media does not reach a top-level rule', async () => {
      expect(await renderFile('media-import-extender-main.less')).toBe(sm);
    });
  });

  /*
   * `@compose` emits its module's CSS, and an extend in the composing sheet targets it like any
   * other rule of the render's output (ledger X12). No ledger row rules on extend across
   * `@compose` yet; this pins the current behavior so a ruling shows up as a test change.
   */
  it('@compose module rules are extend targets', async () => {
    expect(await renderFile('compose-main.less')).toBe(['.sm,', '.x {', '  b: 2;', '}'].join('\n'));
  });
});
