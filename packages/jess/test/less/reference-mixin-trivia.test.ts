import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const fixture = path.resolve(
  __dirname,
  'fixtures/reference-mixin-trivia/main.less'
);
const asyncFixture = path.resolve(
  __dirname,
  'fixtures/reference-mixin-trivia/async-main.less'
);
const rejectFixture = path.resolve(
  __dirname,
  'fixtures/reference-mixin-trivia/reject-main.less'
);
const fixtureDir = path.dirname(asyncFixture);

describe('reference mixin trivia', () => {
  it.each([true, false])(
    'drains root call trivia before the next ruleset (collapse=%s)',
    async (collapseNesting) => {
      const source = '.empty() { /* captured root-only */ }\n'
        + '.empty();\n'
        + '.a { x: 1; }\n';
      const compiler = new Compiler({
        output: { collapseNesting },
        compile: { plugins: [lessPlugin()] }
      });

      const result = await compiler.renderToResult({
        source,
        language: 'less',
        extension: '.less'
      }, {});

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(
        '/* captured root-only */\n'
        + '.a {\n'
        + '  x: 1;\n'
        + '}\n'
      );
    }
  );

  it.each([true, false])(
    'drains direct at-rule call trivia before the next ruleset (collapse=%s)',
    async (collapseNesting) => {
      const source = '.empty() { /* captured atrule-only */ }\n'
        + '@media screen {\n'
        + '  .empty();\n'
        + '  .a { x: 1; }\n'
        + '}\n';
      const compiler = new Compiler({
        output: { collapseNesting },
        compile: { plugins: [lessPlugin()] }
      });

      const result = await compiler.renderToResult({
        source,
        language: 'less',
        extension: '.less'
      }, {});

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(
        '@media screen {\n'
        + '  /* captured atrule-only */\n'
        + '  .a {\n'
        + '    x: 1;\n'
        + '  }\n'
        + '}\n'
      );
    }
  );

  it.each([true, false])(
    'does not leak trivia from a capture-only each() iterable (collapse=%s)',
    async (collapseNesting) => {
      const source = '.m() { a: 1; /* captured tail */ }\n'
        + 'each(.m(), { .item-@{key} { value: @value; } });\n'
        + '.after { z: 2; }\n';
      const compiler = new Compiler({
        output: { collapseNesting },
        compile: { plugins: [lessPlugin()] }
      });

      const result = await compiler.renderToResult({
        source,
        language: 'less',
        extension: '.less'
      }, {});

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(
        '.item-a {\n'
        + '  value: 1;\n'
        + '}\n'
        + '.after {\n'
        + '  z: 2;\n'
        + '}\n'
      );
    }
  );

  it.each([
    [
      true,
      '.a {\n'
      + '  x: 1;\n'
      + '  /* mixin tail */\n'
      + '}\n'
      + '.a .child {\n'
      + '  y: 2;\n'
      + '}\n'
      + '.a {\n'
      + '  z: 3;\n'
      + '}\n'
    ],
    [
      false,
      '.a {\n'
      + '  x: 1;\n'
      + '  .child {\n'
      + '    y: 2;\n'
      + '  }\n'
      + '  z: 3;\n'
      + '  /* mixin tail */\n'
      + '}\n'
    ]
  ] as const)(
    'keeps a mixin-tail comment with its buffer across a nested boundary (collapse=%s)',
    async (collapseNesting, expected) => {
      const source = '.mixin() {\n'
        + '  z: 3;\n'
        + '  /* mixin tail */\n'
        + '}\n'
        + '.a {\n'
        + '  x: 1;\n'
        + '  .child { y: 2; }\n'
        + '  .mixin();\n'
        + '}\n';
      const compiler = new Compiler({
        output: { collapseNesting },
        compile: { plugins: [lessPlugin()] }
      });

      const result = await compiler.renderToResult({
        source,
        language: 'less',
        extension: '.less'
      }, {});

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(expected);
    }
  );

  it.each([true, false])(
    'replays the selected body comment with collapseNesting=%s',
    async (collapseNesting) => {
      const compiler = new Compiler({
        output: { collapseNesting },
        compile: { plugins: [lessPlugin({ rewriteUrls: 'all' })] }
      });

      const result = await compiler.renderToResult(fixture);

      expect(result.css).toBe(
        '.consumer {\n'
        + '  color: green /* carried inline */;\n'
        + '  /* carried from the selected body */\n'
        + '  /* carried from the selected empty body */\n'
        + '  /* carried after the merge */\n'
        + '  box-shadow: url("nested/merge-one.png") /* carried from the first merge member */, url("nested/merge-two.png") /* carried from the merge anchor */, url("caller.png") /* carried from the caller merge */;\n'
        + '}\n'
      );
    }
  );

  /*
   * A leaf that a reference-imported mixin authored keeps its inline comment in
   * its own document's trivia, so it is written correctly only once that document
   * is re-entered: in a plain body (collapsed and nested flushes), in a merge group
   * whose members all come from the one imported document, and in a directive body
   * that writes its leaves one by one.
   */
  it.each([
    ['plain body', '.consumer {\n  .library();\n}\n',
      '.consumer {\n  color: green /* carried inline */;\n  /* carried from the selected body */\n}\n'],
    ['merge group', '@import (reference) "nested/merge-library.less";\n.consumer {\n  .merged();\n}\n',
      '.consumer {\n'
      + '  box-shadow: url("nested/merge-one.png") /* carried from the first merge member */, url("nested/merge-two.png") /* carried from the merge anchor */;\n'
      + '  /* carried after the merge */\n'
      + '}\n'],
    ['directive body', '@media screen {\n  .library();\n}\n',
      '@media screen {\n  color: green /* carried inline */;\n  /* carried from the selected body */\n}\n']
  ].flatMap(([position, body, css]) => [true, false].map(collapseNesting => ({ position, body, css, collapseNesting }))))(
    'writes imported leaves in their own document in a $position (collapseNesting=$collapseNesting)',
    async ({ body, css, collapseNesting }) => {
      const compiler = new Compiler({
        output: { collapseNesting },
        compile: { plugins: [lessPlugin({ rewriteUrls: 'all' })] }
      });

      const result = await compiler.renderToResult({
        source: '@import (reference) "library.less";\n' + body,
        filePath: path.join(fixtureDir, 'consumer.less'),
        language: 'less',
        extension: '.less'
      });

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(css);
    }
  );

  it('keeps delayed plugin capabilities in the imported source and restores the caller', async () => {
    const compiler = new Compiler({
      compile: {
        plugins: [
          lessPlugin({ rewriteUrls: 'all' }),
          jsPlugin({ jsReadRoot: fixtureDir, runtimeApi: 'less' }),
          lessCompatPlugin()
        ]
      },
      output: { collapseNesting: true }
    });

    const result = await compiler.renderToResult(asyncFixture, {
      breakOnError: false,
      suppressWarnings: false
    });

    expect(result.errors).toEqual([]);
    const capabilityLogs = result.warnings.filter(warning =>
      warning.code === 'plugin/log' && warning.reason.includes('IMPORTED_CAPABILITY_LOG'));
    expect(capabilityLogs.length).toBeGreaterThan(0);
    expect(capabilityLogs.every(warning =>
      warning.filePath === path.join(fixtureDir, 'nested/async-library.less')
      && warning.line === 6)).toBe(true);
    expect(result.css).toBe(
      '.consumer {\n'
      + '  direct: url("nested/asset.png");\n'
      + '  via-plugin: url("nested/asset.png");\n'
      + '  capabilities: 50%;\n'
      + '  file-after-async-arg: async-library.less;\n'
      + '  /* imported trailing */\n'
      + '}\n'
      + '.after {\n'
      + '  image: url("after.png");\n'
      + '  /* caller trailing */\n'
      + '}\n'
    );
  }, 30000);

  it('restores caller provenance after a delayed imported plugin rejection', async () => {
    const compiler = new Compiler({
      compile: {
        plugins: [
          lessPlugin({ rewriteUrls: 'all' }),
          jsPlugin({ jsReadRoot: fixtureDir, runtimeApi: 'less' }),
          lessCompatPlugin()
        ],
        functionMode: 'error'
      },
      output: { collapseNesting: true }
    });

    const result = await compiler.renderToResult(rejectFixture, {
      breakOnError: false,
      suppressWarnings: true
    });

    const failure = result.errors.find(error => error.code === 'plugin/function-threw');
    expect(failure?.reason).toContain('IMPORTED_ASSET_FAILURE');
    expect(failure?.filePath).toBe(path.join(fixtureDir, 'nested/async-library.less'));
    expect(failure?.line).toBe(12);
    expect(result.css).toContain(
      '.after {\n'
      + '  image: url("after.png");\n'
      + '  /* caller after rejection */\n'
      + '}\n'
    );
  }, 30000);
});
