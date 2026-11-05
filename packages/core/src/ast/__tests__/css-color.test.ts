import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize, type SerializeReturn } from '../serialize.js';
import { defineFunction } from '../value-dispatch.js';
import { makeKeyword } from '../value-factory.js';
import { isValueGroupArray, type ValueGroup } from '../value-eval.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';

/*
 * An `hsl()` a built-in consumes is the colour its CSS definition
 * computes (docs/design/CSS-NATIVE-BUILTINS.md §2, §3.4, Q12). `srgb()` writes
 * the colour it received as its sRGB channels on 0–1; anything else as `-`.
 */
const registry = makeLessRegistry();
registry.register(defineFunction('srgb', {
  params: [{ name: 'value', type: 'any' }],
  body: (value: ValueGroup) => makeKeyword(isValueGroupArray(value) || value.type !== 'Color'
    ? '-'
    : `${value.rgb.map(c => (c / 255).toFixed(6)).join(' ')} / ${value.alpha}`)
}));
const evaluator = buildEvaluator(registry);
const css = (out: SerializeReturn): string | undefined => (out instanceof Promise ? undefined : out.css);
const value = (source: string): string | undefined =>
  css(serialize(parseLess(`.a { x: ${source}; }`), { evaluator }))?.match(/x: (.*);/)?.[1];

/*
 * Chrome 152's computed `color` for each, as `color(srgb r g b / a)`
 * (`getComputedStyle`; Chrome writes 6 significant digits). A grey origin's
 * hue reads as 0 (css-color-4 §4.4.1), so `calc(h + 120)` is green.
 */
const BROWSER: readonly (readonly [string, readonly number[]])[] = [
  ['hsl(from #336699 h s calc(l - 10))', [0.15, 0.3, 0.45, 1]],
  ['hsl(from #336699 calc(h + 30) s l)', [0.2, 0.2, 0.6, 1]],
  ['hsl(from #336699 h s l / 0.5)', [0.2, 0.4, 0.6, 0.5]],
  ['hsl(from #336699 h s l / calc(alpha / 2))', [0.2, 0.4, 0.6, 0.5]],
  ['hsl(from rebeccapurple h calc(s * 0.5) l)', [0.4, 0.3, 0.5, 1]],
  ['hsl(from #808080 calc(h + 120) calc(s + 50) l)', [0.252941, 0.75098, 0.252941, 1]],
  ['hsl(from transparent h s l)', [0, 0, 0, 0]],
  ['hsl(from rgba(51, 102, 153, 0.4) h s l)', [0.2, 0.4, 0.6, 0.4]],
  ['hsl(120deg 50% calc(50 - 10) / 50%)', [0.2, 0.6, 0.2, 0.5]],
  ['hsl(0.25turn 60 40)', [0.4, 0.64, 0.16, 1]],
  ['hsl(from hsl(from #336699 h s l) h s calc(l / 2))', [0.1, 0.2, 0.3, 1]],
  ['hsl(from red none s l)', [1, 0, 0, 1]],
  ['hsl(from red calc(h + 30) s l)', [1, 0.5, 0, 1]]
];

