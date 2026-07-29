import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { logger, type PluginInterface } from '@jesscss/core';

describe('public API contract', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-public-api-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps root output on public render APIs', async () => {
    const source = '@charset "UTF-8";\n@import url("test.css");\n.a { color: red; }';
    const testFile = path.join(tempDir, 'public-root-output.less');
    fs.writeFileSync(testFile, source);

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessCompatPlugin()]
      }
    });

    const rendered = await compiler.render(testFile);
    const renderedString = await compiler.renderString(source, {
      filePath: testFile,
      language: 'less',
      extension: '.less'
    });
    const result = await compiler.renderToResult({
      source,
      filePath: testFile,
      language: 'less',
      extension: '.less'
    });

    for (const css of [rendered, renderedString, result.css]) {
      expect(css).toContain('@charset "UTF-8";');
      expect(css).toContain('@import url("test.css");');
      expect(css).toContain('.a');
    }

    const compiled = await compiler.safeCompile(testFile);
    expect(compiled.document).toMatchObject({ type: 'Stylesheet' });
  });

  it('evaluates Less values through the public AST route', async () => {
    const css = await new Compiler({ output: { collapseNesting: true } }).renderString(
      '@base: 2; .twice(@n) { width: @n * 2; } .a { .twice(@base); half: percentage(.5); }',
      { language: 'less', extension: '.less' }
    );

    expect(css).toContain('width: 4;');
    expect(css).toContain('half: 50%;');
  });

  it('deduplicates exact declarations contributed by mixin overloads and repeated calls', async () => {
    const css = await new Compiler({ output: { collapseNesting: true } }).renderString(
      '.same() { color: red; } .same() { color: red; } .out { .same(); .same(); }',
      { language: 'less', extension: '.less' }
    );

    expect(css).toBe('.out {\n  color: red;\n}\n');
  });

  it('honors Less mathMode through the public AST route', async () => {
    const source = '.a { raw: 10px / 2; computed: (10px / 2); }';
    const css = await new Compiler({ compile: { mathMode: 'parens-division' } }).renderString(source, {
      language: 'less', extension: '.less'
    });

    expect(css).toContain('raw: 10px / 2;');
    expect(css).toContain('computed: 5px;');
  });

  it('keeps a preserved Less slash group opaque through a later operation', async () => {
    const css = await new Compiler().renderString(`
      @div-op: 10px / 2;
      .a { result: @div-op * 2; }
    `, { language: 'less', extension: '.less' });

    expect(css).toContain('result: 10px / 2 * 2;');
  });

  it('honors explicit collapseNesting without an outputFile across config shapes', async () => {
    const source = '.a {\n  .b {\n    color: red;\n    .c { color: blue; }\n  }\n}';
    const testFile = path.join(tempDir, 'collapse.less');
    fs.writeFileSync(testFile, source);

    const isFlat = (css: string) => css.includes('.a .b') && css.includes('.a .b .c');
    const isNested = (css: string) => /\.a \{[\s\S]*\.b \{/.test(css) && !css.includes('.a .b');

    // Object output, no outputFile: explicit flag must be honored (not silently nested).
    expect(isFlat(await new Compiler({ output: { collapseNesting: true } }).render(testFile)))
      .toBe(true);
    expect(isNested(await new Compiler({ output: { collapseNesting: false } }).render(testFile)))
      .toBe(true);

    // Array output with a file-bearing entry, no outputFile: the entry's flag is
    // honored even though no path selects it.
    expect(isFlat(await new Compiler({
      output: [{ file: '{name}.css', collapseNesting: true }]
    }).render(testFile))).toBe(true);
    expect(isNested(await new Compiler({
      output: [{ file: '{name}.css', collapseNesting: false }]
    }).render(testFile))).toBe(true);

    // A file-less defaults entry outranks an untargeted per-file entry.
    expect(isFlat(await new Compiler({
      output: [{ collapseNesting: true }, { file: '{name}.css', collapseNesting: false }]
    }).render(testFile))).toBe(true);

    // Ambiguous: multiple file entries disagree with no target → language default (nested).
    expect(isNested(await new Compiler({
      output: [{ file: 'a.css', collapseNesting: true }, { file: 'b.css', collapseNesting: false }]
    }).render(testFile))).toBe(true);

    // An explicit outputFile still selects the matching entry (matched path unchanged).
    expect(isFlat(await new Compiler({
      output: [{ file: '{name}.css', collapseNesting: true }, { file: 'other.css', collapseNesting: false }]
    }).render(testFile, { outputFile: path.join(tempDir, 'collapse.css') }))).toBe(true);
  });

  it('keeps renderToResult non-throwing for render diagnostics', async () => {
    const source = '.a { color: @missing; }';
    const testFile = path.join(tempDir, 'diagnostic-result.less');
    fs.writeFileSync(testFile, source);
    const compiler = new Compiler();
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    try {
      await expect(compiler.renderString(source, {
        filePath: testFile,
        language: 'less',
        extension: '.less',
        config: { suppressWarnings: true }
      })).rejects.toThrow();
    } finally {
      loggerError.mockRestore();
    }

    const result = await compiler.renderToResult({
      source,
      filePath: testFile,
      language: 'less',
      extension: '.less'
    }, {
      suppressWarnings: true
    });

    expect(result).toMatchObject({
      css: '',
      warnings: []
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.loadedUrls).toEqual([]);
  });

  it('surfaces imported source loader failures through renderToResult', async () => {
    const entryFile = path.join(tempDir, 'entry.less');
    const importedFile = path.join(tempDir, 'tokens.less');
    fs.writeFileSync(entryFile, '@import "tokens.less";\n.a { color: red; }\n');
    fs.writeFileSync(importedFile, '.tokens { color: blue; }\n');

    const loaderFailure = 'import loader timed out while reading tokens.less';
    const failingSourcePlugin: PluginInterface = {
      name: 'node-modules',
      resolve(filePath, currentDir) {
        const paths = Array.isArray(filePath) ? filePath : [filePath];
        return paths.map(candidate => path.isAbsolute(candidate) ? candidate : path.resolve(currentDir, candidate));
      },
      locate(candidates) {
        return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
      },
      async getSource(filePath) {
        if (filePath === importedFile) {
          throw new Error(loaderFailure);
        }
        return fs.promises.readFile(filePath, 'utf8');
      }
    };

    const result = await new Compiler({
      compile: { plugins: [failingSourcePlugin] }
    }).renderToResult(entryFile, {
      suppressWarnings: true,
      colors: false
    });

    expect(result.css).toBe('');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'import/load-failed',
        phase: 'import',
        message: expect.stringContaining(loaderFailure),
        reason: expect.stringContaining(loaderFailure)
      })
    ]));
  });

  it('disposes public compiler instances idempotently', () => {
    const compiler = new Compiler();

    expect(() => {
      compiler.dispose();
      compiler.dispose();
    }).not.toThrow();
  });
});
