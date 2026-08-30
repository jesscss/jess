/**
 * extend-cross-import.test.ts — OUTPUT-level coverage for extend semantics that cross an
 * `@import` boundary. Two gaps the reachability/predicate suites do not reach at the rendered-
 * CSS level:
 *
 *   1. CROSS-IMPORT TRANSITIVE CLOSURE. `.a:extend(.b)` (main) and `.b:extend(.c)` (imported)
 *      split across an `@import`. The closure `.c ← .b ← .a` must resolve THROUGH the import so
 *      the imported `.c` block gains BOTH `.b` and `.a`. (Extend-through-import is currently
 *      EVAL-routed — the spine fold is a separate WIP — so this may route to eval; the assertion
 *      is on OUTPUT and holds regardless of routing.)
 *
 *   2. REFERENCE-IMPORT VISIBILITY (negative). `@import (reference)` hides the imported sheet's
 *      own rules from output, but an extend that MATCHES a referenced target pulls in only the
 *      matched rule under the EXTENDER's selector — the referenced `.target` header itself never
 *      surfaces on its own.
 *
 * EXPECTED OUTPUTS ARE THE ORACLE — derived from real `less@4` (less 4.6.7 standalone
 * `less.render`, NOT the jess-backed alpha). Jess is asserted to match; a divergence would be a
 * FINDING (marked `it.fails` + reported), never code-to-match.
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
});
