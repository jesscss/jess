import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

describe('AST-v2 public production-route ratchet', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-ast-v2-ratchet-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const compiler = () => new Compiler({
    output: { collapseNesting: true }
  });

  it('returns a canonical Stylesheet and Context-owned document', async () => {
    const sourcePath = path.join(tempDir, 'document.less');
    fs.writeFileSync(sourcePath, '.a { color: red; }');
    const result = await compiler().safeCompile(
      sourcePath,
      { language: 'less' }
    );

    expect(result.document).toMatchObject({ type: 'Stylesheet' });
    expect(result.context.document).toBe(result.document);
    expect((result.context as unknown as { treeRoot?: unknown }).treeRoot).toBeUndefined();
  });

  it('renders Less evaluation directly from the canonical document', async () => {
    const css = await compiler().renderString(
      '@base: 2; .twice(@n) { width: @n * 2; } .a { .twice(@base); color: red; }',
      { language: 'less', extension: '.less' }
    );

    expect(css).toBe('.a {\n  width: 4;\n  color: red;\n}\n');
  });

  it('keeps imports on the Context/plugin route while retaining AST-v2 documents', async () => {
    const imported = path.join(tempDir, 'imported.less');
    const entry = path.join(tempDir, 'entry.less');
    fs.writeFileSync(imported, '.imported { color: blue; }');
    fs.writeFileSync(entry, '@import "imported.less"; .entry { color: red; }');

    const result = await compiler().safeCompile(entry, { language: 'less' });
    const css = await compiler().render(entry);

    expect(result.document).toMatchObject({ type: 'Stylesheet' });
    expect(css).toContain('.imported');
    expect(css).toContain('.entry');
  });

  it('keeps the compiled Stylesheet as plain AST-v2 data with no tree root', async () => {
    const sourcePath = path.join(tempDir, 'plain-data.less');
    fs.writeFileSync(sourcePath, '.a { color: red; }');
    const result = await compiler().safeCompile(sourcePath, { language: 'less' });

    expect(result.document).toMatchObject({ type: 'Stylesheet' });
    expect(Object.getPrototypeOf(result.document)).toBe(Object.prototype);
    expect((result.context as unknown as { treeRoot?: unknown }).treeRoot).toBeUndefined();
  });
});
