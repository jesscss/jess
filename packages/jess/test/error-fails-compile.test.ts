import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * An error-severity diagnostic fails the compile, whichever phase recorded it
 * (owner 2026-10-16: *"compiling stops on the first error"*, *"if the
 * diagnostic treats it as an error, then no it doesn't succeed"*). A parser
 * that recovers from a well-formed shape its dialect rejects still returns its
 * document (P45), so the error is reported at its span, and then the compile
 * fails: `render` / `renderString` reject with it, `renderToResult` returns no
 * CSS with the error, and the CLI exits non-zero. A warning never fails it.
 *
 * Only the Less parser recovers from errors today; the CSS, SCSS and `.jess`
 * parsers stop at theirs. Each code it recovers from is listed here.
 */
const RECOVERED: ReadonlyArray<readonly [code: string, source: string, line: number, column: number]> = [
  ['parse/condition-keyword-case', '.m(@a) when (@a > 1) AND (@a < 5) { x: in; }\n.a { .m(3); }', 1, 22],
  ['parse/invalid-mixin-argument', '.m(@a, @rest...; @c) { x: y; }\n.other { a: b; }', 1, 8],
  ['parse/ambiguous-not', '.a { c: boolean(not 1 > 2); }', 1, 23]
];

const compiler = new Compiler({ quiet: true });

describe('an error the parser recovered from fails the compile', () => {
  it.each(RECOVERED)('%s: renderString rejects with it', async (code, source, line, column) => {
    await expect(compiler.renderString(source, { extension: '.less', config: { quiet: true } }))
      .rejects.toMatchObject({ code, line, column });
  });

  it.each(RECOVERED)('%s: renderToResult returns no CSS and the one error', async (code, source, line, column) => {
    const result = await compiler.renderToResult({ source, filePath: '/proj/entry.less' }, { quiet: true, suppressWarnings: true });
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[code, line, column]]);
  });

  it('fails the compile from an imported sheet', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-error-fails-'));
    try {
      fs.writeFileSync(path.join(directory, 'part.less'), '.m(@a) when (@a > 1) AND (@a < 5) { x: in; }\n');
      const entry = path.join(directory, 'entry.less');
      fs.writeFileSync(entry, '@import "part.less";\n.a { .m(3); }\n');
      await expect(compiler.render(entry, { quiet: true })).rejects.toMatchObject({ code: 'parse/condition-keyword-case' });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stops at the first error, and collects every error when asked to', async () => {
    const source = '.m(@a) when (@a > 1) AND (@a < 5) { x: in; }\n.a { .m(3); b: @missing; }';
    await expect(compiler.renderString(source, { extension: '.less', config: { quiet: true } }))
      .rejects.toMatchObject({ code: 'parse/condition-keyword-case' });
    const collected = await compiler.renderToResult(
      { source, filePath: '/proj/entry.less' },
      { quiet: true, suppressWarnings: true, breakOnError: false }
    );
    expect(collected.css).toBe('');
    expect(collected.errors[0]).toMatchObject({ code: 'parse/condition-keyword-case', line: 1, column: 22 });
  });
});

describe('a warning does not fail the compile', () => {
  it.each([
    ['css', '@media screen and(max-width: 1px) { a { b: c } }'],
    ['less', '@media screen and(max-width: 1px) { a { b: c } }'],
    ['scss', '@media screen and(max-width: 1px) { a { b: c } }'],
    ['jess', '@media screen and(max-width: 1px) { a { b: c } }']
  ])('%s', async (dialect, source) => {
    const result = await compiler.renderToResult({ source, filePath: `/proj/entry.${dialect}` }, { quiet: true, suppressWarnings: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map(warning => warning.code)).toEqual(['css/glued-condition-keyword']);
    expect(result.css).toBe('@media screen and(max-width: 1px) {\n  a {\n    b: c;\n  }\n}\n');
    await expect(compiler.renderString(source, { extension: `.${dialect}`, config: { quiet: true, suppressWarnings: true } }))
      .resolves.toBe(result.css);
  });
});

const bin = path.resolve(fileURLToPath(new URL('../bin/cli.mjs', import.meta.url)));

function cli(args: string[]): Promise<{ code: number; stderr: string }> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.VSCODE_INSPECTOR_OPTIONS;
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], { env }, (error, _stdout, stderr) => {
      resolve({ code: error && typeof error.code === 'number' ? error.code : 0, stderr });
    });
  });
}

describe('the CLI', () => {
  it.each(RECOVERED)('%s: exits non-zero and writes no CSS', async (code, source) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-error-fails-cli-'));
    try {
      const input = path.join(directory, 'entry.less');
      const output = path.join(directory, 'entry.css');
      fs.writeFileSync(input, source);
      const result = await cli([input, output]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(code);
      expect(fs.existsSync(output)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
