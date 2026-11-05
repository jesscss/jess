import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function compileWithPartial(partial: string, a = '#c00') {
  const dir = mkdtempSync(join(tmpdir(), 'jess-export-partial-'));
  try {
    writeFileSync(join(dir, 'one.less'), partial);
    return await new Compiler({}).renderToResult({ filePath: join(dir, 'entry.less'), source: `@expose a, b;\n@a: ${a};\n@b: #00c;\n@import "./one.less";`, language: 'less' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function compile(source: string) {
  return new Compiler({}).renderToResult({ filePath: 'entry.less', source, language: 'less' });
}

describe('the export runtime', () => {
  it.each([
    'mix(@a, @b, 150%)',
    'mix(@a, var(--z), 150%)',
    'mix(var(--y), @a, 150%)',
    'contrast(@a, #111, #eee, 50%)'
  ])('does not print a built-in with no form, unimported in a classic partial: %s', async (call) => {
    expect((await compileWithPartial(`.a { color: ${call}; }`)).errors).toMatchObject([{ code: 'eval/expose-not-a-value', reason: expect.stringContaining('@a is exposed') }]);
  });

  it.each([
    ['filter: contrast(@a)', 'filter: contrast(var(--a, var(--x)));'],
    ['backdrop-filter: blur(2px) contrast(@a) brightness(1.2)', 'backdrop-filter: blur(2px) contrast(var(--a, var(--x))) brightness(1.2);']
  ])('keeps the filter function over an exposed value only the browser knows, unimported in a classic partial: %s', async (declaration, expected) => {
    expect((await compileWithPartial(`.a { ${declaration}; }`, 'var(--x)')).css).toContain(expected);
  });

  it('says why a call failed over an export inside an argument', async () => {
    await expect(compile('@use "#less";\n@expose a;\n@a: #c00;\n.a { x: @less.mix(foo(@a), bar(1), 150%); }').then(result => result.errors?.[0]?.reason))
      .resolves.toContain('no CSS form holds a weight of 150%');
  });

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
    ['@less.fade(@less.rgb(@brand, 0, 0), 50%)', '10', 'rgb(from rgb(var(--brand, 10), 0, 0) r g b / 0.5)'],
    ['@less.mix(@brand, red)', '#c00', 'color-mix(in srgb, var(--brand, #c00), red)'],
    ['@less.mix(@brand, red, 25%)', '#c00', 'color-mix(in srgb, var(--brand, #c00) 25%, red)'],
    ['@less.mix(red, @brand, 25%)', '#c00', 'color-mix(in srgb, red 25%, var(--brand, #c00))'],
    ['@less.mix(red, blue, @brand)', '25%', 'color-mix(in srgb, red var(--brand, 25%), blue)'],
    ['@less.average(@brand, red)', '#c00', 'color-mix(in srgb, var(--brand, #c00), red)'],
    ['@less.contrast(@brand)', '#c00', 'contrast-color(var(--brand, #c00))'],
    ['@less.contrast(@brand, #111, #eee)', '#c00', 'rgb(from contrast-color(var(--brand, #c00)) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) / calc(1 + 0 * r / 255))'],
    ['@less.tint(@brand, 13%)', '#c00', 'color-mix(in srgb, white 13%, var(--brand, #c00))'],
    ['@less.tint(red, @brand)', '13%', 'color-mix(in srgb, white var(--brand, 13%), red)'],
    ['@less.shade(@brand)', '#c00', 'color-mix(in srgb, black 50%, var(--brand, #c00))'],
    ['@less.tint(@brand, -13%)', '#c00', 'rgb(from var(--brand, #c00) clamp(0, (r * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) clamp(0, (g * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) clamp(0, (b * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) / calc(alpha * 1.13 + -0.13))'],
    ['@less.darken(color-mix(in srgb, @brand, red), 10%)', '#c00', 'hsl(from color-mix(in srgb, var(--brand, #c00), red) h s clamp(0, l - 10, 100))']
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

  it.each([
    ['@less.mix(red, blue, @brand)', '150%', '25%'],
    ['@less.mix(red, blue, @brand)', '25', '50%'],
    ['@less.tint(#777, @brand)', '-13%', '13%'],
    ['@less.contrast(@brand, #111, #eee, 50%)', '#999', '#222'],
    ['@less.contrast(#999, @brand, #eee)', '#111', '#222'],
    ['@less.mix(red, blue, (@brand))', '150%', '25%'],
    ['@less.tint(red, (@brand))', '13', '25%'],
    ['@less.tint(red, (@brand))', '13px', '25%'],
    ['@less.rgb((@brand), 0, 0)', '2px', '10'],
    ['@less.lightness(@less.mix(@brand, red))', '#c00', '#08f']
  ])('runs %s of %s on the runtime, where no form holds it', async (expression, value, later) => {
    const exported = await compile(`@use "#less";\n@expose brand;\n@brand: ${value};\n.a { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const [property] = Object.keys(derived);
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ brand: later });
    const recompiled = await compile(`@use "#less";\n@brand: ${later};\n.a { v: ${expression}; }`);
    expect(recompiled.css).toContain(`v: ${vars[property!]};`);
  });

  it.each([
    ['@less.mix((@a), (@b), 150%)', '@a: #c00;\n@b: #08f;'],
    ['@less.mix(@a, red, (@b))', '@a: #c00;\n@b: 150%;']
  ])('runs %s on the runtime, as it does with no parens', async (expression, declarations) => {
    const exported = await compile(`@use "#less";\n@expose a, b;\n${declarations}\n.a { v: ${expression}; }`);
    expect(Object.keys(exported.runtime!.derived)).toEqual(['--a-mix']);
    expect(exported.css).toContain('v: var(--a-mix, ');
  });

  it('fails @less.contrast((@a)) of a number, as it does with no parens', async () => {
    await expect(new Compiler({}).renderString('@use "#less";\n@expose a;\n@a: 1.5;\n.x { v: @less.contrast((@a)); }', { filePath: 'entry.less', extension: '.less' })).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it('prints an exposed variable in parens as it prints one without', async () => {
    const exported = await compile('@use "#less";\n@expose r;\n@r: 10;\n.a { v: @less.rgb((@r), 0, 0); }');
    expect(exported.css).toContain('v: rgb(var(--r, 10), 0, 0);');
  });

  it.each([
    ['@less.contrast(rgb(@o 0 0), #111, #eee, 50%)', '200'],
    ['@less.mix(color-mix(in srgb, @o, red), var(--b), 150%)', '#c00'],
    ['@less.lightness(rgb(@o 0 0))', '200'],
    ['@less.multiply(rgb(@o 0 0), red)', '200']
  ])('names the exposed variable when %s fails', async (expression, value) => {
    await expect(new Compiler({}).renderString(`@use "#less";\n@expose o;\n@o: ${value};\n.a { v: ${expression}; }`, { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/expose-not-a-value', reason: expect.stringContaining('@o is exposed') });
  });

  it('prints a form over a colour call that reads an exposed variable', async () => {
    const exported = await compile('@use "#less";\n@expose o;\n@o: 200;\n.a { v: @less.darken(rgb(@o 0 0), 10%); }');
    expect(exported.css).toContain('v: hsl(from rgb(var(--o, 200) 0 0) h s clamp(0, l - 10, 100));');
  });

  it('runs a mix of two exports on the runtime beyond 100%, as no form holds it', async () => {
    const exported = await compile('@use "#less";\n@expose a, b;\n@a: #336699;\n@b: red;\n.a { v: @less.mix(@a, @b, 150%); }');
    expect(exported.css).toContain('v: var(--a-mix, #0099e6);');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ a: '#000', b: '#fff' })['--a-mix']).toBe('#000000');
  });

  it('runs rgb() as a recipe inside a function with no CSS form', async () => {
    const exported = await compile('@use "#less";\n@expose r;\n@r: 200;\n.a { v: @less.lightness(@less.rgb(@r, 0, 0)); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ r: '100' });
    expect(vars['--r-lightness']).toBe('19.607843137%');
  });

  it.each([
    '@less.fade(var(--x), @a)',
    '@less.fade(hsl(120, 50%, 50%), @a)',
    '@less.hsva(var(--h), 50%, 50%, @a)',
    '@less.hsv(var(--h), 50%, @a)',
    '@less.spin(var(--x), @a)'
  ])('compiles %s, and says what the runtime cannot read if it is set', async (expression) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: 25%;\n.x { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(() => createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ a: '50%' })).toThrow('The runtime computes from CSS literals');
  });

  it('needs no recipe where the form holds the export', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: 25%;\n.x { v: @less.darken(var(--x), @a); }');
    expect(exported.css).toContain('hsl(from var(--x) h s clamp(0, l - var(--a, 25%) / 1%, 100))');
    expect(exported.runtime!.derived).toEqual({});
  });

  it.each(['rgba(1, 2, 3, .5)', 'rgb(1 2 3)'])('compiles a mix of %s beside a weight no form holds, and says what the runtime cannot read if it is set', async (color) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: 150%;\n.x { v: @less.mix(${color}, red, @a); }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(() => createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ a: '50%' })).toThrow('The runtime computes from CSS literals');
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
    ['@a: var(--z);', '@less.iscolor(@a)', { a: '#c00' }, 'true'],
    ['@a: 0 1px 2px rgba(0, 0, 0, .5);', '@less.extract(@a, 4)', { a: '0 1px 2px #000' }, '#000'],
    ['@a: var(--p), var(--q);', '@less.length(@a)', { a: '1, 2, 3' }, '3']
  ])('runs a recipe of one export whose default holds a call: %s %s', async (declaration, expression, values, result) => {
    const exported = await compile(`@use "#less";\n@expose a;\n${declaration}\n.x { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars(values);
    expect(Object.values(vars)).toContain(result);
  });

  it('recomputes a string with parens as a compile does', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: c;\n.x { v: @less.replace("a(b)", "b", @a); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ a: 'z' });
    expect(Object.values(vars)).toContain('"a(z)"');
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
