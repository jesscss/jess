/**
 * import-media-query.test.ts — a media/layer/supports postlude on a COMPILE-TIME
 * `@import` is a PARSE ERROR (§12.3b, owner ruling 2026-08-07).
 *
 * This file used to pin the shape of the `@media` wrapper such an import
 * produced: `@import "file" screen and (max-width: 600px)` loaded the file and
 * wrapped its rules in ONE `@media <full query>` block (the bug it guarded was a
 * wrapper decomposed per query term). That whole construct is gone. A postlude
 * describes a LINKED CSS resource, and a loaded document is spliced into this
 * one instead — so once the parser has decided an import is compile-time, the
 * postlude has nothing left to describe and is rejected outright.
 *
 * This DIVERGES deliberately from lessc 4.x, which accepts the source and emits
 * the `@media` wrapper. A postlude remains valid on a plain CSS `@import`, where
 * it stays in the at-rule prelude and is emitted verbatim.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const fixtures = path.join(__dirname, 'fixtures', 'import-media-query');

const mkCompiler = () =>
  new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin()] }
  });

describe('a media query on a compile-time @import is rejected', () => {
  it('reports a parse error instead of wrapping the loaded document in @media', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'main.less'));

    expect(result.css.trim()).toBe('');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'A compile-time @import cannot carry a media query.'
    });
  });

  /* A postlude on a plain CSS `@import` is still valid, and still emitted. */
  it('keeps a media query on a CSS @import in the at-rule prelude', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'css-postlude.less'));

    expect(result.errors).toHaveLength(0);
    expect(result.css.trim()).toBe('@import "linked.css" screen and (max-width: 600px);');
  });

  it.each([
    ['without a path rewrite', lessPlugin(), 'theme.css'],
    ['while rewriting the typed target', lessPlugin({ rootpath: 'root/' }), 'root/theme.css']
  ])('keeps root-hoisted import trivia %s', async (_name, plugin, target) => {
    const source = [
      '.before { a: b; }',
      '@import /* lead */ "theme.css" /* keep */ screen;',
      '.after { c: d; }'
    ].join('\n');
    const css = await new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [plugin] }
    }).renderString(source, { language: 'less' });

    expect(css.trim()).toBe([
      `@import /* lead */ "${target}" /* keep */ screen;`,
      '.before {',
      '  a: b;',
      '}',
      '.after {',
      '  c: d;',
      '}'
    ].join('\n'));
  });

  it('keeps comment trivia around a target-only CSS import', async () => {
    const css = await mkCompiler().renderString(
      '@import /* lead */ "theme.css" /* trail */;',
      { language: 'less' }
    );

    expect(css.trim()).toBe('@import /* lead */ "theme.css" /* trail */;');
  });

  it.each([
    ['without a path rewrite', lessPlugin(), 'theme.css'],
    ['while rewriting the URL target', lessPlugin({ rootpath: 'root/' }), 'root/theme.css']
  ])('keeps URL-form import trivia %s', async (_name, plugin, target) => {
    const source = [
      '@import /* lead */ url("theme.css") /* keep */ screen;',
      '.after { c: d; }'
    ].join('\n');
    const css = await new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [plugin] }
    }).renderString(source, { language: 'less' });

    expect(css.trim()).toBe([
      `@import /* lead */ url("${target}") /* keep */ screen;`,
      '.after {',
      '  c: d;',
      '}'
    ].join('\n'));
  });

  it('owns the complete mixed comment gap without replaying it later', async () => {
    const source = [
      '@import /* keep */ // hidden',
      ' "theme.css";',
      '.after { c: d; }'
    ].join('\n');
    const css = await new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin({ rootpath: 'root/' })] }
    }).renderString(source, { language: 'less' });

    expect(css.trim()).toBe([
      '@import /* keep */ "root/theme.css";',
      '.after {',
      '  c: d;',
      '}'
    ].join('\n'));
  });

  it('keeps typed-tail trivia inside the tail while preserving its boundary', async () => {
    const css = await new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin({ rootpath: 'root/' })] }
    }).renderString(
      '@x: red; @import "theme.css" /* boundary */ (color: /* inside */ @x);',
      { language: 'less' }
    );

    expect(css.trim()).toBe(
      '@import "root/theme.css" /* boundary */ (color: /* inside */ red);'
    );
  });

  it.each([
    ['for an unchanged quote', lessPlugin(), '"theme.css"', '"theme.css"'],
    ['for a rewritten quote', lessPlugin({ rootpath: 'root/' }), '"theme.css"', '"root/theme.css"'],
    ['for an unchanged URL', lessPlugin(), 'url("theme.css")', 'url("theme.css")'],
    ['for a rewritten URL', lessPlugin({ rootpath: 'root/' }), 'url("theme.css")', 'url("root/theme.css")']
  ])('keeps inner typed-tail trivia %s', async (_name, plugin, authored, emitted) => {
    const css = await new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [plugin] }
    }).renderString(
      `@x: red; @import ${authored} (color: /* inside */ @x);`,
      { language: 'less' }
    );

    expect(css.trim()).toBe(
      `@import ${emitted} (color: /* inside */ red);`
    );
  });

  it('parses and renders an imported Less file whose media header has interpolated terms', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'interpolated-main.less'));
    expect(result.css.trim()).toBe(
      [
        '@media all and (tv) {',
        '  .all-and-tv-variables {',
        '    value: passed;',
        '  }',
        '}'
      ].join('\n')
    );
  });
});
