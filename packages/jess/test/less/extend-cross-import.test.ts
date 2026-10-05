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
 *      surfaces on its own.
 *
 *   3. GRAPH-WIDE TARGETS. An imported sheet with no `:extend()` of its own is still a target for
 *      an extend anywhere else in the import graph.
 *
 * EXPECTED OUTPUTS ARE THE ORACLE — derived from real `less@4` (standalone `less.render`, NOT the
 * jess-backed alpha), except where v5 intentionally grafts `:is()` instead of duplicating
 * (EXTEND-SEMANTICS §5). Jess is asserted to match; a divergence would be a FINDING (marked
 * `it.fails` + reported), never code-to-match.
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

describe('extend across @import (output oracle vs less@4)', () => {
  // less@4 4.6.7 oracle:
  //   .c, .b, .a { color: red; }
  //   .b, .a      { background: blue; }
  //   .a          { font-weight: bold; }
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

  // less@4 4.6.7 oracle: the referenced `.target` never surfaces on its own; only the extender
  // `.ext` renders (once with the pulled-in referenced declaration, once with its own body):
  //   .ext { color: red; }
  //   .ext { background: blue; }
  it('reference-import: referenced target stays hidden; only the extender surfaces', async () => {
    const css = await renderFile('ref-main.less');
    // Negative-visibility guard: the referenced `.target` header must NOT appear in output.
    expect(css).not.toContain('.target');
    expect(css).toBe(
      ['.ext {', '  color: red;', '}', '.ext {', '  background: blue;', '}'].join('\n')
    );
  });

  /*
   * less@4 4.6.7 oracle:
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
   * targets for every other document in the import graph (jess#349). Oracle: less 4.9.1.
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

    // less 4.9.1 duplicates per extender (`.sm .y, .x .y`); v5 grafts `:is()` (EXTEND-SEMANTICS §5).
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
});
