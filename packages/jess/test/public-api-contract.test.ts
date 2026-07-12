import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { logger } from '@jesscss/core';

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

  it('disposes public compiler instances idempotently', () => {
    const compiler = new Compiler();

    expect(() => {
      compiler.dispose();
      compiler.dispose();
    }).not.toThrow();
  });
});
