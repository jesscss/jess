import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

const render = async (value: string, options: ConstructorParameters<typeof Compiler>[0] = {}): Promise<string> =>
  new Compiler(options).renderString(`.a { x: ${value}; }`, { filePath: 'entry.less', extension: '.less' });

describe('mix, tint, shade and average are color-mix(in srgb)', () => {
  it.each([
    ['mix(red, rgba(0, 0, 255, .5), 25%)', 'rgba(102, 0, 153, 0.625)'],
    ['tint(#ff000080, 13%)', '#ff3a3a91'],
    ['tint(rgba(255, 0, 0, .5), 13%)', 'rgba(255, 59, 59, 0.565)'],
    ['tint(hsla(90, 100%, 50%, .5), 13%)', 'hsla(90, 100%, 61.50442478%, 0.565)'],
    ['average(#ff000080, #0000ff80)', '#80008080'],
    ['average(#f00, rgba(0, 0, 255, .5))', '#aa0055bf'],
    ['average(transparent, red)', '#ff000080']
  ])('weighs each colour by its opacity: %s', async (call, css) => {
    expect(await render(call)).toContain(`x: ${css};`);
  });

  it.each([
    ['mix(#f00, #00f)', '#800080'],
    ['mix(#ff000080, #0000ff80)', 'rgba(128, 0, 128, 0.5019607843)'],
    ['tint(transparent, 50%)', '#ffffff80'],
    ['shade(transparent, 50%)', '#00000080'],
    ['mix(transparent, red)', 'rgba(255, 0, 0, 0.5)'],
    ['mix(#777, #fff, 25px)', '#dddddd'],
    ['mix(#777, #fff, .5)', '#fefefe'],
    ['tint(#777, 13)', '#898989'],
    ['tint(#777)', '#bbbbbb'],
    ['shade(#777)', '#3c3c3c'],
    ['mix(#000, #fff, 150%)', '#000000'],
    ['mix(#000, #fff, -50%)', '#ffffff'],
    ['mix(rgb(1, 2, 3), blue)', 'rgb(1, 1, 129)'],
    ['tint(hsl(120 50% 40%), 13%)', 'hsl(120, 36.40167364%, 47.8%)'],
    ['mix(red, blue, (10% + 5%))', '#2600d9'],
    ['tint(#777, calc(10%))', '#858585']
  ])('keeps %s as it was where the colours count alike', async (call, css) => {
    expect(await render(call)).toContain(`x: ${css};`);
  });

  it.each(['mix(foo, red)', 'mix(red)', 'mix(red, 1)', 'mix(1, red)', 'mix(red, blue, foo)', 'mix(red, blue, 1, 2)', 'average(red)', 'tint(foo)', 'tint(red, foo)'])('leaves %s as written, whose argument it cannot read', async (call) => {
    expect(await render(call)).toContain(`x: ${call};`);
  });

  it('rejects them under functionMode: error, but a form or a consumed color-mix() is no error', async () => {
    await expect(render('mix(1, red)', { compile: { functionMode: 'error' } })).rejects.toMatchObject({ code: 'eval/invalid-function' });
    expect(await render('mix(var(--a), red)', { compile: { functionMode: 'error' } })).toContain('x: color-mix(in srgb, var(--a), red);');
    expect(await render('lightness(color-mix(in srgb, red, blue))', { compile: { functionMode: 'error' } })).toContain('x: 25%;');
    expect(await render('color-mix(in srgb, red, blue)', { compile: { functionMode: 'error' } })).toContain('x: color-mix(in srgb, red, blue);');
  });

  it.each([
    ['mix(var(--a), red, 25%)', 'color-mix(in srgb,var(--a) 25%,red)'],
    ['tint(var(--c), 0.50%)', 'color-mix(in srgb,white .5%,var(--c))'],
    ['tint(var(--c), -13%)', 'rgb(from var(--c) clamp(0,(r * alpha * 1.13 + -33.15) / (alpha * 1.13 + -.13),255) clamp(0,(g * alpha * 1.13 + -33.15) / (alpha * 1.13 + -.13),255) clamp(0,(b * alpha * 1.13 + -33.15) / (alpha * 1.13 + -.13),255) / calc(alpha * 1.13 + -.13))'],
    ['mix(red, blue, 25%)', '#4000bf']
  ])('writes %s compressed', async (call, css) => {
    expect(await render(call, { output: { compress: true } })).toContain(`x:${css}`);
  });

  it('reads a color-mix() through a variable and a mixin argument, and prints it as written', async () => {
    const out = await new Compiler({}).renderString('@c: color-mix(in srgb, red, blue); .m(@a) { y: darken(@a, 10%); z: @a; } .a { x: darken(@c, 10%); w: @c; .m(color-mix(in srgb, red, blue)); }', { filePath: 'entry.less', extension: '.less' });
    expect(out).toContain('x: rgb(77, 0, 76);');
    expect(out).toContain('w: color-mix(in srgb, red, blue);');
    expect(out).toContain('y: rgb(77, 0, 76);');
    expect(out).toContain('z: color-mix(in srgb, red, blue);');
  });
});
