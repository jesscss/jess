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

  it('fails a recipe beside a fixed colour call, where no form holds the weight', async () => {
    await expect(new Compiler({}).renderString('@use "#less";\n@expose a;\n@a: 150%;\n.x { v: @less.mix(rgba(1, 2, 3, .5), red, @a); }', { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/expose-not-a-value', line: 4, column: 9 });
  });

  it.each([
    ['@less.mix(red, blue, @brand)', '150%', '25%'],
    ['@less.mix(red, blue, @brand)', '25', '50%'],
    ['@less.tint(#777, @brand)', '-13%', '13%'],
    ['@less.contrast(@brand, #111, #eee, 50%)', '#999', '#222'],
    ['@less.contrast(#999, @brand, #eee)', '#111', '#222'],
    ['@less.lightness(@less.mix(@brand, red))', '#c00', '#08f']
  ])('runs %s of %s on the runtime, where no form holds it', async (expression, value, later) => {
    const exported = await compile(`@use "#less";\n@expose brand;\n@brand: ${value};\n.a { v: ${expression}; }`);
    const derived = Object.fromEntries(Object.entries(exported.runtime!.derived).map(([name, recipe]) => [name, toRuntime(recipe)]));
    const [property] = Object.keys(derived);
    const vars = createRuntime({ keys: exported.runtime!.keys, defaults: exported.runtime!.defaults, derived }).vars({ brand: later });
    const recompiled = await compile(`@use "#less";\n@brand: ${later};\n.a { v: ${expression}; }`);
    expect(recompiled.css).toContain(`v: ${vars[property!]};`);
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
    '@less.fade(rgb(1 2 3), @a)',
    '@less.fade(hsl(120, 50%, 50%), @a)',
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
