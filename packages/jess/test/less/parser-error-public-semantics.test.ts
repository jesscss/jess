import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Less parser errors through the public AST route', () => {
  it('reports the full inline JavaScript span instead of only the start offset', async () => {
    const source = '.entry { value: `1 + 1`; }';
    const result = await new Compiler().renderToResult(
      { source, filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    const start = source.indexOf('`') + 1;
    const end = source.lastIndexOf('`') + 2;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/unsupported-inline-javascript',
      phase: 'parse',
      message: 'Inline backtick JavaScript is not supported.',
      reason: 'Backtick JavaScript expressions are not evaluated.',
      fix: expect.stringContaining('@from/@-from'),
      line: 1,
      column: start,
      endLine: 1,
      endColumn: end,
      file: { source }
    });
  });

  it('preserves targeted bare at-variable interpolation ranges on result and throw paths', async () => {
    const source = '@smartphone: (max-width: 600px);\n@media @smartphone { .entry { color: red; } }';
    const compiler = new Compiler();
    const result = await compiler.renderToResult(
      { source, filePath: 'media.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/unsupported-bare-variable-interpolation',
      phase: 'parse',
      message: 'Bare @variable interpolation is not valid here.',
      reason: expect.stringContaining('interpolation must use @{variable}'),
      fix: 'Use @{smartphone} instead of @smartphone.',
      line: 2,
      column: 8,
      endLine: 2,
      endColumn: 19,
      file: { source }
    });

    await expect(compiler.renderString(source, {
      filePath: 'media.less',
      extension: '.less'
    })).rejects.toMatchObject({
      code: 'parse/unsupported-bare-variable-interpolation',
      reason: expect.stringContaining('interpolation must use @{variable}'),
      fix: 'Use @{smartphone} instead of @smartphone.',
      line: 2,
      column: 8,
      endLine: 2,
      endColumn: 19
    });
  });

  it('reports dynamic @charset interpolation with actionable guidance', async () => {
    const source = '@Eight: 8;\n@charset "UTF-@{Eight}";';
    const result = await new Compiler().renderToResult(
      { source, filePath: 'charset.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/dynamic-charset',
      phase: 'parse',
      message: 'Interpolation is not valid in @charset.',
      reason: 'Interpolation is not valid inside the CSS @charset token.',
      fix: 'Use a static declaration such as @charset "UTF-8";.',
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 25,
      file: { source }
    });
  });

  it('summarizes value-position parser failures without leaking atom internals', async () => {
    const source = [
      '.theme() {',
      '  foo: bar;',
      '}',
      '',
      '.val {',
      '  @alias: .theme;',
      '  foo: @alias[foo];',
      '}'
    ].join('\n');
    const result = await new Compiler().renderToResult(
      { source, filePath: 'namespacing.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/invalid-value',
      phase: 'parse',
      message: 'Invalid value.',
      reason: 'Less expected a value here, but this token cannot start one.',
      fix: 'Rewrite this position as a valid value or move the syntax into a statement position.',
      line: 6,
      column: 9,
      file: { source }
    });
    expect(result.errors[0]?.reason).not.toContain('CssSyntaxNumber');
    expect(result.errors[0]?.reason).not.toContain('not(peek)');
  });
});
