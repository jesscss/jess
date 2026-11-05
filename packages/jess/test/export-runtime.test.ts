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
    ['@less.fade(@brand, 50%)', '#123456'],
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
