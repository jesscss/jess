/**
 * The output's one `@charset` (ledger N11): a stylesheet's encoding is read only
 * from its first bytes (CSS Syntax 3 §3.2), and Jess writes its output as UTF-8.
 * The first document-level `@charset` that names UTF-8, the entry's or one an
 * imported sheet holds, is written at its very top; a later one is dropped. One
 * that names another encoding would mis-declare the UTF-8 output (`é` read as
 * `Ã©`), so it is dropped with an `eval/charset-not-utf8` warning naming its file
 * (agent judgment 2026-10-09, awaiting owner; DESIGN-DECISIONS-NOTES N11).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Compiler } from '../../src/index.js';

async function renderFiles(
  files: Array<[string, string]>,
  collapseNesting: false | 'native' = false
): Promise<{ css: string; warnings: string[]; messages: string[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-charset-'));
  for (const [name, source] of files) {
    fs.writeFileSync(path.join(dir, name), source);
  }
  const compiler = new Compiler({ output: { collapseNesting } });
  try {
    const result = await compiler.renderToResult(path.join(dir, files[0]![0]), { quiet: true });
    return {
      css: result.css,
      warnings: result.warnings.map(warning => warning.code ?? ''),
      messages: result.warnings.map(warning => warning.message)
    };
  } finally {
    compiler.dispose();
  }
}

describe('a @charset from an imported sheet', () => {
  it('is written at the top of the output', async () => {
    await expect(renderFiles([
      ['main.less', '/* lead */\n@import "lib.less";\n.m { a: 1; }\n'],
      ['lib.less', '@charset "UTF-8";\n.l { b: 2; }\n']
    ])).resolves.toMatchObject({ css: '@charset "UTF-8";\n/* lead */\n.l {\n  b: 2;\n}\n.m {\n  a: 1;\n}\n', warnings: [] });
  });

  it('is dropped after one naming UTF-8 in any case, with no warning', async () => {
    await expect(renderFiles([
      ['main.less', '@import "a.less";\n@import "b.less";\n'],
      ['a.less', '@charset "UTF-8";\n.a { a: 1; }\n'],
      ['b.less', '@charset "utf-8";\n.b { b: 2; }\n']
    ])).resolves.toMatchObject({ css: '@charset "UTF-8";\n.a {\n  a: 1;\n}\n.b {\n  b: 2;\n}\n', warnings: [] });
    await expect(renderFiles([
      ['main.less', '@charset "utf-8";\n@import "b.less";\n'],
      ['b.less', '@charset "UTF-8";\n.b { b: 2; }\n']
    ])).resolves.toMatchObject({ css: '@charset "utf-8";\n.b {\n  b: 2;\n}\n', warnings: [] });
  });

  it('is dropped with a warning naming its file when it names another encoding', async () => {
    const latin = await renderFiles([
      ['main.less', '@import "latin.less";\n.u { content: "é"; }\n'],
      ['latin.less', '@charset "ISO-8859-1";\n.x { y: 1; }\n']
    ]);
    expect(latin.css).toBe('.x {\n  y: 1;\n}\n.u {\n  content: "é";\n}\n');
    expect(latin.warnings).toEqual(['eval/charset-not-utf8']);
    expect(latin.messages[0]).toContain('latin.less');

    await expect(renderFiles([
      ['main.less', '@import "a.less";\n@import "b.less";\n'],
      ['a.less', '@charset "UTF-8";\n.a { a: 1; }\n'],
      ['b.less', '@charset "ISO-8859-1";\n.b { b: 2; }\n']
    ])).resolves.toMatchObject({ css: '@charset "UTF-8";\n.a {\n  a: 1;\n}\n.b {\n  b: 2;\n}\n', warnings: ['eval/charset-not-utf8'] });
  });

  it('leaves no empty rule where it was imported into a rule', async () => {
    const files: Array<[string, string]> = [
      ['main.less', '.a { @import "lib.less"; }\n'],
      ['lib.less', '@charset "UTF-8";\n.l { b: 2; }\n']
    ];
    await expect(renderFiles(files, 'native')).resolves.toMatchObject({ css: '@charset "UTF-8";\n.a .l {\n  b: 2;\n}\n', warnings: [] });
  });
});

describe('the entry\'s own @charset', () => {
  it('is dropped with a warning when it names another encoding', async () => {
    const entry = await renderFiles([['main.less', '@charset "ISO-8859-1";\n.u { content: "é"; }\n']]);
    expect(entry.css).toBe('.u {\n  content: "é";\n}\n');
    expect(entry.warnings).toEqual(['eval/charset-not-utf8']);
    expect(entry.messages[0]).toContain('main.less');
  });
});
