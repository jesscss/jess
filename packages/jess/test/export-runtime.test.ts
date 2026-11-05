import type { ExportRecipe, Fn } from '@jesscss/core';
import * as less from '@jesscss/fns/less';
import { createRuntime, type RuntimeRecipe } from '@jesscss/fns/runtime';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/* eslint-disable @typescript-eslint/naming-convention -- keys are module specifiers and custom property names. */

/**
 * The browser runtime (ledger A4, R8 slice 3) recomputes a value derived from
 * an export with the functions the compile ran: given a new value, it writes
 * what a compile of that value writes.
 */
const modules: Readonly<Record<string, Readonly<Record<string, unknown>>>> = { '@jesscss/fns/less': less };

function toRuntime(recipe: ExportRecipe | string): RuntimeRecipe {
  if (typeof recipe === 'string' || 'export' in recipe) {
    return recipe;
  }
  const fn = modules[recipe.fn.module]?.[recipe.fn.name];
  if (typeof fn !== 'function') {
    throw new Error(`No ${recipe.fn.name} in ${recipe.fn.module}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a member of a function module, as the generated module imports it.
  return [fn as Fn, recipe.args.map(toRuntime)];
}

async function compile(source: string) {
  return new Compiler({}).renderToResult({ filePath: 'entry.less', source, language: 'less' });
}

describe('the export runtime', () => {
  it.each([
    ['@less.lightness(@brand)', '#08f'],
    ['@less.lightness(@brand)', 'rebeccapurple'],
    ['@less.luma(@less.multiply(@brand, #888))', '#3a7'],
    ['@less.alpha(@less.fade(@brand, 50%))', '#123456'],
    ['@less.lightness(@less.spin(@brand, 30))', '#123']
  ])('writes what a compile writes: %s with %s', async (expression, value) => {
    const exported = await compile(`@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ brand: value });
    const [property] = Object.keys(derived);
    const recompiled = await compile(`@use "#less";\n@brand: ${value};\n.a { v: ${expression}; }`);
    expect(vars['--brand']).toBe(value);
    expect(recompiled.css).toContain(`v: ${vars[property!]};`);
  });

  it('leaves a function with a CSS form to the browser', async () => {
    const exported = await compile('@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.spin(@brand, 30); }');
    expect(exported.css).toContain('v: hsl(from var(--brand, #c00) calc(h + 30) s l);');
    expect(exported.runtime!.derived).toEqual({});
    expect(exported.runtime!.defaults).toEqual({});
  });

  it.each(['10px', '"str"', 'foo'])('rejects an export whose own value a form cannot take: %s', async (value) => {
    await expect(new Compiler({}).renderString(`@use "#less";\n@expose brand;\n@brand: ${value};\n.a { v: @less.darken(@brand, 10%); }`, { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it.each([
    ['@less.rgba(@brand, .5)', '#c00', 'rgb(from var(--brand, #c00) r g b / 0.5)'],
    ['@less.rgb(@brand, 50%)', '#c00', 'rgb(from var(--brand, #c00) r g b / 0.5)'],
    ['@less.rgba(@brand, .5)', 'red', 'rgb(from var(--brand, red) r g b / 0.5)'],
    ['@less.rgba(@brand, .5)', 'currentcolor', 'rgb(from var(--brand, currentcolor) r g b / 0.5)'],
    ['@less.rgb(@brand)', '#c00', 'var(--brand, #c00)'],
    ['@less.rgba(#c00, @brand)', '.5', 'rgb(from #c00 r g b / var(--brand, 0.5))'],
    ['@less.rgb(@brand, 0, 0)', '10', 'rgb(var(--brand, 10), 0, 0)'],
    ['@less.rgb(0, @brand, 0)', '10', 'rgb(0, var(--brand, 10), 0)'],
    ['@less.rgba(1, 2, 3, @brand)', '.5', 'rgba(1, 2, 3, var(--brand, 0.5))'],
    ['@less.fade(@less.rgb(@brand, 0, 0), 50%)', '10', 'rgb(from rgb(var(--brand, 10), 0, 0) r g b / 0.5)']
  ])('prints %s of %s over its var(), with no recipe', async (expression, value, printed) => {
    const exported = await compile(`@use "#less";\n@expose brand;\n@brand: ${value};\n.a { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(exported.runtime!.derived).toEqual({});
  });

  it.each([
    ['@less.rgba(@brand, .5)', '10'],
    ['@less.rgb(@brand, 0, 0)', 'red'],
    ['@less.rgb(0, @brand, 0)', 'foo']
  ])('fails %s when the export is %s, which that slot cannot take', async (expression, value) => {
    await expect(new Compiler({}).renderString(`@use "#less";\n@expose brand;\n@brand: ${value};\n.a { v: ${expression}; }`, { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it('runs rgb() as a recipe inside a function with no CSS form', async () => {
    const exported = await compile('@use "#less";\n@expose r;\n@r: 200;\n.a { v: @less.lightness(@less.rgb(@r, 0, 0)); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ r: '100' });
    expect(vars['--r-lightness']).toBe('19.607843137%');
  });

  it.each([
    '@less.fade(var(--x), @a)',
    '@less.hsva(var(--h), 50%, 50%, @a)',
    '@less.hsv(var(--h), 50%, @a)',
    '@less.darken(var(--x), @a)'
  ])('fails %s at its span, whose fixed argument the runtime cannot read', async (expression) => {
    const source = `@use "#less";\n@expose a;\n@a: 25%;\n.x { v: ${expression}; }`;
    await expect(new Compiler({}).renderString(source, { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/expose-not-a-value', line: 4, column: 9 });
  });

  it.each([
    ['currentcolor', 'rgb(from currentcolor r g b / 0.5)'],
    ['red', 'rgba(255, 0, 0, 0.5)'],
    ['#c00', 'rgba(204, 0, 0, 0.5)']
  ])('recomputes beside a fixed argument it can read: %s', async (color, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: 25%;\n.x { v: @less.fade(${color}, @a); }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ a: '50%' });
    expect(Object.values(vars)).toContain(printed);
  });

  it.each([
    ['@less.rgb(@a, 0, 0)', '2px', 'var(--a-rgb, rgb(2, 0, 0))'],
    ['@less.rgba(#c00, @a)', '2px', 'var(--a-rgba, rgb(204, 0, 0))'],
    ['@less.hsv(@a, 50%, 50%)', '50%', 'var(--a-hsv, #408080)']
  ])('keeps the recipe of %s when the export is %s, a unit CSS does not take there', async (expression, value, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: ${value};\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(Object.keys(exported.runtime!.derived)).toHaveLength(1);
  });

  it.each([
    '@less.rgb(var(--r), 1px, 0)',
    '@less.rgb(@a, 1px, 0)'
  ])('fails %s, whose fixed channel is a unit CSS does not take', async (expression) => {
    await expect(new Compiler({}).renderString(`@use "#less";\n@expose a;\n@a: 200;\n.x { v: ${expression}; }`, { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it.each([
    ['@a: 200;', '@less.rgb(@a, var(--x), 0)', 'rgb(var(--a, 200), var(--x), 0)'],
    ['@a: 200;', '@less.rgba(@a, 0, 0, var(--y))', 'rgba(var(--a, 200), 0, 0, var(--y))'],
    ['@a: var(--x);', '@less.rgb(@a, 0, 0)', 'rgb(var(--a, var(--x)), 0, 0)']
  ])('prints %s %s as the CSS it is', async (declaration, expression, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n${declaration}\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(exported.runtime!.derived).toEqual({});
  });

  it.each([
    ['@a: rgb(1, 2, 3); @b: #123;', '@less.mix(@a, @b)', { b: '#456' }],
    ['@a: 10; @b: rgb(1, 2, 3);', '@less.mix(@b, #000, @a)', { a: '5' }]
  ])('reads a known colour default as its hex: %s %s', async (declarations, expression, values) => {
    const exported = await compile(`@use "#less";\n@expose a, b;\n${declarations}\n.x { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(() => createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars(values)).not.toThrow();
  });

  it('fails a recipe reading a default the runtime cannot read, not the browser', async () => {
    const source = '@use "#less";\n@expose a, b;\n@a: var(--x);\n@b: #123;\n.x { v: @less.mix(@a, @b); }';
    await expect(new Compiler({}).renderString(source, { filePath: 'entry.less', extension: '.less' })).rejects.toThrow();
  });

  it.each([
    '@less.mix(@a, hsl(0, 50%, 50%))',
    '@less.mix(@a, hsl(0 50% 50%))',
    '@less.mix(@a, @less.rgb(1, 2, 3))',
    '@less.fade(hsl(120, 50%, 50%), 25%)',
    '@less.replace("a(b)", "b", @a)',
    '@less.extract("a(b)" c, 1)'
  ])('compiles %s beside a fixed argument the runtime can read', async (expression) => {
    await expect(compile(`@use "#less";\n@expose a;\n@a: #c00;\n.x { v: ${expression}; }`)).resolves.toBeDefined();
  });

  it('leaves nothing behind for a form over a form', async () => {
    const exported = await compile('@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.darken(@less.spin(@brand, 30), 10%); }');
    expect(exported.css).toContain('v: hsl(from hsl(from var(--brand, #c00) calc(h + 30) s l) h s clamp(0, l - 10, 100));');
    expect(exported.runtime!.derived).toEqual({});
    expect(exported.runtime!.defaults).toEqual({});
  });

  it('computes only what reads a given export', async () => {
    const exported = await compile('@use "#less";\n@expose a, b;\n@a: #c00;\n@b: #00c;\n.x { v: @less.lightness(@a); w: @less.lightness(@b); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ b: '#fff' })).toEqual({ '--b': '#fff', '--b-lightness': '100%' });
  });

  it('takes each value by its JavaScript key, the name with dash-case turned to camelCase', async () => {
    const exported = await compile('@use "#less";\n@expose brand-color;\n@brand-color: #c00;\n.a { v: @less.lightness(@brand-color); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const runtime = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived });
    expect(runtime.vars({ brandColor: '#000' })).toEqual({ '--brand-color': '#000', '--brand-color-lightness': '0%' });
    expect(() => runtime.vars({ 'brand-color': '#000' })).toThrow('no variable with the key brand-color');
  });

  it('rejects a value given as a function', () => {
    const runtime = createRuntime({ keys: { brand: 'brand' }, defaults: { brand: '#c00' }, derived: { '--brand-lightness': [less.lightness, [{ export: 'brand' }]] } });
    expect(() => runtime.vars({ brand: 'hsl(10, 50%, 50%)' })).toThrow('"hsl(10, 50%, 50%)" is a function');
  });

  it('sets the properties on the target it is given', async () => {
    const set: Record<string, string> = {};
    createRuntime({ keys: { brand: 'brand' }, defaults: { brand: '#c00' }, derived: { '--brand-lightness': [less.lightness, [{ export: 'brand' }]] } })
      .set({ brand: '#000' }, {
        style: {
          setProperty: (name, value) => {
            set[name] = value;
          }
        }
      });
    expect(set).toEqual({ '--brand': '#000', '--brand-lightness': '0%' });
  });
});
