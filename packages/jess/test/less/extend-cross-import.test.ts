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

const mkCompiler = (collapseNesting: boolean) =>
  new Compiler({
    output: { collapseNesting },
    compile: { plugins: [lessPlugin()] }
  });

async function renderFile(rel: string, collapseNesting = true): Promise<string> {
  const result = await mkCompiler(collapseNesting).renderToResult(path.join(fixtures, rel));
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

    // Ledger X7 (amended by the owner 2026-10-05): an interpolated rule is a target once resolved.
    it('interpolated rules of an imported sheet', async () => {
      expect(await renderFile('interp-main.less')).toBe(
        ['.foo,', '.x {', '  a: 1;', '}', '.k:is(.c-foo, .y) {', '  b: 2;', '}'].join('\n')
      );
      expect(await renderFile('interp-main.less', false)).toBe(
        ['.foo,', '.x {', '  a: 1;', '}', '.k:is(.c-foo, .y) {', '  b: 2;', '}'].join('\n')
      );
    });

    // Rules nested in an interpolated rule, and an interpolated rule nested in a static one.
    it('rules nested in and around interpolated rules of an imported sheet', async () => {
      const expected = [
        '.foo :is(.c, .x),', '.z {', '  a: 1;', '}', '.p .foo.k,', '.y.k {', '  b: 2;', '}'
      ].join('\n');
      expect(await renderFile('interp-nested-main.less')).toBe(expected);
      expect(await renderFile('interp-nested-main.less', false)).toBe(expected);
      expect(await renderFile('interp-child-main.less', false)).toBe(
        ['.foo {', '  .c,', '  .x {', '    a: 1;', '  }', '}'].join('\n')
      );
    });

    it('nested import chain', async () => {
      expect(await renderFile('chain-main.less')).toBe(smX);
    });

    it('extender in a LATER import targets an earlier import', async () => {
      expect(await renderFile('later-main.less')).toBe(smX);
    });

    /*
     * Import-once drops a `(reference)` re-import of a sheet already imported plainly, as
     * Less 4.x does (orchestrator judgment 2026-10-05, jess#359): the sheet is placed once.
     */
    it('a (reference) re-import of a sheet imported plainly is dropped', async () => {
      expect(await renderFile('plain-and-ref-main.less')).toBe(smX);
    });

    /*
     * Ledger X18 (orchestrator judgment under owner delegation 2026-10-06): a `(reference)`
     * import of a sheet any `@import` already loaded is a no-op, as J14 has after a plain one;
     * a plain import after a `(reference)` one renders the sheet, which the author asked to see.
     */
    it('a (reference) import of a sheet already loaded is a no-op, after any import', async () => {
      expect(await renderFile('multiple-and-ref-main.less')).toBe(smX);
      expect(await renderFile('ref-and-ref-main.less')).toBe(['.x {', '  b: 2;', '}'].join('\n'));
    });

    /*
     * Only the plain import's copy is ruled: it renders. Whether the earlier hidden copy
     * still adds what the extend reveals, and how a plain import after a `(multiple)` one
     * places the sheet, are orderings X18 leaves open, so they are not pinned here.
     */
    it('a plain import after a (reference) one renders the sheet', async () => {
      expect(await renderFile('ref-and-plain-main.less')).toContain(smX);
    });

    /*
     * Each copy of a `(multiple)` sheet places the `(reference)` import inside it on its own,
     * so the extend in `@media print` reveals only the print copy.
     */
    it('a (reference) import inside a sheet imported (multiple) twice is placed per copy', async () => {
      expect(await renderFile('multiple-ref-media-main.less')).toBe(
        ['@media print {', '  .x {', '    b: 2;', '  }', '}', '@media screen {', '  .y {', '    c: 1;', '  }', '}'].join('\n')
      );
    });

    // A referenced rule an extend reaches surfaces under the extender only (ledger X13, jess#355).
    it('(reference) import, extender in a mixin body', async () => {
      expect(await renderFile('ref-mixin-main.less')).toBe(['.x {', '  b: 2;', '}'].join('\n'));
    });

    // Referenced rules no extend reaches stay hidden (ledger X13).
    it('(reference) import, extender in a mixin body that is never called', async () => {
      expect(await renderFile('ref-uncalled-main.less')).toBe(['.own {', '  a: 1;', '}'].join('\n'));
    });

    /*
     * A hidden rule inside a hidden `@media` that only a walk-recorded extend reveals
     * surfaces in its `@media`; the `@media` goes when nothing in it is revealed.
     */
    it('(reference) import, @media rule revealed by an extender in a mixin body', async () => {
      const revealed = ['@media print {', '  .x {', '    b: 2;', '  }', '}'].join('\n');
      expect(await renderFile('ref-media-reveal-main.less')).toBe(revealed);
      expect(await renderFile('ref-media-reveal-main.less', false)).toBe(revealed);
      expect(await renderFile('ref-media-unrevealed-main.less')).toBe(['.own {', '  a: 1;', '}'].join('\n'));
      expect(await renderFile('ref-media-unrevealed-main.less', false)).toBe(['.own {', '  a: 1;', '}'].join('\n'));
    });

    it('(reference) import, the hidden at-rules of a rule an extender in a mixin body reveals', async () => {
      const expected = ['.y {', '  c: 1;', '}'].join('\n');
      expect(await renderFile('ref-atrules-nested-main.less')).toBe(expected);
      expect(await renderFile('ref-atrules-nested-main.less', false)).toBe(expected);
    });

    it('(reference) import, exact extend that misses a nested rule', async () => {
      expect(await renderFile('ref-nested-main.less')).toBe('');
    });

    // A sheet a `(reference)` sheet imports is referenced too (ledger X13, A2).
    it('plain import inside a (reference) sheet', async () => {
      expect(await renderFile('ref-outer-main.less')).toBe(['.x {', '  b: 2;', '}'].join('\n'));
    });

    /*
     * Each `(reference)` or `(multiple)` import is its own placement of the sheet's rules, so
     * an extend in one `@media` block reaches only that block's copy (EXTEND-SEMANTICS §8,
     * jess#359).
     */
    it('(reference) imports in two @media blocks', async () => {
      expect(await renderFile('ref-media-main.less')).toBe(
        ['@media print {', '  .x {', '    b: 2;', '  }', '}', '@media screen {', '  .y {', '    c: 1;', '  }', '}'].join('\n')
      );
    });

    it('plain and (multiple) imports in two @media blocks', async () => {
      expect(await renderFile('multiple-media-main.less')).toBe(
        [
          '@media print {', '  .sm,', '  .x {', '    b: 2;', '  }', '}',
          '@media screen {', '  .sm {', '    b: 2;', '  }', '  .y {', '    c: 1;', '  }', '}'
        ].join('\n')
      );
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
  // Ledger X16, J15: an imported definition's own body-form extend applies at the call.
  it('a body-form extend in an imported mixin definition extends the calling rule', async () => {
    const expected = ['.sm,', '.x {', '  b: 2;', '}', '.x {', '  c: d;', '}'].join('\n');
    expect(await renderFile('def-extend-main.less')).toBe(expected);
    expect(await renderFile('def-extend-main.less', false)).toBe(expected);
  });

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
   * An `@import` inside a ruleset runs as that ruleset's body (jess#358): `@import` is a
   * source fold (ledger A2) whose body splices at the import position (ledger N10).
   */
  describe('@import inside a ruleset', () => {
    it('nests the imported rules under the ruleset', async () => {
      expect(await renderFile('ruleset-import-main.less')).toBe(['.wrap .sm {', '  b: 2;', '}'].join('\n'));
    });

    it('is an extend target at its nested placement', async () => {
      expect(await renderFile('ruleset-import-extend-main.less')).toBe(
        ['.wrap .sm,', '.x {', '  b: 2;', '}'].join('\n')
      );
    });

    /*
     * A `(reference)` import inside a ruleset runs as that ruleset's body too: its rules
     * nest under the ruleset, hidden unless an extend reveals them. Nested output does
     * not yet move a revealed rule out of the ruleset's block (EXTEND-SEMANTICS §6).
     */
    it('a (reference) import inside a ruleset nests its rules under the ruleset', async () => {
      expect(await renderFile('ref-in-ruleset-main.less')).toBe(
        ['.wrap {', '  a: 1;', '}', '.x {', '  b: 2;', '}'].join('\n')
      );
    });

    /*
     * Its hidden at-rules stay hidden whatever else the graph extends; one an extend
     * reveals a rule in renders around that rule alone.
     */
    it('a (reference) import inside a ruleset keeps its at-rules hidden', async () => {
      const expected = ['.zz,', '.x {', '  z: 1;', '}'].join('\n');
      expect(await renderFile('ref-atrules-in-ruleset-main.less')).toBe(expected);
      expect(await renderFile('ref-atrules-in-ruleset-main.less', false)).toBe(expected);
      expect(await renderFile('ref-atrules-reveal-main.less')).toBe(
        ['@media print {', '  .x {', '    p: 1;', '  }', '}'].join('\n')
      );
    });

    // The only extend in the graph sits in a sheet imported inside a ruleset.
    it('carries an extend that is only in the imported sheet', async () => {
      const expected = ['.sm,', '.wrap .x {', '  b: 2;', '}'].join('\n');
      expect(await renderFile('ruleset-import-extender-main.less')).toBe(expected);
      expect(await renderFile('ruleset-import-extender-main.less', false)).toBe(expected);
    });

    /*
     * The sheet's path is interpolated, so it is known only where the walk resolves it:
     * the walk records what it places. (Nested output does not yet rewrite a target
     * inside a parent block, EXTEND-SEMANTICS §6.)
     */
    it('carries an extend that is only in a sheet imported through an interpolated path', async () => {
      const expected = ['.w .k,', '.w .y {', '  k: 1;', '}'].join('\n');
      expect(await renderFile('ruleset-interp-path-main.less')).toBe(expected);
      expect(await renderFile('ruleset-local-interp-path-main.less')).toBe(expected);
    });

    it('inside a (reference) sheet, is an extend target at its nested placement', async () => {
      expect(await renderFile('ref-ruleset-import-main.less')).toBe(['.x {', '  b: 2;', '}'].join('\n'));
    });
  });

  /*
   * Extend across `@compose` follows Sass module semantics (ledger X14): the composing sheet's
   * extend reaches the composed module's rules, a module's extend reaches only its own rules
   * and what it composes — never the composing sheet's.
   */
  describe('@compose', () => {
    it('module rules are targets of the composing sheet', async () => {
      expect(await renderFile('compose-main.less')).toBe(['.sm,', '.x {', '  b: 2;', '}'].join('\n'));
    });

    it('a module extend does not reach the composing sheet', async () => {
      expect(await renderFile('compose-upstream-main.less')).toBe(
        ['.own,', '.z {', '  c: 3;', '}', '.sm {', '  b: 2;', '}'].join('\n')
      );
    });

    it('a module mixin-body extend does not reach the composing sheet', async () => {
      expect(await renderFile('compose-mixin-upstream-main.less')).toBe(['.sm {', '  b: 2;', '}'].join('\n'));
    });

    /*
     * A module is one module however many sheets compose it, and every one of them reaches
     * it, whichever composed it first.
     */
    it('a module composed by two sheets is reached by the extends of both, in either order', async () => {
      const ccY = ['.cc,', '.y {', '  c: 1;', '}'].join('\n');
      const aa = ['.aa {', '  a: 1;', '}'].join('\n');
      expect(await renderFile('diamond-main.less')).toBe(`${ccY}\n${aa}`);
      expect(await renderFile('diamond-reversed-main.less')).toBe(`${ccY}\n${aa}`);
      expect(await renderFile('diamond-direct-main.less')).toBe(ccY);
    });
  });

  /*
   * Nested output (`collapseNesting: false`) is the Less v5 default; the placement rules
   * above hold there too.
   */
  describe('nested output', () => {
    it('(reference) import, extender in a mixin body', async () => {
      expect(await renderFile('ref-mixin-main.less', false)).toBe(['.x {', '  b: 2;', '}'].join('\n'));
    });

    it('(reference) import, extender in a mixin body that is never called', async () => {
      expect(await renderFile('ref-uncalled-main.less', false)).toBe(['.own {', '  a: 1;', '}'].join('\n'));
    });

    it('(reference) imports in two @media blocks', async () => {
      expect(await renderFile('ref-media-main.less', false)).toBe(
        ['@media print {', '  .x {', '    b: 2;', '  }', '}', '@media screen {', '  .y {', '    c: 1;', '  }', '}'].join('\n')
      );
    });

    it('@import inside a ruleset nests the imported rules', async () => {
      expect(await renderFile('ruleset-import-main.less', false)).toBe(
        ['.wrap {', '  .sm {', '    b: 2;', '  }', '}'].join('\n')
      );
    });
  });
});