describe('an hsl() a built-in consumes', () => {
  it.each(BROWSER)('%s is the colour the browser computes', (source, expected) => {
    const channels = value(`srgb(${source})`)?.split(/ \/? ?/).map(Number);
    expect(channels).toHaveLength(4);
    channels!.forEach((channel, index) => expect(channel).toBeCloseTo(expected[index]!, 5));
  });

  it('stays a call when an input is not known', () => {
    expect(value('srgb(hsl(from var(--c) h s l))')).toBe('-');
    expect(value('srgb(hsl(from currentcolor h s l))')).toBe('-');
    expect(value('srgb(hsl(from #336699 h s calc(l + var(--d))))')).toBe('-');
  });

  it('leaves a colour outside the sRGB gamut to the browser', () => {
    expect(value('srgb(hsl(from #336699 h s calc(l + 80)))')).toBe('-');
  });

  it('stays a call when it is not CSS', () => {
    expect(value('srgb(hsl(from #336699 h s calc(l - 10%)))')).toBe('-');
    expect(value('srgb(hsl(from #336699 calc(h + 30deg) s l))')).toBe('-');
    expect(value('srgb(hsl(120 50% 40% 0.5))')).toBe('-');
    expect(value('srgb(hsl(from #336699 h s l alpha))')).toBe('-');
  });

  it('stays a call when its math fails bound', () => {
    expect(value('srgb(hsl(from #336699 h s calc(l / 0)))')).toBe('-');
    expect(value('darken(hsl(from #336699 h s calc(l / 0)), 5%)')).toBe('hsl(from hsl(from #336699 h s calc(l / 0)) h s clamp(0, l - 5, 100))');
  });

  it('feeds a built-in', () => {
    const channels = value('srgb(darken(hsl(from #336699 h s calc(l - 10)), 5%))')?.split(/ \/? ?/).map(Number);
    [0.125, 0.25, 0.375, 1].forEach((channel, index) => expect(channels?.[index]).toBeCloseTo(channel, 5));
    expect(value('darken(hsl(from var(--c) h s l), 5%)')).toBe('hsl(from hsl(from var(--c) h s l) h s clamp(0, l - 5, 100))');
    expect(value('iscolor(hsl(from #336699 h s l))')).toBe('true');
    expect(value('iscolor(hsl(from var(--c) h s l))')).toBe('false');
  });

  it('prints as written until an operation consumes it', () => {
    expect(value('hsl(from #336699 h s calc(l - 10))')).toBe('hsl(from #336699 h s calc(l - 10))');
    expect(value('hsl(120deg 50% calc(50 - 10) / 50%)')).toBe('hsl(120deg 50% calc(50 - 10) / 50%)');
    expect(css(serialize(parseLess('.m(@c) { m: @c; } .a { .m(hsl(from red h s calc(l - 10))); }'), { evaluator }))).toContain('m: hsl(from red h s calc(l - 10));');
    expect(value('darken(rgb(from hsl(from red h s l) r g b), 5%)')).toBe('hsl(from rgb(from hsl(from red h s l) r g b) h s clamp(0, l - 5, 100))');
  });
});

/*
 * What each built-in's CSS form computes: the built-in, its form, the colour,
 * measured in Chrome 152 (`getComputedStyle` and canvas bytes). Only Chrome was
 * measured.
 */
const FORMS: readonly (readonly [string, string, readonly number[]])[] = [
  ['darken(#336699, 10%)', 'hsl(from #336699 h s clamp(0, l - 10, 100))', [0.15, 0.3, 0.45, 1]],
  ['darken(#336699, 10%, relative)', 'hsl(from #336699 h s clamp(0, l - l * 10 / 100, 100))', [0.18, 0.36, 0.54, 1]],
  ['lighten(#336699, 10%)', 'hsl(from #336699 h s clamp(0, l + 10, 100))', [0.25, 0.5, 0.75, 1]],
  ['lighten(#336699, 10%, relative)', 'hsl(from #336699 h s clamp(0, l + l * 10 / 100, 100))', [0.22, 0.44, 0.66, 1]],
  ['saturate(#336699, 20%)', 'hsl(from #336699 h clamp(0, s + 20, 100) l)', [0.12, 0.4, 0.68, 1]],
  ['saturate(#336699, 20%, relative)', 'hsl(from #336699 h clamp(0, s + s * 20 / 100, 100) l)', [0.16, 0.4, 0.64, 1]],
  ['desaturate(#336699, 20%)', 'hsl(from #336699 h clamp(0, s - 20, 100) l)', [0.28, 0.4, 0.52, 1]],
  ['desaturate(#336699, 20%, relative)', 'hsl(from #336699 h clamp(0, s - s * 20 / 100, 100) l)', [0.24, 0.4, 0.56, 1]],
  ['spin(#336699, 30)', 'hsl(from #336699 calc(h + 30) s l)', [0.2, 0.2, 0.6, 1]],
  ['spin(#336699, -240)', 'hsl(from #336699 calc(h + -240) s l)', [0.6, 0.2, 0.4, 1]],
  ['greyscale(#336699)', 'hsl(from #336699 h 0 l)', [0.4, 0.4, 0.4, 1]],
  ['darken(#336699, 50%)', 'hsl(from #336699 h s clamp(0, l - 50, 100))', [0, 0, 0, 1]],
  ['lighten(#336699, 70%)', 'hsl(from #336699 h s clamp(0, l + 70, 100))', [1, 1, 1, 1]],
  ['lighten(rebeccapurple, 10%)', 'hsl(from rebeccapurple h s clamp(0, l + 10, 100))', [0.5, 0.25, 0.75, 1]],
  ['darken(rgba(51, 102, 153, 0.4), 10%)', 'hsl(from rgba(51, 102, 153, 0.4) h s clamp(0, l - 10, 100))', [0.15, 0.3, 0.45, 0.4]],
  ['saturate(desaturate(#33cc33, 100%), 50%)', 'hsl(from hsl(from #33cc33 h clamp(0, s - 100, 100) l) h clamp(0, s + 50, 100) l)', [0.25, 0.75, 0.25, 1]],
  ['saturate(greyscale(#33cc33), 50%)', 'hsl(from hsl(from #33cc33 h 0 l) h clamp(0, s + 50, 100) l)', [0.25, 0.75, 0.25, 1]],
  ['darken(lighten(#33cc33, 100%), 50%)', 'hsl(from hsl(from #33cc33 h s clamp(0, l + 100, 100)) h s clamp(0, l - 50, 100))', [0.2, 0.8, 0.2, 1]],
  ['lighten(darken(#33cc33, 100%), 50%)', 'hsl(from hsl(from #33cc33 h s clamp(0, l - 100, 100)) h s clamp(0, l + 50, 100))', [0.2, 0.8, 0.2, 1]],
  ['spin(spin(#33cc33, 30), 30)', 'hsl(from hsl(from #33cc33 calc(h + 30) s l) calc(h + 30) s l)', [0.2, 0.8, 0.8, 1]],
  ['saturate(#808080, 50%)', 'hsl(from #808080 h clamp(0, s + 50, 100) l)', [0.75098, 0.252941, 0.252941, 1]],
  ['spin(#ffffff, 10)', 'hsl(from #ffffff calc(h + 10) s l)', [1, 1, 1, 1]]
];

