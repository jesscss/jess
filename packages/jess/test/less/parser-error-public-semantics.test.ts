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
      fix: 'Use a static declaration such as @charset "UTF-8";',
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 25,
      file: { source }
    });
  });

  it('reports unsupported legacy Less variable names through the public compiler route', async () => {
    const compiler = new Compiler();
    const cases = [
      {
        source: [
          '@theme: red;',
          '.entry {',
          '  color: @1;',
          '}'
        ].join('\n'),
        line: 3,
        column: 10,
        endLine: 3,
        endColumn: 12
      },
      {
        source: '@-: red;',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 3
      },
      {
        source: 'each(1, .(@-) { color: red; });',
        line: 1,
        column: 11,
        endLine: 1,
        endColumn: 13
      }
    ] as const;

    for (const testCase of cases) {
      const result = await compiler.renderToResult(
        {
          source: testCase.source,
          filePath: 'legacy-variable.less',
          extension: '.less'
        },
        { breakOnError: false }
      );

      expect(result.errors, testCase.source).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: 'parse/unsupported-variable-name',
        phase: 'parse',
        message: 'This Less variable name is not supported.',
        reason: 'Less variable names must not be numeric-leading or dash-only.',
        fix: expect.stringContaining('descriptive variable name'),
        line: testCase.line,
        column: testCase.column,
        endLine: testCase.endLine,
        endColumn: testCase.endColumn,
        file: { source: testCase.source }
      });
    }

    await expect(compiler.renderString(cases[0].source, {
      filePath: 'legacy-variable.less',
      extension: '.less'
    })).rejects.toMatchObject({
      code: 'parse/unsupported-variable-name',
      line: cases[0].line,
      column: cases[0].column,
      endLine: cases[0].endLine,
      endColumn: cases[0].endColumn
    });
  });

  it('reports unsupported legacy Less interpolation and mixin names precisely', async () => {
    const compiler = new Compiler();
    const cases = [
      {
        source: '.@{1} { color: red; }',
        code: 'parse/unsupported-variable-name',
        message: 'This Less variable name is not supported.',
        column: 2,
        endColumn: 6
      },
      {
        source: '.-() { color: red; }',
        code: 'parse/unsupported-mixin-name',
        message: 'This Less mixin name is not supported.',
        column: 1,
        endColumn: 5
      }
    ] as const;

    for (const testCase of cases) {
      const result = await compiler.renderToResult(
        {
          source: testCase.source,
          filePath: 'legacy-syntax.less',
          extension: '.less'
        },
        { breakOnError: false }
      );

      expect(result.errors, testCase.source).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: testCase.code,
        phase: 'parse',
        message: testCase.message,
        line: 1,
        column: testCase.column,
        endLine: 1,
        endColumn: testCase.endColumn,
        file: { source: testCase.source }
      });
    }
  });

  it('reports unparenthesized Less mixin guards at the guard condition', async () => {
    const source = '.m() when default() { color: red; }\n.entry { .m(); }';
    const compiler = new Compiler();
    const result = await compiler.renderToResult(
      { source, filePath: 'guard.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/unparenthesized-mixin-guard',
      phase: 'parse',
      message: 'Less mixin guard conditions must be parenthesized.',
      reason: 'Top-level Less mixin guards require each condition after when to be wrapped in parentheses.',
      fix: 'Wrap the guard condition, for example: when (default()).',
      line: 1,
      column: 11,
      endLine: 1,
      endColumn: 20,
      file: { source }
    });

    await expect(compiler.renderString(source, {
      filePath: 'guard.less',
      extension: '.less'
    })).rejects.toMatchObject({
      code: 'parse/unparenthesized-mixin-guard',
      line: 1,
      column: 11,
      endLine: 1,
      endColumn: 20
    });

    const valid = await compiler.renderToResult(
      {
        source: '.m() when (default()) { color: red; }\n.entry { .m(); }',
        filePath: 'guard.less',
        extension: '.less'
      },
      { breakOnError: false }
    );
    expect(valid.errors).toEqual([]);
  });

  it('summarizes selector-context parser failures without leaking atom internals', async () => {
    /*
     * The failure lands on the `:` at line 6, column 9. Under correct 0.48.1
     * narrowing the deepest frame is a rule/selector position (a block,
     * combinator, class/id selector, or mixin call could continue), NOT a value
     * position — it only looked like one while the 0.46.0 OP_CHOICE union bug
     * widened the expected set into the value-atom signature. The clean summary
     * must name that frame in prose and never print the raw selector regex.
     */
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
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Expected a selector, mixin call, or block.',
      reason: 'Less expected a selector, mixin call, or block to continue here, but this token starts none of them.',
      fix: 'Continue the selector, call a mixin, or open a block with \'{\'.',
      line: 6,
      column: 9,
      file: { source }
    });

    // The hard requirement: no parser internals reach the user, for any frame.
    expect(result.errors[0]?.reason).not.toContain('NumberToken');
    expect(result.errors[0]?.reason).not.toContain('not(peek)');
    expect(result.errors[0]?.reason).not.toContain('[.#]');
    expect(result.errors[0]?.reason).not.toContain('u0080');
    expect(result.errors[0]?.reason).not.toContain('The parser expected');
  });

  it('summarizes missing closing delimiters without raw expected-token text', async () => {
    const source = '.entry { color: rgb(1,2; }';
    const result = await new Compiler().renderToResult(
      { source, filePath: 'delimiter.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Missing closing parenthesis.',
      reason: 'Less expected \')\' to close the open construct before this token.',
      fix: 'Add the missing \')\' or remove the unmatched \'(\'.',
      line: 1,
      column: 26,
      file: { source }
    });
    expect(result.errors[0]?.message).not.toContain('Expected:');
    expect(result.errors[0]?.reason).not.toContain('The parser expected');
  });

  it('uses source-backed delimiter summaries for generic parser failures', async () => {
    const compiler = new Compiler();
    const cases = [
      {
        source: [
          '@media (missing: bracket {',
          '  body {',
          '    color: red;',
          '  }',
          '}'
        ].join('\n'),
        message: 'Missing closing parenthesis.',
        reason: 'Less expected \')\' to close the open construct before this token.',
        fix: 'Add the missing \')\' or remove the unmatched \'(\'.',
        line: 1,
        column: 26
      },
      {
        source: [
          '.custom {',
          '  --custom: ({',
          '    is-unmatched: [',
          '  })',
          '}'
        ].join('\n'),
        message: 'Missing closing bracket.',
        reason: 'Less expected \']\' to close the open construct before this token.',
        fix: 'Add the missing \']\' or remove the unmatched \'[\'.',
        line: 4,
        column: 3
      }
    ] as const;

    for (const testCase of cases) {
      const result = await compiler.renderToResult(
        { source: testCase.source, filePath: 'delimiter.less', extension: '.less' },
        { breakOnError: false }
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: 'parse/syntax-error',
        phase: 'parse',
        message: testCase.message,
        reason: testCase.reason,
        fix: testCase.fix,
        line: testCase.line,
        column: testCase.column,
        file: { source: testCase.source }
      });
      expect(result.errors[0]?.reason).not.toContain('rule, declaration, or at-rule');
    }
  });

  it('uses source-backed string summaries for generic parser failures', async () => {
    const compiler = new Compiler();
    const cases = [
      {
        source: '@import "theme.less;',
        column: 9
      },
      {
        source: '.entry { content: \'hello; }',
        column: 19
      }
    ] as const;

    for (const testCase of cases) {
      const result = await compiler.renderToResult(
        { source: testCase.source, filePath: 'string.less', extension: '.less' },
        { breakOnError: false }
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: 'parse/unterminated-string',
        phase: 'parse',
        message: 'Unterminated string.',
        reason: 'Less expected the quoted string to be closed before the end of the source.',
        fix: 'Add the missing closing quote.',
        line: 1,
        column: testCase.column,
        file: { source: testCase.source }
      });
      expect(result.errors[0]?.reason).not.toContain('rule, declaration, or at-rule');
    }
  });

  it('summarizes semicolon expectations without raw token lists', async () => {
    const source = '@namespace svg url(http://www.w3.org/2000/svg) .x {}';
    const result = await new Compiler().renderToResult(
      { source, filePath: 'namespace.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Missing semicolon.',
      reason: 'Less expected \';\' before this token.',
      fix: 'Add the missing \';\' or rewrite the statement.',
      line: 1,
      column: 48,
      file: { source }
    });
    expect(result.errors[0]?.message).not.toContain('Expected:');
    expect(result.errors[0]?.reason).not.toContain('";"');
  });

  it('reports a root-level leading combinator at its own site, not a later construct', async () => {
    /*
     * jess rejects a stylesheet-root leading combinator by design (P29). The
     * failure must land on the offending `> .a`, never be re-localized by the
     * whole-source delimiter scan onto an unrelated well-formed construct.
     */
    const lone = '> .a { color: red }';
    const loneResult = await new Compiler().renderToResult(
      { source: lone, filePath: 'combinator.less', extension: '.less' },
      { breakOnError: false }
    );
    expect(loneResult.errors).toHaveLength(1);
    expect(loneResult.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Unexpected Less syntax.',
      line: 1,
      column: 1,
      file: { source: lone }
    });
    expect(loneResult.errors[0]?.message).not.toContain('parenthesis');

    /*
     * A following `each(map-keys(@x), #(@k) { … })` puts a `{` inside a `(`,
     * which a naive delimiter scan mistakes for a missing `)` on the each line.
     * The error must still point at the root `> .a`, not inside the each.
     */
    const withEach = [
      '> .a {',
      '  color: red;',
      '}',
      'each(map-keys(@grid-breakpoints), #(@breakpoint) {',
      '  .b { color: red; }',
      '});'
    ].join('\n');
    const eachResult = await new Compiler().renderToResult(
      { source: withEach, filePath: 'combinator-each.less', extension: '.less' },
      { breakOnError: false }
    );
    expect(eachResult.errors).toHaveLength(1);
    expect(eachResult.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Unexpected Less syntax.',
      line: 1,
      column: 1,
      file: { source: withEach }
    });
    expect(eachResult.errors[0]?.message).not.toContain('parenthesis');
  });
});
