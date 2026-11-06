import { describe, expect, it } from 'vitest';
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
    ['.x { v: @less.fade(#333, var(--a)); }', 'rgb(from #333 r g b / var(--a))', 2, 9],
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
      ['a form', '25%', 'rgb(from #333 r g b / var(--a, 25%))'],
      ['a recipe', '.5', 'var(--a-fade, rgba(51, 51, 51, 0.005))'],
      ['a value only the browser knows', 'var(--y)', 'rgb(from #333 r g b / var(--a, var(--y)))']
    ])('an exposed variable, keeping %s', async (_name, value, printed) => {
      const { result, reports } = await less(`.x { v: @less.fade(#333, @a); }\n@expose a;\n@a: ${value};`, 'error');
      expect(reports).toEqual([]);
      expect(result.css).toContain(`v: ${printed};`);
    });

    it('a call that already fails, which keeps its own error', async () => {
      const { result, reports } = await less('.x { v: @less.lightness(var(--c)); }', 'warn');
      expect(reports).toEqual([]);
      expect(result.errors[0]?.code).toBe('eval/invalid-function');
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