/* The bytes Chrome 152's canvas gives each form, where a channel lands on a half byte. */
const FORM_BYTES: readonly (readonly [string, string])[] = [
  ['saturate(#de626d, 10%)', '#e75965'],
  ['spin(#fe45e0, 318)', '#9b45fe'],
  ['saturate(desaturate(#33cc33, 100%), 50%)', '#40bf40'],
  ['saturate(greyscale(#33cc33), 50%)', '#40bf40'],
  ['darken(lighten(#33cc33, 100%), 50%)', '#33cc33'],
  ['lighten(darken(#33cc33, 100%), 50%)', '#33cc33'],
  ['spin(spin(#33cc33, 30), 30)', '#33cccc'],
  ['spin(#ffffff, 10)', '#ffffff']
];

describe('a built-in is its CSS form', () => {
  it.each(FORMS)('%s computes %s', (builtin, _form, expected) => {
    const channels = value(`srgb(${builtin})`)?.split(/ \/? ?/).map(Number);
    expect(channels).toHaveLength(4);
    channels!.forEach((channel, index) => expect(channel).toBeCloseTo(expected[index]!, 5));
  });

  it.each(FORMS.filter(([builtin]) => /^\w+\(#336699/.test(builtin)))('%s prints that form over an input only the browser knows', (builtin, form) => {
    expect(value(builtin.replace('#336699', 'var(--c)'))).toBe(form.replace('#336699', 'var(--c)'));
  });

  it('keeps the input\'s format, in legacy syntax (Q14 open)', () => {
    expect(value('darken(#336699, 10%)')).toBe('#264c73');
    expect(value('darken(hsl(210, 50%, 40%), 10%)')).toBe('hsl(210, 50%, 30%)');
    expect(value('darken(rgb(51, 102, 153), 10%)')).toBe('rgb(38, 76, 115)');
    expect(value('darken(hsl(210 50% 40%), 10%)')).toBe('hsl(210, 50%, 30%)');
    expect(value('darken(hsl(210 50% 40% / 50%), 10%)')).toBe('hsla(210, 50%, 30%, 0.5)');
    expect(value('darken(hsl(120 50% 40%), 5%)')).toBe('hsl(120, 50%, 35%)');
  });

  it.each(FORM_BYTES)('%s is the byte Chrome draws, %s', (builtin, bytes) => {
    expect(value(builtin)).toBe(bytes);
  });

  it('reads an hsl() origin by its own h, s and l, and any other through sRGB (Q9)', () => {
    expect(value('hue(desaturate(#33cc33, 100%))')).toBe('120');
    expect(value('saturate(hsl(120, 0%, 50%), 20%)')).toBe('hsl(120, 20%, 50%)');
    expect(value('saturate(hsl(120 0% 50%), 20%)')).toBe('hsl(120, 20%, 50%)');
    expect(value('saturate(hsl(from hsl(120 0% 50%) h calc(s + 50) l), 0%)')).toBe('hsl(120, 50%, 50%)');
    expect(value('saturate(#808080, 20%)')).toBe('#996767');
    expect(css(serialize(parseLess('@a: hsl(120, 0%, 50%); .a { m: fade(@a, 50%); }'), { evaluator }))).toContain('m: rgba(128, 128, 128, 0.5);');
  });

  it('prints an authored grey, black or white as written', () => {
    const printed = (color: string, compress: boolean): string | undefined =>
      css(serialize(parseLess(`.m(@c) { x: @c; } .a { .m(${color}); }`), { evaluator, compress }))?.match(/x: ?([^;}]*)/)?.[1];
    expect(printed('hsl(120, 0%, 50%)', false)).toBe('hsl(120, 0%, 50%)');
    expect(printed('hsl(120, 50%, 100%)', false)).toBe('hsl(120, 50%, 100%)');
    expect(printed('hsl(120, 50%, 0%)', false)).toBe('hsl(120, 50%, 0%)');
    expect(printed('hsl(0.25turn, 0%, 50%)', false)).toBe('hsl(0.25turn, 0%, 50%)');
    expect(printed('hsl(120, 0%, 50%)', true)).toBe('hsl(120,0%,50%)');
    expect(printed('hsla(120, 0%, 50%, 0.5)', true)).toBe('hsla(120,0%,50%,.5)');
  });

  it('keeps white white, and black black', () => {
    expect(value('lighten(hsl(341, 36%, 97%), 25%)')).toBe('hsl(341, 36%, 100%)');
    expect(value('darken(lighten(hsl(193, 82%, 67%), 150%), 10%)')).toBe('hsl(193, 82%, 90%)');
    expect(value('darken(hsl(193, 82%, 3%), 10%)')).toBe('hsl(193, 82%, 0%)');
  });

  it('reads a known origin by the channels it prints: clamped sRGB, as Chrome 152 does', () => {
    expect(value('spin(#fff + #111, 10)')).toBe('#ffffff');
    expect(value('darken(#7249ff + #111, 25%)')).toBe(value('darken(#835aff, 25%)'));
    expect(value('darken(rgb(300, 0, 0), 10%)')).toBe('rgb(204, 0, 0)');
    expect(value('saturate(rgb(300, 0, 0), 10%)')).toBe('rgb(255, 0, 0)');
    expect(value('darken(rgb(120%, 0%, 0%), 10%)')).toBe('rgb(204, 0, 0)');
  });

  it('computes a comma hsl() a consumer demands, as it does a space-separated one', () => {
    expect(value('saturate(hsl(120, 0%, 50%), 20%)')).toBe('hsl(120, 20%, 50%)');
    expect(value('darken(hsla(120, 50%, 40%, 0.5), 10%)')).toBe('hsla(120, 50%, 30%, 0.5)');
    expect(value('srgb(hsl(0.25turn, 60%, 40%))')).toBe(value('srgb(hsl(0.25turn 60 40))'));
    expect(value('srgb(hsl(var(--h), 60%, 40%))')).toBe('-');
  });

  it('reads a channel above 100 as Chrome 152 does: comma clamps it, space-separated keeps it', () => {
    expect(value('desaturate(hsl(120, 150%, 50%), 20%)')).toBe('hsl(120, 80%, 50%)');
    expect(value('desaturate(hsl(120 150% 50%), 20%)')).toBe('hsl(120, 100%, 50%)');
    expect(value('desaturate(hsl(120 -10% 50%), 0%)')).toBe('hsl(120, 0%, 50%)');
  });

  it('leaves a call written out when only the browser knows its method', () => {
    for (const name of ['darken', 'lighten', 'saturate', 'desaturate']) {
      expect(value(`${name}(var(--c), 10%, var(--m))`)).toBe(`${name}(var(--c), 10%, var(--m))`);
    }
  });

  it('prints a form\'s amount as a compressed number', () => {
    const compressed = (source: string): string | undefined => css(serialize(parseLess(`.a { x: ${source}; }`), { evaluator, compress: true }))?.match(/x:(.*)}/)?.[1];
    expect(compressed('lighten(var(--x), 0.5%)')).toBe('hsl(from var(--x) h s clamp(0,l + .5,100))');
    expect(compressed('spin(var(--x), -0.5)')).toBe('hsl(from var(--x) calc(h + -.5) s l)');
  });

  it('reads the call inside a paren group, and keeps the parens around a written-out form (J16, V38)', () => {
    expect(value('lighten((var(--x)), 5%)')).toBe('hsl(from var(--x) h s clamp(0, l + 5, 100))');
    expect(value('lighten(((var(--x))), 5%)')).toBe('hsl(from var(--x) h s clamp(0, l + 5, 100))');
    expect(value('lighten((foo(1)), 5%)')).toBe('hsl(from foo(1) h s clamp(0, l + 5, 100))');
    expect(value('lighten((darken(var(--x), 1%)), 5%)')).toBe('hsl(from hsl(from var(--x) h s clamp(0, l - 1, 100)) h s clamp(0, l + 5, 100))');
    expect(value('(darken(var(--x), 1%))')).toBe('(hsl(from var(--x) h s clamp(0, l - 1, 100)))');
    expect(value('iskeyword((var(--x)))')).toBe('true');
    expect(css(serialize(parseLess('.m(@c) { x: lighten(@c, 5%); } .a { .m((var(--x))); }'), { evaluator }))).toContain('x: hsl(from var(--x) h s clamp(0, l + 5, 100));');
  });

  it('is a colour and no keyword', () => {
    expect(value('iscolor(darken(var(--x), 10%))')).toBe('true');
    expect(value('iskeyword(darken(var(--x), 10%))')).toBe('false');
    expect(value('iskeyword(hsl(from var(--c) h s l))')).toBe('true');
    const out = css(serialize(parseLess('.m(@c) when (iskeyword(@c)) { k: 1; } .m(@c) when (iscolor(@c)) { c: 1; } .a { .m(darken(var(--x), 10%)); }'), { evaluator }));
    expect(out).toContain('c: 1;');
    expect(out).not.toContain('k: 1;');
  });

  it('takes any input not known to be something else (§3.6, Q6)', () => {
    expect(value('darken(foo(1), 10%)')).toBe('hsl(from foo(1) h s clamp(0, l - 10, 100))');
    expect(value('darken(currentcolor, 10%)')).toBe('hsl(from currentcolor h s clamp(0, l - 10, 100))');
    expect(value('darken(color-mix(in srgb, var(--a), red), 10%)')).toBe('hsl(from color-mix(in srgb, var(--a), red) h s clamp(0, l - 10, 100))');
    expect(value('darken(10px, 10%)')).toBe('darken(10px, 10%)');
    expect(value('darken(solid, 10%)')).toBe('darken(solid, 10%)');
  });

  it('leaves an amount only the browser knows to be computed by a later form', () => {
    expect(value('darken(#336699, var(--a))')).toBe('darken(#336699, var(--a))');
    expect(value('darken(var(--c), var(--a))')).toBe('darken(var(--c), var(--a))');
  });

  it('nests', () => {
    expect(value('lighten(darken(var(--c), 10%), 5%)')).toBe('hsl(from hsl(from var(--c) h s clamp(0, l - 10, 100)) h s clamp(0, l + 5, 100))');
    expect(value('color-mix(in srgb, darken(var(--c), 10%), red)')).toBe('color-mix(in srgb, hsl(from var(--c) h s clamp(0, l - 10, 100)), red)');
  });

  it('is a colour to a type test, where a bare var() is not (Q10)', () => {
    expect(value('iscolor(darken(var(--c), 10%))')).toBe('true');
    expect(value('iscolor(var(--c))')).toBe('false');
  });

  it('leaves rgb() and hsl() over a var() as written (§3.8)', () => {
    expect(value('rgb(var(--r), 20, 30)')).toBe('rgb(var(--r), 20, 30)');
    expect(value('hsl(var(--h), 20%, 30%)')).toBe('hsl(var(--h), 20%, 30%)');
    expect(value('rgba(var(--c), 0.5)')).toBe('rgba(var(--c), 0.5)');
  });

  it('computes clamp() in a channel', () => {
    expect(value('srgb(hsl(from #336699 h s clamp(0, l - 10, 100)))')).toBe('0.150000 0.300000 0.450000 / 1');
    expect(value('hsl(from #336699 h s clamp(0, l - 10, 100))')).toBe('hsl(from #336699 h s clamp(0, l - 10, 100))');
  });

  it('writes compressed', () => {
    const compressed = css(serialize(parseLess('.a { x: darken(var(--c), 10%); y: darken(#336699, 10%); }'), { evaluator, compress: true }));
    expect(compressed).toBe('.a{x:hsl(from var(--c) h s clamp(0,l - 10,100));y:#264c73}');
  });
});
