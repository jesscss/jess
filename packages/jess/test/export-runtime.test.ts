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
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ brand: value });
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
    ['@less.mix(red, blue, @brand)', '25%', 'rgb(from red clamp(0, (r * alpha * var(--brand, 0.25) + 0 * (1 - var(--brand, 0.25))) / (alpha * var(--brand, 0.25) + 1 * (1 - var(--brand, 0.25))), 255) clamp(0, (g * alpha * var(--brand, 0.25) + 0 * (1 - var(--brand, 0.25))) / (alpha * var(--brand, 0.25) + 1 * (1 - var(--brand, 0.25))), 255) clamp(0, (b * alpha * var(--brand, 0.25) + 255 * (1 - var(--brand, 0.25))) / (alpha * var(--brand, 0.25) + 1 * (1 - var(--brand, 0.25))), 255) / calc(alpha * var(--brand, 0.25) + 1 * (1 - var(--brand, 0.25))))'],
    ['@less.average(@brand, red)', '#c00', 'color-mix(in srgb, var(--brand, #c00), red)'],
    ['@less.contrast(@brand)', '#c00', 'contrast-color(var(--brand, #c00))'],
    ['@less.contrast(@brand, #111, #eee)', '#c00', 'rgb(from contrast-color(var(--brand, #c00)) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) / calc(1 + 0 * r / 255))'],
    ['@less.tint(@brand, 13%)', '#c00', 'color-mix(in srgb, white 13%, var(--brand, #c00))'],
    ['@less.tint(red, @brand)', '13%', 'rgb(from red clamp(0, (r * alpha * (1 - var(--brand, 0.13)) + 255 * var(--brand, 0.13)) / (alpha * (1 - var(--brand, 0.13)) + 1 * var(--brand, 0.13)), 255) clamp(0, (g * alpha * (1 - var(--brand, 0.13)) + 255 * var(--brand, 0.13)) / (alpha * (1 - var(--brand, 0.13)) + 1 * var(--brand, 0.13)), 255) clamp(0, (b * alpha * (1 - var(--brand, 0.13)) + 255 * var(--brand, 0.13)) / (alpha * (1 - var(--brand, 0.13)) + 1 * var(--brand, 0.13)), 255) / calc(alpha * (1 - var(--brand, 0.13)) + 1 * var(--brand, 0.13)))'],
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
    ['@less.contrast(@brand, #111, #eee, 50%)', '#999', '#222'],
    ['@less.contrast(#999, @brand, #eee)', '#111', '#222'],
    ['@less.lightness(@less.mix(@brand, red))', '#c00', '#08f']
  ])('runs %s of %s on the runtime, where no form holds it', async (expression, value, later) => {
    const exported = await compile(`@use "#less";\n@expose brand;\n@brand: ${value};\n.a { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const [property] = Object.keys(derived);
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ brand: later });
    const recompiled = await compile(`@use "#less";\n@brand: ${later};\n.a { v: ${expression}; }`);
    expect(recompiled.css).toContain(`v: ${vars[property!]};`);
  });

  it('runs @less.mix((@a), (@b), 150%) on the runtime, as it does with no parens', async () => {
    const exported = await compile('@use "#less";\n@expose a, b;\n@a: #c00;\n@b: #08f;\n.a { v: @less.mix((@a), (@b), 150%); }');
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
    expect(createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ a: '#000', b: '#fff' })['--a-mix']).toBe('#000000');
  });

  it('runs rgb() as a recipe inside a function with no CSS form', async () => {
    const exported = await compile('@use "#less";\n@expose r;\n@r: 200;\n.a { v: @less.lightness(@less.rgb(@r, 0, 0)); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ r: '100' });
    expect(vars['--r-lightness']).toBe('19.607843137%');
  });

  it.each([
    '@less.mix(var(--x), @a, 150%)',
    '@less.contrast(var(--x), @a)',
    '@less.contrast(rgb(1 2 3), @a)',
    '@less.contrast(rgba(1, 2, 3, .5), @a)'
  ])('compiles %s beside what it cannot read, and says so if the export is set', async (expression) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: #c00;\n.x { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(() => createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ a: '#333' })).toThrow('The runtime computes from CSS literals');
  });

  it('holds a percentage as its ratio, which every read multiplies back', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: 25%;\n.x { v: @less.fade(#333, @a); w: @a; }');
    expect(exported.css).toContain('v: rgb(from #333 r g b / calc(var(--a, 0.25) * 100%));');
    expect(exported.css).toContain('w: calc(var(--a, 0.25) * 100%);');
    expect(exported.runtime!.derived).toEqual({});
    const runtime = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived: {} });
    expect(runtime.vars({ a: '50%' })).toEqual({ '--a': '0.5' });
    expect(runtime.vars({ a: '33.3%' })).toEqual({ '--a': '0.333' });
    expect(() => runtime.vars({ a: '.5' })).toThrow('a is read by a CSS form in %');
  });

  /*
   * Each printed form is what was measured in Chrome 156.0.8078.75 (getComputedStyle),
   * with `--a` set to the ratio and with the fallback alone; both gave the value in
   * the last column, which is what a compile of the percentage writes.
   */
  it.each([
    ['50%', '@a', 'calc(var(--a, 0.5) * 100%)', 'height 100px in a 200px box and width 200px in a 400px box, as 50%; 0px in a box of no height, as 50%'],
    ['50%', '@less.hsl(120, @a, 50%)', 'hsl(120, calc(var(--a, 0.5) * 100%), 50%)', 'rgb(64, 191, 64), as hsl(120, 50%, 50%)'],
    ['50%', '@less.unit(@a, px)', 'calc(var(--a, 0.5) * 100 * 1px)', '50px on height in a box of no height'],
    ['50%', '@less.unit(@a)', 'calc(var(--a, 0.5) * 100 * 1)', '50 on z-index'],
    ['5%', '@less.unit((@a * 2), px)', 'calc(var(--a, 0.05) * 100 * 2 * 1px)', '10px on height in a box of no height'],
    ['50%', '@less.sqrt(@a)', 'calc(sqrt(var(--a, 0.5) * 100) * 1%)', '28.2812px on width in a 400px box, as 7.0710678%'],
    ['25%', '@less.fade(#333, @a)', 'rgb(from #333 r g b / calc(var(--a, 0.25) * 100%))', 'alpha 0.25'],
    ['10%', '@less.darken(#c00, @a)', 'hsl(from #c00 h s clamp(0, l - var(--a, 0.1) * 100, 100))', 'rgb(153, 0, 0), as hsl(0, 100%, 30%)'],
    ['50%', '@less.hsv(120, @a, 75%)', 'hwb(120 calc((1 - var(--a, 0.5) * 100% / 100%) * 75%) 25%)', 'rgb(96, 191, 96), as hwb(120 37.5% 25%)']
  ])('prints @a: %s in %s as the CSS measured in Chrome', async (value, expression, printed, _measured) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: ${value};\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(exported.runtime!.units).toEqual({ a: '%' });
  });

  it('holds a percentage read only as written as its ratio too, whatever reads it first', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: 50%;\n.x { w: @a; }\n.y { v: @less.unit(@a, px); }');
    expect(exported.css).toContain('w: calc(var(--a, 0.5) * 100%);');
    expect(exported.css).toContain('v: calc(var(--a, 0.5) * 100 * 1px);');
    expect(exported.runtime!.units).toEqual({ a: '%' });
  });

  it('needs no recipe where the form holds the export', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: 25%;\n.x { v: @less.darken(var(--x), @a); }');
    expect(exported.css).toContain('hsl(from var(--x) h s clamp(0, l - var(--a, 0.25) * 100, 100))');
    expect(exported.runtime!.derived).toEqual({});
  });

  it.each([
    ['@expose gap;\n@gap: 2px;', '@less.min(var(--max), @gap)', 'min(var(--max), var(--gap, 2px))', { gap: '4px' }],
    ['@expose a;\n@a: 2px;', '@less.max(@a, var(--x))', 'max(var(--a, 2px), var(--x))', { a: '4px' }],
    ['@expose a, b;\n@a: 1px;\n@b: 2px;', '@less.min(@a, @b)', 'min(var(--a, 1px), var(--b, 2px))', { a: '4px' }],
    ['@expose a;\n@a: 2;', '@less.pow(var(--x), @a)', 'pow(var(--x), var(--a, 2))', { a: '3' }],
    ['@expose a, b;\n@a: var(--y);\n@b: 2;', '@less.pow(@a, @b)', 'pow(var(--a, var(--y)), var(--b, 2))', { b: '3' }],
    ['@expose a;\n@a: 16;', '@less.sqrt(@a)', 'sqrt(var(--a, 16))', { a: '25' }],
    ['@expose a;\n@a: 16;', '@less.sqrt((@a * 2))', 'sqrt((var(--a, 16) * 2))', { a: '25' }],
    ['@expose a;\n@a: .5;', '@less.asin(@a)', 'asin(var(--a, 0.5))', { a: '1' }],
    ['@expose a;\n@a: .5;', '@less.acos(@a)', 'acos(var(--a, 0.5))', { a: '1' }],
    ['@expose a;\n@a: .5;', '@less.atan(@a)', 'atan(var(--a, 0.5))', { a: '1' }],
    ['@expose a;\n@a: 30deg;', '@less.sin(@a)', 'sin(var(--a, 30deg))', { a: '60deg' }],
    ['@expose a;\n@a: 1;', '@less.cos(@a)', 'cos(var(--a, 1))', { a: '2' }],
    ['@expose a;\n@a: .5turn;', '@less.tan(@a)', 'tan(var(--a, 0.5turn))', { a: '0.25turn' }],
    ['@expose a;\n@a: -2px;', '@less.abs(@a)', 'abs(var(--a, -2px))', { a: '-3px' }]
  ])('needs no recipe where the CSS function holds the export: %s %s', async (declared, expression, printed, values) => {
    const exported = await compile(`@use "#less";\n${declared}\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(exported.runtime!.derived).toEqual({});
    expect(() => createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived: {} }).vars(values)).not.toThrow();
  });

  it.each([
    ['@a: 5px;', '@less.unit(@a, em)', '2em', 'px'],
    ['@a: 1rad;', '@less.spin(#333, @a)', '57deg', 'rad'],
    ['@a: .5;', '@less.fade(#333, @a)', '50%', 'a number']
  ])('refuses a unit a CSS form would read differently: %s %s set to %s', async (declared, expression, set, unit) => {
    const exported = await compile(`@use "#less";\n@expose a;\n${declared}\n.x { v: ${expression}; }`);
    expect(exported.runtime!.derived).toEqual({});
    const runtime = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived: {} });
    expect(() => runtime.vars({ a: set })).toThrow(`a is read by a CSS form in ${unit}`);
    expect(() => runtime.vars({ a: '3' + (unit === 'a number' ? '' : unit) })).not.toThrow();
  });

  it('takes any unit for an export only read as written or by a recipe', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: 5px;\n.x { v: @a; w: @less.sin(@a); }');
    expect(exported.runtime!.units).toEqual({});
    expect(() => createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived: {} }).vars({ a: '2em' })).not.toThrow();
  });

  it('recomputes @less.sin(@a) where the CSS function does not take a length', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: 0px;\n.x { v: @less.sin(@a); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(Object.values(createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ a: '0px' }))).toContain('0');
  });

  it.each([
    ['16px', '@less.sin((@a * 2))']
  ])('has no value for @a: %s in %s', async (value, expression) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: ${value};\n.x { v: ${expression}; }`);
    expect(exported.errors?.[0]?.code).toBe('eval/expose-not-a-value');
  });

  it.each([
    ['red', '.5', '#eee'],
    ['#c00', '.5', '#eee']
  ])('recomputes beside a fixed argument it can read: %s', async (color, set, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: 1%;\n.x { v: @less.contrast(${color}, #111, #eee, @a); }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    expect(Object.values(createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ a: set }))).toContain(printed);
  });

  it.each([
    ['@less.hsl(@a)', '#c00', 'var(--a-hsl, hsl(0, 100%, 40%))'],
    ['@less.hsl(@a, 50%)', '#c00', 'var(--a-hsl, hsla(0, 100%, 40%, 0.5))'],
    ['@less.hsl(#333, @a)', '5%', 'var(--a-hsl, hsla(0, 0%, 20%, 0.05))']
  ])('keeps the recipe of %s when the export is %s, which no form reads there', async (expression, value, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: ${value};\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(Object.keys(exported.runtime!.derived)).toHaveLength(1);
  });

  it.each([
    ['50%', '@less.sqrt(@a)', 'calc(sqrt(var(--a, 0.5) * 100) * 1%)'],
    ['50%', '@less.pow(@a, 2)', 'calc(pow(var(--a, 0.5) * 100, 2) * 1%)'],
    ['50%', '@less.percentage(@a)', 'calc(var(--a, 0.5) * 100 * 100%)'],
    ['50%', '@less.unit(@a, px)', 'calc(var(--a, 0.5) * 100 * 1px)'],
    ['50%', '@less.unit(@a)', 'calc(var(--a, 0.5) * 100 * 1)'],
    ['50%', '@less.unit((@a * 2), px)', 'calc(var(--a, 0.5) * 100 * 2 * 1px)'],
    ['50%', '@less.unit(-@a, px)', 'calc(-1 * var(--a, 0.5) * 100 * 1px)'],
    ['2%', '@less.mod(5px, @a)', 'rem(5px, var(--a, 0.02) * 100 * 1px)'],
    ['50%', '@less.mod(5px, (@a * 2))', 'rem(5px, var(--a, 0.5) * 100 * 2 * 1px)'],
    ['50%', '@less.pow(2, @a)', 'pow(2, var(--a, 0.5) * 100)'],
    ['50%', '@less.mod(3, @a)', 'rem(3, var(--a, 0.5) * 100)']
  ])('keeps the form over a percentage held as its ratio: @a: %s in %s', async (value, expression, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: ${value};\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(exported.runtime!.derived).toEqual({});
    expect(exported.runtime!.units).toEqual({ a: '%' });
  });

  it.each([
    ['@less.rgb(var(--r), 1px, 0)', 'rgb(var(--r), 1, 0)'],
    ['@less.rgb(@a, 1px, 0)', 'rgb(var(--a, 200), 1, 0)']
  ])('writes the number of a fixed channel in a unit CSS does not take: %s', async (expression, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: 200;\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
  });

  it.each([
    ['.5', '@less.fade(#333, @a)', 'rgb(from #333 r g b / calc(var(--a, 0.5) / 100))'],
    ['.5', '@less.fade(#333, @a * 2)', 'rgb(from #333 r g b / calc(var(--a, 0.5) * 2 / 100))'],
    ['.5', '@less.fade(#333, calc(@a * 2))', 'rgb(from #333 r g b / calc(var(--a, 0.5) * 2 / 100))'],
    ['.25', '@less.fade(var(--x), @a)', 'rgb(from var(--x) r g b / calc(var(--a, 0.25) / 100))'],
    ['.25', '@less.fadeout(var(--x), @a)', 'rgb(from var(--x) r g b / calc(alpha - var(--a, 0.25) / 100))'],
    ['.1', '@less.fadein(#333, @a)', 'rgb(from #333 r g b / calc(alpha + var(--a, 0.1) / 100))'],
    ['2px', '@less.rgba(#c00, @a)', 'rgb(from #c00 r g b / calc(var(--a, 2px) / 1px))'],
    ['10', '@less.darken(#c00, @a)', 'hsl(from #c00 h s clamp(0, l - var(--a, 10), 100))'],
    ['10px', '@less.darken(#c00, @a)', 'hsl(from #c00 h s clamp(0, l - var(--a, 10px) / 1px, 100))'],
    ['5', '@less.darken(#c00, @a * 2)', 'hsl(from #c00 h s clamp(0, l - var(--a, 5) * 2, 100))'],
    ['25%', '@less.spin(var(--x), @a)', 'hsl(from var(--x) calc(h + var(--a, 0.25) * 100) s l)'],
    ['2px', '@less.rgb((@a), 0, 0)', 'rgb(calc(var(--a, 2px) / 1px), 0, 0)'],
    ['.5', '@less.hsl(120, @a, 50%)', 'hsl(120, calc(var(--a, 0.5) * 100%), 50%)'],
    ['.5', '@less.hsv(120, @a, 75%)', 'hwb(120 calc((1 - var(--a, 0.5) * 100% / 100%) * 75%) 25%)'],
    ['.25', '@less.hsv(var(--h), 50%, @a)', 'hwb(var(--h) calc(0.5 * var(--a, 0.25) * 100%) calc(100% - var(--a, 0.25) * 100%))'],
    ['50%', '@less.hsv(@a, 50%, 50%)', 'hwb(calc(var(--a, 0.5) * 100 * 3.6) 25% 50%)'],
    ['16px', '@less.sqrt(@a)', 'calc(sqrt(var(--a, 16px) / 1px) * 1px)'],
    ['16px', '@less.sqrt(-@a)', 'calc(sqrt(-1 * var(--a, 16px) / 1px) * 1px)'],
    ['16px', '@less.sqrt((@a * 2))', 'calc(sqrt((var(--a, 16px) * 2) / 1px) * 1px)'],
    ['4px', '@less.pow(@a, 2)', 'calc(pow(var(--a, 4px) / 1px, 2) * 1px)'],
    ['16px', '@less.pow(var(--x), @a)', 'pow(var(--x), var(--a, 16px) / 1px)'],
    ['16px', '@less.ceil((@a * 2))', 'round(up, (var(--a, 16px) * 2), 1px)'],
    ['5', '@less.min(@a, 1px)', 'min(var(--a, 5) * 1px, 1px)']
  ])('converts @a: %s in %s to what that slot means, with no recipe', async (value, expression, printed) => {
    const exported = await compile(`@use "#less";\n@expose a;\n@a: ${value};\n.x { v: ${expression}; }`);
    expect(exported.css).toContain(`v: ${printed};`);
    expect(exported.runtime!.derived).toEqual({});
  });

  it.each([
    ['@a: 200;', '@less.rgb(@a, var(--x), 0)', 'rgb(var(--a, 200), var(--x), 0)'],
    ['@a: 200;', '@less.rgba(@a, 0, 0, var(--y))', 'rgba(var(--a, 200), 0, 0, var(--y))'],
    ['@a: var(--x);', '@less.rgb(@a, 0, 0)', 'rgb(var(--a, var(--x)), 0, 0)'],
    ['@a: 120;', '@less.hsl(@a, 50%, 50%)', 'hsl(var(--a, 120), 50%, 50%)'],
    ['@a: 120deg;', '@less.hsl(@a, 50%, 50%)', 'hsl(var(--a, 120deg), 50%, 50%)'],
    ['@a: 50%;', '@less.hsl(120, @a, 50%)', 'hsl(120, calc(var(--a, 0.5) * 100%), 50%)'],
    ['@a: .5;', '@less.hsla(var(--h), 50%, 50%, @a)', 'hsla(var(--h), 50%, 50%, var(--a, 0.5))'],
    ['@a: 25%;', '@less.fade(#333, @a)', 'rgb(from #333 r g b / calc(var(--a, 0.25) * 100%))'],
    ['@a: 25%;', '@less.fade(var(--x), @a)', 'rgb(from var(--x) r g b / calc(var(--a, 0.25) * 100%))'],
    ['@a: .5;', '@less.rgba(currentcolor, @a)', 'rgb(from currentcolor r g b / var(--a, 0.5))'],
    ['@a: 10%;', '@less.fadein(#333, @a)', 'rgb(from #333 r g b / calc(alpha + var(--a, 0.1)))'],
    ['@a: 10%;', '@less.fadeout(var(--x), @a)', 'rgb(from var(--x) r g b / calc(alpha - var(--a, 0.1)))'],
    ['@a: 50%;', '@less.hsv(120, @a, 75%)', 'hwb(120 calc((1 - var(--a, 0.5) * 100% / 100%) * 75%) 25%)'],
    ['@a: 25%;', '@less.hsv(var(--h), 50%, @a)', 'hwb(var(--h) calc(0.5 * var(--a, 0.25) * 100%) calc(100% - var(--a, 0.25) * 100%))'],
    ['@a: .5;', '@less.hsva(120, 50%, 75%, @a)', 'hwb(120 37.5% 25% / var(--a, 0.5))']
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
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars(values);
    expect(Object.values(vars)).toContain(result);
  });

  it('recomputes a string with parens as a compile does', async () => {
    const exported = await compile('@use "#less";\n@expose a;\n@a: c;\n.x { v: @less.replace("a(b)", "b", @a); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ a: 'z' });
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
    expect(createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived }).vars({ b: '#fff' })).toEqual({ '--b': '#fff', '--b-lightness': '100%' });
  });

  it('takes each value by its JavaScript key, the name with dash-case turned to camelCase', async () => {
    const exported = await compile('@use "#less";\n@expose brand-color;\n@brand-color: #c00;\n.a { v: @less.lightness(@brand-color); }');
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const runtime = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, units: exported.runtime!.units, derived });
    expect(runtime.vars({ brandColor: '#000' })).toEqual({ '--brand-color': '#000', '--brand-color-lightness': '0%' });
    expect(() => runtime.vars({ 'brand-color': '#000' })).toThrow('no variable with the key brand-color');
  });

  it('rejects a value given as a function', () => {
    const runtime = createRuntime({ keys: { brand: 'brand' }, defaults: { brand: '#c00' }, units: {}, derived: { '--brand-lightness': [less.lightness, [{ export: 'brand' }]] } });
    expect(() => runtime.vars({ brand: 'hsl(10, 50%, 50%)' })).toThrow('"hsl(10, 50%, 50%)" is a function');
  });

  it('sets the properties on the target it is given', async () => {
    const set: Record<string, string> = {};
    createRuntime({ keys: { brand: 'brand' }, defaults: { brand: '#c00' }, units: {}, derived: { '--brand-lightness': [less.lightness, [{ export: 'brand' }]] } })
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
