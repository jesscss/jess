import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

const render = async (value: string, options: ConstructorParameters<typeof Compiler>[0] = {}): Promise<string> =>
  new Compiler(options).renderString(`.a { x: ${value}; }`, { filePath: 'entry.less', extension: '.less' });

/** The step of the exact form (V40): 1 at or below the switch point `t`, else 0; with a threshold, 1 below it. */
const Y = '(0.2126 * r + 0.7152 * g + 0.0722 * b)';
const step = (t: string): string => `min(1, sign(${t} - ${Y}) + 1)`;
const below = (t: string): string => `max(0, sign(${t} - ${Y}))`;
const blackWhite = (origin: string): string => `color(from ${origin} srgb-linear ${step('0.17912878475')} ${step('0.17912878475')} ${step('0.17912878475')} / 1)`;
const between = (origin: string, s: string, [r, g, b, a]: readonly (readonly [string, string])[]): string =>
  `color(from ${origin} srgb-linear calc(${r![0]} + ${r![1]} * ${s}) calc(${g![0]} + ${g![1]} * ${s}) calc(${b![0]} + ${b![1]} * ${s}) / calc(${a![0]} + ${a![1]} * ${s}))`;
const darkLight = [['0.005605391624', '0.8493872165'], ['0.005605391624', '0.8493872165'], ['0.005605391624', '0.8493872165'], ['1', '0']] as const;

describe('contrast() is its exact relative-colour form over an unknown colour (V40)', () => {
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
    ['contrast(currentcolor)', blackWhite('currentcolor')],
    ['contrast(mix(var(--a), red))', blackWhite('color-mix(in srgb, var(--a), red)')],
    ['contrast(var(--c), #111)', between('var(--c)', step('0.19163125047'), [['0.005605391624', '0.9943946084'], ['0.005605391624', '0.9943946084'], ['0.005605391624', '0.9943946084'], ['1', '0']])],
    ['contrast(var(--c), #eee, #111)', between('var(--c)', step('0.17432670013'), darkLight)],
    ['contrast(var(--c), #111, #eee, 50%)', between('var(--c)', below('0.5'), darkLight)],
    ['contrast(var(--c), rgba(1, 2, 3, .5), rgba(250, 251, 252, .25))', between('var(--c)', step('0.17637436724'), [['0.00030352698355', '0.9556698263'], ['0.0006070539671', '0.964079194'], ['0.0009105809506', '0.9725347094'], ['0.5', '-0.25']])]
  ])('writes the form of %s', async (call, css) => {
    expect(await render(call)).toContain(`x: ${css};`);
    expect(await render(call, { compile: { functionMode: 'error' } })).toContain(`x: ${css};`);
  });

  it.each([
    ['contrast(var(--c), rgba(0, 0, 0, .5), black)', 'contrast(#808080, rgba(0, 0, 0, .5), black)', 'black'],
    ['contrast(var(--c), transparent, black)', 'contrast(#fff, transparent, black)', 'black']
  ])('picks light for every colour where the pair has equal luma: %s', async (unknown, known, light) => {
    expect(await render(known)).toContain(`x: ${light};`);
    expect(await render(unknown)).toContain(`x: ${light};`);
  });

  it('writes the form compressed', async () => {
    expect(await render('contrast(var(--c), rgba(1, 2, 3, .5), #eee)', { output: { compress: true } }))
      .toContain('x:color(from var(--c) srgb-linear calc(.00030352698355 + .8546890811 * min(1,sign(.16391690753 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) + 1)) calc(.0006070539671 + .8543855542 * min(1,sign(.16391690753 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) + 1)) calc(.0009105809506 + .8540820272 * min(1,sign(.16391690753 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) + 1)) / calc(.5 + .5 * min(1,sign(.16391690753 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) + 1)))');
  });

  it.each(['contrast(30%)', 'contrast(1.5)', 'contrast(foo)', 'contrast(#999, 1)', 'contrast(#999, #111, #eee, foo)', 'contrast(#999, var(--d), #eee)'])('writes %s as it was', async (call) => {
    expect(await render(call)).toContain(`x: ${call};`);
  });

  it('rejects a bad argument under functionMode: error', async () => {
    await expect(render('contrast(1)', { compile: { functionMode: 'error' } })).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it('keeps the CSS filter function: a lone argument only the browser knows may be a number', async () => {
    const out = await new Compiler({}).renderString(
      '.a { filter: contrast(var(--amount)); backdrop-filter: blur(2px) contrast(var(--c)) brightness(1.2); color: contrast(var(--bg)); }',
      { filePath: 'entry.less', extension: '.less' }
    );
    expect(out).toContain('filter: contrast(var(--amount));');
    expect(out).toContain('backdrop-filter: blur(2px) contrast(var(--c)) brightness(1.2);');
    expect(out).toContain(`color: ${blackWhite('var(--bg)')};`);
    expect(await render('contrast(var(--amount))', { compile: { functionMode: 'error' } })).toContain(`x: ${blackWhite('var(--amount)')};`);
    expect(await render('contrast(calc(1 * var(--amount)))')).toContain('x: contrast(calc(1 * var(--amount)));');
    expect(await render('darken(contrast(var(--c)), 10%)')).toContain('x: hsl(from contrast(var(--c)) h s clamp(0, l - 10, 100));');
  });

  it('prints the form where the call says it is a colour', async () => {
    expect(await render('contrast(var(--c), #000, #fff)')).toContain(`x: ${between('var(--c)', step('0.17912878475'), [['0', '1'], ['0', '1'], ['0', '1'], ['1', '0']])};`);
    const imported = await new Compiler({}).renderString('@use "#less";\n.a { x: @less.contrast(var(--x)); }', { filePath: 'entry.less', extension: '.less' });
    expect(imported).toContain(`x: ${blackWhite('var(--x)')};`);
  });

  it('writes a threshold over a colour only the browser knows as the same form', async () => {
    const imported = await new Compiler({}).renderString('@use "#less";\n.a { x: @less.contrast(var(--c), #111, #eee, 50%); }', { filePath: 'entry.less', extension: '.less' });
    expect(imported).toContain(`x: ${between('var(--c)', below('0.5'), darkLight)};`);
  });
});
