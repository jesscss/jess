/**
 * Import-once is counted per scope: the root, one ruleset or one at-rule block, where a
 * mixin call or loop iteration belongs to the scope it is called in, and an imported
 * sheet's root to its importer's. A copy placed in another scope never makes an import a
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
async function renderFiles(files: Array<[string, string]>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-once-scope-'));
  for (const [name, source] of files) {
    fs.writeFileSync(path.join(dir, name), source);
  }
  const compiler = new Compiler({ output: { collapseNesting: 'native' }, compile: { plugins: [lessPlugin()] } });
  const result = await compiler.renderToResult(path.join(dir, files[0]![0]));
  return result.css.trim();
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
});
