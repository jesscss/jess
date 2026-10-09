/**
 * The output's one `@charset` (ledger N11): the first document-level `@charset` in the
 * output, the entry's or one an imported sheet holds, is written at its very top, since
 * a stylesheet's encoding is read only from its first bytes (CSS Syntax 3 §3.2). A
 * later one written the same is dropped; a later one naming another encoding is
 * dropped with an `eval/charset-conflict` warning (orchestrator judgment under owner
 * delegation 2026-10-09).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Compiler } from '../../src/index.js';

async function renderFiles(files: Array<[string, string]>): Promise<{ css: string; warnings: string[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-charset-'));
  for (const [name, source] of files) {
    fs.writeFileSync(path.join(dir, name), source);
  }
  const compiler = new Compiler();
  try {
    const result = await compiler.renderToResult(path.join(dir, files[0]![0]), { quiet: true });
    return { css: result.css, warnings: result.warnings.map(warning => warning.code ?? '') };
  } finally {
    compiler.dispose();
  }
}

describe('a @charset from an imported sheet', () => {
  it('is written at the top of the output', async () => {
    await expect(renderFiles([
      ['main.less', '/* lead */\n@import "lib.less";\n.m { a: 1; }\n'],
      ['lib.less', '@charset "UTF-8";\n.l { b: 2; }\n']
    ])).resolves.toEqual({ css: '@charset "UTF-8";\n/* lead */\n.l {\n  b: 2;\n}\n.m {\n  a: 1;\n}\n', warnings: [] });
  });

  it('is dropped after one written the same, and warns after one naming another encoding', async () => {
    await expect(renderFiles([
      ['main.less', '@import "a.less";\n@import "b.less";\n'],
      ['a.less', '@charset "UTF-8";\n.a { a: 1; }\n'],
      ['b.less', '@charset "UTF-8";\n.b { b: 2; }\n']
    ])).resolves.toEqual({ css: '@charset "UTF-8";\n.a {\n  a: 1;\n}\n.b {\n  b: 2;\n}\n', warnings: [] });
    await expect(renderFiles([
      ['main.less', '@import "a.less";\n@import "b.less";\n'],
      ['a.less', '@charset "UTF-8";\n.a { a: 1; }\n'],
      ['b.less', '@charset "ISO-8859-1";\n.b { b: 2; }\n']
    ])).resolves.toEqual({ css: '@charset "UTF-8";\n.a {\n  a: 1;\n}\n.b {\n  b: 2;\n}\n', warnings: ['eval/charset-conflict'] });
    await expect(renderFiles([
      ['main.less', '@charset "UTF-8";\n@import "b.less";\n'],
      ['b.less', '@charset "ISO-8859-1";\n.b { b: 2; }\n']
    ])).resolves.toEqual({ css: '@charset "UTF-8";\n.b {\n  b: 2;\n}\n', warnings: ['eval/charset-conflict'] });
  });
});
