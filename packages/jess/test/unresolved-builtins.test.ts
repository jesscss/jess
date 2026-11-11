import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

const CODE = 'eval/unresolved-builtin';
type Mode = 'off' | 'warn' | 'error';

const compile = async (source: string, extension: '.less' | '.scss', mode?: Mode) => {
  const result = await new Compiler(mode === undefined ? {} : { compile: { unresolvedBuiltins: mode } })
    .renderToResult({ source, filePath: `entry${extension}`, extension });
  return { result, reports: [...result.warnings, ...result.errors].filter(diagnostic => diagnostic.code === CODE) };
};
const less = (source: string, mode?: Mode) => compile(`@use "#less";\n${source}`, '.less', mode);
const scss = (source: string, mode?: Mode) => compile(source, '.scss', mode);

describe('unresolvedBuiltins: a namespaced built-in that did not compute', () => {
  it.each([
    ['.x { v: @less.fade(#333, var(--a)); }', 'rgb(from #333 r g b / calc(var(--a) / 100%))', 2, 9],
    ['.x { v: @less.rgb(var(--r), 0, 0); }', 'rgb(var(--r), 0, 0)', 2, 9]
  ])('warns at %s, naming what it printed', async (source, printed, line, column) => {
    const { result, reports } = await less(source, 'warn');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line, column });
    expect(reports[0]!.reason).toContain(`It printed ${printed}, so the output depends on browser support for that form.`);
    expect(result.css).toContain(`v: ${printed};`);
  });

  it.each([
    ['@use "sass:math";\na { b: math.sqrt(var(--x)); }', 2, 8],
    ['@use "sass:color";\na { b: color.adjust(var(--c), $red: 10); }', 2, 8],
    ['@use "sass:math" as m;\na { b: m.sqrt(var(--x)); }', 2, 8]
  ])('warns at %s in .scss', async (source, line, column) => {
    const { reports } = await scss(source, 'warn');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line, column });
  });

  it.each([
    ['.x { v: @less.fade(#333, var(--a)); }', less],
    ['@use "sass:math";\na { b: math.sqrt(var(--x)); }', scss]
  ])('says nothing and prints the same when off: %s', async (source, run) => {
    const off = await run(source, 'off');
    const unset = await run(source);
    expect(off.reports).toEqual([]);
    expect(unset.reports).toEqual([]);
    expect(off.result.css).toBe(unset.result.css);
    expect(off.result.warnings).toEqual(unset.result.warnings);
  });

  it('reports every such call as an error, and the compile fails at the end', async () => {
    const { result, reports } = await less('.x { a: @less.fade(#333, var(--a)); b: @less.mix(red, var(--c)); }', 'error');
    expect(reports.map(report => report.column)).toEqual([9, 40]);
    expect(result.errors).toHaveLength(2);
    await expect(new Compiler({ compile: { unresolvedBuiltins: 'error' } }).renderString(
      '@use "#less";\n.x { a: @less.fade(#333, var(--a)); }',
      { filePath: 'entry.less', extension: '.less' }
    )).rejects.toMatchObject({ code: CODE, line: 2, column: 9 });
  });

  describe('does not count', () => {
    it.each([
      ['a bare call', '.x { a: fade(#333, var(--a)); b: hsl(120, 50%, var(--l)); c: darken(var(--x), 10%); }'],
      ['a namespaced call that computed', '@use "#less";\n.x { v: @less.fade(#333, 50%); }']
    ])('%s', async (_name, source) => {
      expect((await compile(source, '.less', 'error')).reports).toEqual([]);
    });

    it.each([
      ['a name under `as *`', '@use "sass:color" as *;\na { b: adjust(var(--c), $red: 10); }'],
      ['a bare call', 'a { b: hsl(120, 50%, var(--l)); }'],
      ['a namespaced call that computed', '@use "sass:color";\na { b: color.adjust(#c00, $red: 10); }'],
      ['a value a namespaced call handed back', '@use "sass:map";\n$theme: (brand: var(--brand));\na { b: map.get($theme, brand); }']
    ])('%s in .scss', async (_name, source) => {
      expect((await scss(source, 'error')).reports).toEqual([]);
    });

    it.each([
      ['a form', '@less.fade(#333, @a)', '25%', 'rgb(from #333 r g b / var(--a, 25%))'],
      ['a recipe', '@less.unit(@a, px)', '50%', 'var(--a-unit, 50px)'],
      ['a value only the browser knows', '@less.fade(#333, @a)', 'var(--y)', 'rgb(from #333 r g b / calc(var(--a, var(--y)) / 100%))']
    ])('an exposed variable, keeping %s', async (_name, call, value, printed) => {
      const { result, reports } = await less(`.x { v: ${call}; }\n@expose a;\n@a: ${value};`, 'error');
      expect(reports).toEqual([]);
      expect(result.css).toContain(`v: ${printed};`);
    });

    it('a call that already fails, which keeps its own error', async () => {
      const { result, reports } = await less('.x { v: @less.lightness(var(--c)); }', 'warn');
      expect(reports).toEqual([]);
      expect(result.errors[0]?.code).toBe('eval/invalid-function');
    });
  });

  it('does not count a namespace in a name it leaves bare: a .jess `as *`', async () => {
    const result = await new Compiler({ compile: { unresolvedBuiltins: 'error' } })
      .renderToResult({ source: '@-use "#less" as *;\n.x { v: $fade(#333, var(--a)); }', filePath: 'entry.jess', extension: '.jess', language: 'jess' });
    expect(result.errors).toEqual([]);
    expect(result.css).toContain('v: rgb(from #333 r g b / calc(var(--a) / 100%));');
  });

  it.each([
    ['@a * 2'],
    ['(@a * 2)'],
    ['-@a'],
    ['calc(@a * 2)']
  ])('does not count math over an exposed variable alone: %s', async (amount) => {
    expect((await less(`.x { v: @less.fade(#333, ${amount}); }\n@expose a;\n@a: 25%;`, 'error')).reports).toEqual([]);
  });

  it('does not count math over an exposed variable through a variable or a mixin argument', async () => {
    expect((await less('@b: @a * 2;\n.x { v: @less.fade(#333, @b); }\n@expose a;\n@a: 25%;', 'error')).reports).toEqual([]);
    expect((await less('.m(@c) { v: @less.fade(#333, @c * 2); }\n.x { .m(@a); }\n@expose a;\n@a: 25%;', 'error')).reports).toEqual([]);
  });

  it('counts math over an exposed variable and a real unknown', async () => {
    const { reports } = await less('.x { v: @less.fade(#333, @a * var(--x)); }\n@expose a;\n@a: 25%;', 'warn');
    expect(reports).toHaveLength(1);
  });

  it.each([
    ['@less.convert(var(--x), px)'],
    ['@less.convert(calc(var(--x)), px)']
  ])('counts a form over a calc() it was given: %s', async (call) => {
    expect((await less(`.x { v: ${call}; }`, 'warn')).reports).toHaveLength(1);
  });

  it.each([
    ['@less.extract(var(--a) 2, 1)'],
    ['@less.e("x")'],
    ['@less.replace("a", "a", "b")']
  ])('does not count a value a Less call only handed back or computed: %s', async (call) => {
    expect((await less(`.x { v: ${call}; }`, 'error')).reports).toEqual([]);
  });

  it.each([
    ['@use "sass:list";\na { b: list.nth((var(--a), 2), 1); }'],
    ['@use "sass:map";\n$theme: (dark: (brand: var(--brand)));\na { b: map.get($theme, dark, brand); }'],
    ['@use "sass:string";\na { b: string.unquote("x"); }']
  ])('does not count a value a .scss call only handed back or computed: %s', async (source) => {
    expect((await scss(source, 'error')).reports).toEqual([]);
  });

  describe('names the file the call is written in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unresolved-builtins-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    /* Each file as `[name, source]`, the entry last. */
    const reportsOf = async (files: Array<[string, string]>) => {
      for (const [name, source] of files) {
        writeFileSync(join(dir, name), source);
      }
      const [entry, source] = files[files.length - 1]!;
      const result = await new Compiler({ compile: { unresolvedBuiltins: 'warn' } }).renderToResult({ source, filePath: join(dir, entry) });
      return result.warnings
        .filter(warning => warning.code === CODE)
        .map(warning => `${basename(warning.filePath ?? '')}:${warning.line}:${warning.column}`);
    };

    it('a token in a partial', async () => {
      expect(await reportsOf([
        ['_tokens.less', `${'// tokens\n'.repeat(13)}@brand-a: @less.fade(#333, var(--a));\n`],
        ['site.less', '@use "#less";\n@import "./_tokens.less";\n.x { a: @brand-a; }\n']
      ])).toEqual(['_tokens.less:14:11']);
    });

    it('light and dark partials, whose calls sit at the same offset', async () => {
      expect(await reportsOf([
        ['_light.less', '@light: @less.fade(#fff, var(--a));\n'],
        ['_dark.less', '@dark:  @less.fade(#000, var(--a));\n'],
        ['themes.less', '@use "#less";\n@import "./_light.less";\n@import "./_dark.less";\n.light { c: @light; }\n.dark { c: @dark; }\n']
      ])).toEqual(['_light.less:1:9', '_dark.less:1:9']);
    });

    it('a .scss partial through @import and a module member', async () => {
      const partial = '@use "sass:math";\n$tok: math.sqrt(var(--x));\n';
      expect(await reportsOf([['_tok.scss', partial], ['imports.scss', '@import "tok";\na { b: $tok; }\n']])).toEqual(['_tok.scss:2:7']);
      expect(await reportsOf([['_tokens.scss', partial], ['uses.scss', '@use "tokens";\na { b: tokens.$tok; }\n']])).toEqual(['_tokens.scss:2:7']);
    });

    it('a .scss module function', async () => {
      expect(await reportsOf([
        ['_mod.scss', '@use "sass:math";\n\n@function f($v) { @return math.sqrt($v); }\n'],
        ['calls.scss', '@use "mod";\na { b: mod.f(var(--y)); }\n']
      ])).toEqual(['_mod.scss:3:27']);
    });
  });

  it('counts a real unknown beside an exposed variable, naming the output', async () => {
    const { reports } = await less('.x { v: @less.fade(var(--x), @a); }\n@expose a;\n@a: 25%;', 'warn');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.reason).toContain('It printed rgb(from var(--x) r g b / var(--a, 25%)),');
  });

  describe('reports once per written call', () => {
    it.each([
      ['a variable read many times', '@x: @less.fade(#333, var(--a));\n.a { b: @x; c: @x; }\n.d { e: @x; }', 2, 5],
      ['a mixin run many times', '.m(@c) { v: @less.fade(@c, var(--a)); }\n.a { .m(red); }\n.b { .m(blue); }', 2, 13]
    ])('%s', async (_name, source, line, column) => {
      const { reports } = await less(source, 'warn');
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ line, column });
    });

    it('a .scss mixin run many times', async () => {
      const { reports } = await scss('@use "sass:color";\n@mixin m { b: color.adjust(var(--c), $red: 10); }\na { @include m; }\nc { @include m; }', 'warn');
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ line: 2, column: 15 });
    });

    it('each of two calls, and an outer call over an inner one', async () => {
      expect((await less('.x { a: @less.fade(#333, var(--a)); b: @less.fade(#333, var(--a)); }', 'warn')).reports).toHaveLength(2);
      const { reports } = await less('.x { v: @less.darken(@less.fade(#333, var(--a)), 10%); }', 'warn');
      expect(reports.map(report => report.column)).toEqual([22, 9]);
    });
  });
});
