/**
 * Import-once is counted per output context: the chain of rule selectors and at-rule
 * preludes a copy would render into, the root being the empty one (owner 2026-10-09: once
 * counts per scope, if the output would be different). A mixin call or loop iteration
 * belongs to the context it is called in, a bare-`&` rule to its parent's, and an imported
 * sheet's root to its importer's. A copy placed in another context never makes an import a
 * no-op, and an `@import` of a sheet an enclosing `@import` is still placing is always one,
 * so a sheet that imports itself, directly or through another sheet, ends.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/** Write `files` (name, source) to a fresh directory and render the first one. */
async function renderFilesResult(files: Array<[string, string]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-once-scope-'));
  for (const [name, source] of files) {
    fs.writeFileSync(path.join(dir, name), source);
  }
  const compiler = new Compiler({ output: { collapseNesting: 'native' }, compile: { plugins: [lessPlugin()] } });
  return compiler.renderToResult(path.join(dir, files[0]![0]), { quiet: true });
}

async function renderFiles(files: Array<[string, string]>): Promise<string> {
  return (await renderFilesResult(files)).css.trim();
}

const t: [string, string] = ['t.less', '.t { a: 1; }'];
const tRule = '.t {\n  a: 1;\n}';

describe('import-once scope', () => {
  it('a sheet that imports itself through a nested scope ends', async () => {
    await expect(renderFiles([
      ['main.less', '@import "s.less";'],
      ['s.less', '.s { a: 1; } .x { @import "s.less"; }']
    ])).resolves.toBe('.s {\n  a: 1;\n}');
    await expect(renderFiles([
      ['main.less', '@import "s.less";'],
      ['s.less', '.s { a: 1; } @media print { @import "s.less"; }']
    ])).resolves.toBe('.s {\n  a: 1;\n}');
    await expect(renderFiles([
      ['main.less', '@import "c1.less";'],
      ['c1.less', '.c1 { a: 1; } .x { @import "c2.less"; }'],
      ['c2.less', '.c2 { b: 1; } .y { @import "c1.less"; }']
    ])).resolves.toBe('.c1 {\n  a: 1;\n}\n.x .c2 {\n  b: 1;\n}');
  });

  /*
   * A `(multiple)` import of a sheet an enclosing import is still placing would place
   * copies without end: it is an import cycle, raised in the sheet that writes it, never
   * a stack overflow (SETTLED — orchestrator judgment under owner delegation 2026-10-07).
   * Any other import of such a sheet is a no-op, one inside a `(multiple)` sheet included.
   */
  it('raises an import cycle for a (multiple) import of a sheet still being placed', async () => {
    for (const files of [
      [['main.less', '@import "ms.less";'], ['ms.less', '.s { a: 1; } @import (multiple) "ms.less";']],
      [['ms.less', '.s { a: 1; } @import (multiple) "ms.less";']],
      [['main.less', '@import (multiple) "c1.less";'], ['c1.less', '.c1 { a: 1; } @import "c2.less";'], ['c2.less', '@import (multiple) "c1.less";']]
    ] as Array<Array<[string, string]>>) {
      const result = await renderFilesResult(files);
      expect(result.errors.map(error => error.code), files[0]![1]).toEqual(['import/cycle']);
      expect(path.basename(result.errors[0]!.filePath ?? ''), files[0]![1]).toBe(files.length === 3 ? 'c2.less' : 'ms.less');
    }
    await expect(renderFiles([['main.less', '@import (multiple) "mb.less";'], ['mb.less', '.b { c: 1; } @import "mb.less";']]))
      .resolves.toBe('.b {\n  c: 1;\n}');
  });

  /*
   * A rule whose selector is a bare `&`, guarded or not, writes into its parent's
   * selector, so it is its parent's import-once scope (SETTLED — orchestrator judgment
   * under owner delegation 2026-10-07).
   */
  it('a bare `&` rule imports into its parent\'s scope', async () => {
    for (const main of [
      '& when (true) { @import "t.less"; } @import "t.less";',
      '& { @import "t.less"; } @import "t.less";',
      '@import "t.less"; & when (true) { @import "t.less"; }'
    ]) {
      await expect(renderFiles([['main.less', main], t]), main).resolves.toBe(tRule);
    }
    await expect(renderFiles([['main.less', '.x { & { @import "t.less"; } @import "t.less"; }'], t]))
      .resolves.toBe('.x .t {\n  a: 1;\n}');

    // The parent's scope, not the root: a ruleset around it is still a scope of its own.
    await expect(renderFiles([['main.less', '.x { & when (true) { @import "t.less"; } } @import "t.less";'], t]))
      .resolves.toBe(`.x .t {\n  a: 1;\n}\n${tRule}`);
  });

  it('a mixin call places its imports in the scope it is called in', async () => {
    await expect(renderFiles([['main.less', '.m() { @import "t.less"; } .m(); @import "t.less";'], t]))
      .resolves.toBe(tRule);
    await expect(renderFiles([['main.less', '@import "t.less"; .m() { @import "t.less"; } .m();'], t]))
      .resolves.toBe(tRule);
    await expect(renderFiles([['main.less', '.m() { @import "t.less"; } .a { @import "t.less"; .m(); }'], t]))
      .resolves.toBe('.a .t {\n  a: 1;\n}');
    await expect(renderFiles([['main.less', '.m() { @import "t.less"; } .a { .m(); .m(); }'], t]))
      .resolves.toBe('.a .t {\n  a: 1;\n}');

    // Calls from two rulesets are two scopes.
    await expect(renderFiles([['main.less', '.m() { @import "t.less"; } .x { .m(); } .y { .m(); }'], t]))
      .resolves.toBe('.x .t {\n  a: 1;\n}\n.y .t {\n  a: 1;\n}');
  });

  it('places one copy per output context', async () => {
    // Two rules with one selector, or two at-rules with one prelude, are one context.
    await expect(renderFiles([['main.less', '.a { @import "t.less"; } .a { @import "t.less"; }'], t]))
      .resolves.toBe('.a .t {\n  a: 1;\n}');
    await expect(renderFiles([['main.less', '@media print { @import "t.less"; } @media print { @import "t.less"; }'], t]))
      .resolves.toBe('@media print {\n  .t {\n    a: 1;\n  }\n}');
    await expect(renderFiles([['main.less', '@w: 768px; @media (max-width: @w) { @import "t.less"; } @media (max-width:768px) { @import "t.less"; }'], t]))
      .resolves.toBe('@media (max-width: 768px) {\n  .t {\n    a: 1;\n  }\n}');

    // Another selector, prelude or nesting is another context.
    await expect(renderFiles([['main.less', '.a { @import "t.less"; } .b { @import "t.less"; }'], t]))
      .resolves.toBe('.a .t {\n  a: 1;\n}\n.b .t {\n  a: 1;\n}');
    await expect(renderFiles([['main.less', '@media print { @import "t.less"; } @media screen { @import "t.less"; } @import "t.less";'], t]))
      .resolves.toBe(`@media print {\n  .t {\n    a: 1;\n  }\n}\n@media screen {\n  .t {\n    a: 1;\n  }\n}\n${tRule}`);
    await expect(renderFiles([['main.less', '.a { @import "t.less"; } .x { .a { @import "t.less"; } }'], t]))
      .resolves.toBe('.a .t {\n  a: 1;\n}\n.x .a .t {\n  a: 1;\n}');
  });

  it('places the root copy of a mixins-only sheet a ruleset imported first', async () => {
    await expect(renderFiles([
      ['main.less', '.container { @import "mx.less"; .mx(); } @import "mx.less"; .root { .mx(); }'],
      ['mx.less', '.mx() { m: 1; }']
    ])).resolves.toBe('.container {\n  m: 1;\n}\n.root {\n  m: 1;\n}');
  });
});
