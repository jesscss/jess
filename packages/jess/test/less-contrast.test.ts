import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

const render = async (value: string, options: ConstructorParameters<typeof Compiler>[0] = {}): Promise<string> =>
  new Compiler(options).renderString(`.a { x: ${value}; }`, { filePath: 'entry.less', extension: '.less' });

describe('contrast() is contrast-color()', () => {
  it.each([
    ['contrast(#999)', '#000000'],
    ['contrast(red)', '#000000'],
    ['contrast(#767676)', '#000000'],
    ['contrast(#757575)', '#ffffff'],
    ['contrast(transparent)', '#ffffff'],
    ['contrast(#999, #111, #eee)', '#111'],
    ['contrast(#999, #eee, #111)', '#111'],
    ['contrast(#999, #ccc, #fff)', '#fff'],
    ['contrast(hsl(0, 0%, 60%))', 'hsl(0, 0%, 0%)'],
    ['contrast(rgba(153, 153, 153, .5))', 'rgb(0, 0, 0)'],
    ['contrast(color-mix(in srgb, red, blue))', 'rgb(255, 255, 255)']
  ])('picks by the larger contrast ratio: %s', async (call, css) => {
    expect(await render(call)).toContain(`x: ${css};`);
  });

  it.each([
    ['contrast(#999, #111, #eee, 43%)', '#eee'],
    ['contrast(#999, #111, #eee, 0.43)', '#eee'],
    ['contrast(#999, #111, #eee, 30%)', '#111'],
    ['contrast(#fff, #eee, #111, 0.5)', '#111']
  ])('keeps the luma rule with a threshold: %s', async (call, css) => {
    expect(await render(call)).toContain(`x: ${css};`);
  });

  it.each([
    ['contrast(var(--c))', 'contrast-color(var(--c))'],
    ['contrast(currentcolor)', 'contrast-color(currentcolor)'],
    ['contrast(mix(var(--a), red))', 'contrast-color(color-mix(in srgb, var(--a), red))'],
    ['darken(contrast(var(--c)), 10%)', 'hsl(from contrast-color(var(--c)) h s clamp(0, l - 10, 100))'],
    ['contrast(var(--c), #111)', 'rgb(from contrast-color(var(--c)) calc(17 + 238 * r / 255) calc(17 + 238 * r / 255) calc(17 + 238 * r / 255) / calc(1 + 0 * r / 255))'],
    ['contrast(var(--c), #eee, #111)', 'rgb(from contrast-color(var(--c)) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) / calc(1 + 0 * r / 255))'],
    ['contrast(var(--c), rgba(1, 2, 3, .5), rgba(250, 251, 252, .25))', 'rgb(from contrast-color(var(--c)) calc(1 + 249 * r / 255) calc(2 + 249 * r / 255) calc(3 + 249 * r / 255) / calc(0.5 + -0.25 * r / 255))']
  ])('writes the form of %s', async (call, css) => {
    expect(await render(call)).toContain(`x: ${css};`);
    expect(await render(call, { compile: { functionMode: 'error' } })).toContain(`x: ${css};`);
  });

  it('writes the form compressed', async () => {
    expect(await render('contrast(var(--c), rgba(1, 2, 3, .5), #eee)', { output: { compress: true } }))
      .toContain('x:rgb(from contrast-color(var(--c)) calc(1 + 237 * r / 255) calc(2 + 236 * r / 255) calc(3 + 235 * r / 255) / calc(.5 + .5 * r / 255))');
  });

  it.each(['contrast(30%)', 'contrast(foo)', 'contrast(#999, 1)', 'contrast(#999, #111, #eee, foo)', 'contrast(#999, var(--d), #eee)', 'contrast(var(--c), #111, #eee, 50%)'])('writes %s as it was', async (call) => {
    expect(await render(call)).toContain(`x: ${call};`);
  });

  it('rejects a bad argument under functionMode: error', async () => {
    await expect(render('contrast(1)', { compile: { functionMode: 'error' } })).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });
});
