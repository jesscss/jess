import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize, type SerializeReturn } from '../serialize.js';
import { defineFunction } from '../value-dispatch.js';
import { makeDimension, makeKeyword } from '../value-factory.js';
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
    expect(value('darken(rgb(from hsl(from red h s l) r g b), 5%)')).toBe('rgb(230, 0, 0)');
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
  ['spin(#ffffff, 10)', 'hsl(from #ffffff calc(h + 10) s l)', [1, 1, 1, 1]],
  ['fade(#336699, 50%)', 'rgb(from #336699 r g b / 0.5)', [0.2, 0.4, 0.6, 0.5]],
  ['fade(#336699, 150%)', 'rgb(from #336699 r g b / 1.5)', [0.2, 0.4, 0.6, 1]],
  ['fade(#336699, -10%)', 'rgb(from #336699 r g b / -0.1)', [0.2, 0.4, 0.6, 0]],
  ['fadein(#336699, 10%)', 'rgb(from #336699 r g b / calc(alpha + 0.1))', [0.2, 0.4, 0.6, 1]],
  ['fadeout(#336699, 10%)', 'rgb(from #336699 r g b / calc(alpha - 0.1))', [0.2, 0.4, 0.6, 0.9]],
  ['fadeout(#336699, 150%)', 'rgb(from #336699 r g b / calc(alpha - 1.5))', [0.2, 0.4, 0.6, 0]],
  ['fadein(#336699, 10%, relative)', 'rgb(from #336699 r g b / calc(alpha + alpha * 0.1))', [0.2, 0.4, 0.6, 1]],
  ['fadeout(#336699, 10%, relative)', 'rgb(from #336699 r g b / calc(alpha - alpha * 0.1))', [0.2, 0.4, 0.6, 0.9]],
  ['fadein(rgba(51, 102, 153, 0.4), 10%)', 'rgb(from rgba(51, 102, 153, 0.4) r g b / calc(alpha + 0.1))', [0.2, 0.4, 0.6, 0.5]],
  ['fadeout(rgba(51, 102, 153, 0.4), 10%)', 'rgb(from rgba(51, 102, 153, 0.4) r g b / calc(alpha - 0.1))', [0.2, 0.4, 0.6, 0.3]],
  ['fadein(rgba(51, 102, 153, 0.4), 50%, relative)', 'rgb(from rgba(51, 102, 153, 0.4) r g b / calc(alpha + alpha * 0.5))', [0.2, 0.4, 0.6, 0.6]],
  ['fadeout(rgba(51, 102, 153, 0.4), 50%, relative)', 'rgb(from rgba(51, 102, 153, 0.4) r g b / calc(alpha - alpha * 0.5))', [0.2, 0.4, 0.6, 0.2]],
  ['fadein(fadeout(#336699, 150%), 20%)', 'rgb(from rgb(from #336699 r g b / calc(alpha - 1.5)) r g b / calc(alpha + 0.2))', [0.2, 0.4, 0.6, 0.2]],
  ['fade(hsl(210 50% 40%), 50%)', 'rgb(from hsl(210 50% 40%) r g b / 0.5)', [0.2, 0.4, 0.6, 0.5]],
  ['fade(rgb(10 20 30), 50%)', 'rgb(from rgb(10 20 30) r g b / 0.5)', [0.039216, 0.078431, 0.117647, 0.5]],
  ['fade(rgb(10, 20, 30), 50%)', 'rgb(from rgb(10, 20, 30) r g b / 0.5)', [0.039216, 0.078431, 0.117647, 0.5]],
  ['fade(rgb(300 0 0), 50%)', 'rgb(from rgb(300 0 0) r g b / 0.5)', [1, 0, 0, 0.5]],
  ['fade(red, 50%)', 'rgb(from red r g b / 0.5)', [1, 0, 0, 0.5]],
  ['rgba(#336699, 0.5)', 'rgb(from #336699 r g b / 0.5)', [0.2, 0.4, 0.6, 0.5]],
  ['rgba(#336699, 50%)', 'rgb(from #336699 r g b / 0.5)', [0.2, 0.4, 0.6, 0.5]],
  ['darken(rgb(10 20 30), 5%)', 'hsl(from rgb(10 20 30) h s clamp(0, l - 5, 100))', [0.014216, 0.028431, 0.042647, 1]],
  ['darken(rgb(from #336699 calc(r + 10) g b), 0%)', 'hsl(from rgb(from #336699 calc(r + 10) g b) h s clamp(0, l - 0, 100))', [0.239216, 0.4, 0.6, 1]],
  ['mix(#336699, red)', 'color-mix(in srgb, #336699, red)', [0.6, 0.2, 0.3, 1]],
  ['mix(#336699, red, 25%)', 'color-mix(in srgb, #336699 25%, red)', [0.8, 0.1, 0.15, 1]],
  ['mix(#336699, red, 25px)', 'color-mix(in srgb, #336699 25%, red)', [0.8, 0.1, 0.15, 1]],
  ['mix(#336699, rgba(0, 0, 255, 0.6), 25%)', 'color-mix(in srgb, #336699 25%, rgba(0, 0, 255, 0.6))', [0.0714286, 0.142857, 0.857143, 0.7]],
  ['average(#336699, red)', 'color-mix(in srgb, #336699, red)', [0.6, 0.2, 0.3, 1]],
  ['tint(#336699, 13%)', 'color-mix(in srgb, white 13%, #336699)', [0.304, 0.478, 0.652, 1]],
  ['shade(#336699, 13%)', 'color-mix(in srgb, black 13%, #336699)', [0.174, 0.348, 0.522, 1]],
  ['tint(#336699, -13%)', 'rgb(from #336699 clamp(0, (r * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) clamp(0, (g * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) clamp(0, (b * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) / calc(alpha * 1.13 + -0.13))', [0.096, 0.322, 0.548, 1]],
  ['shade(#336699, -13%)', 'rgb(from #336699 clamp(0, (r * alpha * 1.13 + 0) / (alpha * 1.13 + -0.13), 255) clamp(0, (g * alpha * 1.13 + 0) / (alpha * 1.13 + -0.13), 255) clamp(0, (b * alpha * 1.13 + 0) / (alpha * 1.13 + -0.13), 255) / calc(alpha * 1.13 + -0.13))', [0.226, 0.452, 0.678, 1]],
  ['tint(#336699, 113%)', 'rgb(from #336699 clamp(0, (r * alpha * -0.13 + 288.15) / (alpha * -0.13 + 1.13), 255) clamp(0, (g * alpha * -0.13 + 288.15) / (alpha * -0.13 + 1.13), 255) clamp(0, (b * alpha * -0.13 + 288.15) / (alpha * -0.13 + 1.13), 255) / calc(alpha * -0.13 + 1.13))', [1, 1, 1, 1]],
  ['tint(rgba(51, 102, 153, 0.6), -13%)', 'rgb(from rgba(51, 102, 153, 0.6) clamp(0, (r * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) clamp(0, (g * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) clamp(0, (b * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) / calc(alpha * 1.13 + -0.13))', [0.010219, 0.257664, 0.505109, 0.548]],
  ['mix(#336699, red, 150%)', 'rgb(from #336699 clamp(0, (r * alpha * 1.5 + -127.5) / (alpha * 1.5 + -0.5), 255) clamp(0, (g * alpha * 1.5 + 0) / (alpha * 1.5 + -0.5), 255) clamp(0, (b * alpha * 1.5 + 0) / (alpha * 1.5 + -0.5), 255) / calc(alpha * 1.5 + -0.5))', [0, 0.6, 0.9, 1]],
  ['mix(red, #336699, 150%)', 'rgb(from #336699 clamp(0, (r * alpha * -0.5 + 382.5) / (alpha * -0.5 + 1.5), 255) clamp(0, (g * alpha * -0.5 + 0) / (alpha * -0.5 + 1.5), 255) clamp(0, (b * alpha * -0.5 + 0) / (alpha * -0.5 + 1.5), 255) / calc(alpha * -0.5 + 1.5))', [1, 0, 0, 1]],
  ['darken(color-mix(in srgb, #336699 30%, red 30%), 0%)', 'hsl(from color-mix(in srgb, #336699 30%, red 30%) h s clamp(0, l - 0, 100))', [0.6, 0.2, 0.3, 0.6]],
  ['darken(color-mix(in srgb, #336699 80%, red 80%), 0%)', 'hsl(from color-mix(in srgb, #336699 80%, red 80%) h s clamp(0, l - 0, 100))', [0.6, 0.2, 0.3, 1]]
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
  ['spin(#ffffff, 10)', '#ffffff'],
  ['hsv(90, 50%, 50%)', '#608040'],
  ['hsv(210, 25%, 75%)', '#8fa7bf'],
  ['hsv(0, 80%, 50%)', '#801a1a'],
  ['hsv(90, 150%, 50%)', '#408000'],
  ['hsv(90, 50%, 150%)', '#dfffbf'],
  ['hsv(90, -50%, 50%)', '#999999'],
  ['hsv(0.25turn, 50%, 50%)', '#608040'],
  ['hsv(0.25TURN, 50%, 50%)', '#608040'],
  ['hsv(100GRAD, 50%, 50%)', '#608040'],
  ['hsva(90, 50%, 50%, 0.5)', 'rgba(96, 128, 64, 0.5)'],
  ['hsva(90, 50%, 50%, 50%)', 'rgba(96, 128, 64, 0.5)'],
  ['hsva(90, 50%, 50%, 1)', 'rgb(96, 128, 64)'],
  ['tint(#777777, 13%)', '#898989'],
  ['tint(#777777, -13%)', '#656565'],
  ['shade(#777777, 13%)', '#686868'],
  ['shade(#777777, -13%)', '#868686'],
  ['mix(red, rgba(0, 0, 255, 0.5), 25%)', 'rgba(102, 0, 153, 0.625)'],
  ['mix(red, hsl(120, 0%, 50%))', '#bf4040'],
  ['mix(black, hsl(120, 50%, 40%))', '#1a4d1a'],
  ['mix(rgba(255, 0, 0, 0), rgba(0, 0, 255, 0))', 'rgba(0, 0, 0, 0)']
];

describe('a built-in is its CSS form', () => {
  it.each(FORMS)('%s computes %s', (builtin, _form, expected) => {
    const channels = value(`srgb(${builtin})`)?.split(/ \/? ?/).map(Number);
    expect(channels).toHaveLength(4);
    channels!.forEach((channel, index) => expect(channel).toBeCloseTo(expected[index]!, 5));
  });

  it.each(FORMS.filter(([builtin]) => /^(?!rgba)\w+\(#336699/.test(builtin)))('%s prints that form over an input only the browser knows', (builtin, form) => {
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

  it('prints the relative form over the colour not known, whichever it is, and leaves two unknown as written beyond 100%', () => {
    expect(value('mix(red, var(--c), 150%)')).toBe('rgb(from var(--c) clamp(0, (r * alpha * -0.5 + 382.5) / (alpha * -0.5 + 1.5), 255) clamp(0, (g * alpha * -0.5 + 0) / (alpha * -0.5 + 1.5), 255) clamp(0, (b * alpha * -0.5 + 0) / (alpha * -0.5 + 1.5), 255) / calc(alpha * -0.5 + 1.5))');
    expect(value('mix(var(--a), var(--b), 25%)')).toBe('color-mix(in srgb, var(--a) 25%, var(--b))');
    expect(value('mix(var(--a), var(--b), 150%)')).toBe('mix(var(--a), var(--b), 150%)');
    expect(value('tint(var(--c), var(--w))')).toBe('color-mix(in srgb, white var(--w), var(--c))');
    expect(value('tint(#777777, var(--w))')).toBe('color-mix(in srgb, white var(--w), #777777)');
    expect(value('tint(var(--c))')).toBe('color-mix(in srgb, white 50%, var(--c))');
    expect(value('darken(mix(var(--a), red), 10%)')).toBe('hsl(from color-mix(in srgb, var(--a), red) h s clamp(0, l - 10, 100))');
  });

  it.each([
    'color-mix(in srgb, #336699 0%, red 0%)',
    'color-mix(in srgb, #336699 -5%, red)',
    'color-mix(in srgb, #336699 105%, red)',
    'color-mix(in srgb, #336699 25, red)',
    'color-mix(in oklab, #336699, red)',
    'color-mix(in srgb, var(--a), red)',
    'color-mix(in srgb, currentcolor, red)',
    'color-mix(#336699, red)',
    'color-mix(in srgb, #336699)'
  ])('leaves %s to the browser, known or not, when a consumer reads it', (call) => {
    expect(value(`darken(${call}, 10%)`)).toBe(`hsl(from ${call} h s clamp(0, l - 10, 100))`);
  });

  it.each([
    ['color-mix(in srgb, red, blue)', 'rgb(77, 0, 76)'],
    ['color-mix(in sRGB, red, blue)', 'rgb(77, 0, 76)'],
    ['COLOR-MIX(IN SRGB, red, blue)', 'rgb(77, 0, 76)'],
    ['color-mix(in srgb, 25% red, blue)', 'rgb(47, 0, 140)'],
    ['color-mix(in srgb, blue, 25% red)', 'rgb(47, 0, 140)'],
    ['color-mix(in srgb, red calc(10% + 5%), blue)', 'rgb(29, 0, 166)'],
    ['color-mix(in srgb, color-mix(in srgb, red, blue), green)', 'rgb(38, 38, 38)'],
    ['color-mix(in srgb, transparent, blue)', 'rgba(0, 0, 204, 0.5)']
  ])('computes %s for a consumer in every spelling', (call, darkened) => {
    expect(value(`darken(${call}, 10%)`)).toBe(darkened);
    expect(value(call)).toBe(call);
  });

  it('reads color-mix() as a relative colour\'s origin only for a consumer', () => {
    expect(value('rgb(from color-mix(in srgb, red, blue) r g b / 0.5)')).toBe('rgb(from color-mix(in srgb, red, blue) r g b / 0.5)');
    expect(value('darken(rgb(from color-mix(in srgb, red, blue) r g b / .5), 5%)')).toBe('rgba(102, 0, 102, 0.5)');
    expect(value('lightness(color-mix(in srgb, red, blue))')).toBe('25%');
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

  it('clamps a comma channel outside 0–100, and leaves a space-separated one to the browser', () => {
    expect(value('desaturate(hsl(120, 150%, 50%), 20%)')).toBe('hsl(120, 80%, 50%)');
    expect(value('desaturate(hsl(120 150% 50%), 20%)')).toBe('hsl(from hsl(120 150% 50%) h clamp(0, s - 20, 100) l)');
    expect(value('desaturate(hsl(120 -10% 50%), 0%)')).toBe('hsl(from hsl(120 -10% 50%) h clamp(0, s - 0, 100) l)');
    expect(value('darken(hsl(120 200% 75%), 10%)')).toBe('hsl(from hsl(120 200% 75%) h s clamp(0, l - 10, 100))');
  });

  it('evaluates a comma hsl()\'s computed arguments once', () => {
    let calls = 0;
    const counting = makeLessRegistry();
    counting.register(defineFunction('next-hue', { params: [], body: () => makeDimension(++calls * 100) }));
    const out = css(serialize(parseLess('.a { x: hue(hsl(next-hue(), calc(10% + 10%), 50%)); }'), { evaluator: buildEvaluator(counting) }));
    expect(out).toContain('x: 100;');
    expect(calls).toBe(1);
  });

  it('reads a hue unit in any case', () => {
    const printed = (color: string): string | undefined =>
      css(serialize(parseLess(`.m(@c) { x: @c; } .a { .m(${color}); }`), { evaluator }))?.match(/x: ?([^;}]*)/)?.[1];
    expect(printed('hsl(0.25TURN, 50%, 50%)')).toBe('hsl(0.25TURN, 50%, 50%)');
    expect(printed('hsl(100GRAD, 50%, 50%)')).toBe('hsl(100GRAD, 50%, 50%)');
    expect(printed('hsl(1RAD, 50%, 50%)')).toBe('hsl(1RAD, 50%, 50%)');
    expect(value('hue(hsl(0.25TURN, 50%, 50%))')).toBe('90');
  });

  it('leaves a call written out when only the browser knows its method', () => {
    for (const name of ['darken', 'lighten', 'saturate', 'desaturate', 'fadein', 'fadeout']) {
      expect(value(`${name}(var(--c), 10%, var(--m))`)).toBe(`${name}(var(--c), 10%, var(--m))`);
    }
  });

  it('keeps the input\'s format and syntax until the result is translucent (V10)', () => {
    expect(value('fade(#336699, 50%)')).toBe('rgba(51, 102, 153, 0.5)');
    expect(value('fade(#336699, 100%)')).toBe('#336699');
    expect(value('fade(#3366, 50%)')).toBe('#33336680');
    expect(value('fade(#33669980, 50%)')).toBe('#33669980');
    expect(value('fade(red, 50%)')).toBe('rgba(255, 0, 0, 0.5)');
    expect(value('fade(hsl(120, 50%, 50%), 50%)')).toBe('rgba(64, 191, 64, 0.5)');
    expect(value('fade(hsl(120, 50%, 50%), 100%)')).toBe('hsl(120, 50%, 50%)');
    expect(value('fadein(rgba(1, 2, 3, 0.5), 10%)')).toBe('rgba(1, 2, 3, 0.6)');
    expect(value('fadein(rgba(1, 2, 3, 0.5), 100%)')).toBe('rgb(1, 2, 3)');
  });

  it('keeps modern syntax in the alpha family, and writes legacy from the adjusters (Q14 open)', () => {
    expect(value('fade(rgb(1 2 3), 50%)')).toBe('rgb(1 2 3 / 0.5)');
    expect(value('fade(hsl(120 50% 50%), 50%)')).toBe('rgb(64 191 64 / 0.5)');
    expect(value('fade(hsl(120 50% 50%), 100%)')).toBe('hsl(120deg 50% 50%)');
    expect(value('darken(rgb(10 20 30), 5%)')).toBe('rgb(4, 7, 11)');
    expect(value('rgba(hsl(120 50% 50%), 0.5)')).toBe('rgba(64, 191, 64, 0.5)');
  });

  it('prints the two-slot rgba() and rgb() as a form only when the colour is one', () => {
    expect(value('rgba(currentcolor, 0.5)')).toBe('rgb(from currentcolor r g b / 0.5)');
    expect(value('rgb(currentcolor, 0.5)')).toBe('rgb(from currentcolor r g b / 0.5)');
    expect(value('rgba(darken(var(--x), 1%), 0.5)')).toBe('rgb(from hsl(from var(--x) h s clamp(0, l - 1, 100)) r g b / 0.5)');
    expect(value('rgba(foo(1), 0.5)')).toBe('rgba(foo(1), 0.5)');
    expect(value('rgba(#f00, var(--a))')).toBe('rgb(from #f00 r g b / var(--a))');
    expect(value('rgba(var(--c), var(--a))')).toBe('rgba(var(--c), var(--a))');
    expect(value('rgba(10px, 0.5)')).toBe('rgba(10px, 0.5)');
    expect(value('rgba(#f00 0.5)')).toBe('rgba(#f00 0.5)');
  });

  it('keeps a known colour\'s alpha through the two-slot rgb()', () => {
    expect(value('rgb(#c00, 0.5)')).toBe('rgba(204, 0, 0, 0.5)');
    expect(value('rgb(#c00, 50%)')).toBe('rgba(204, 0, 0, 0.5)');
  });

  it('chains the alpha family in range', () => {
    expect(value('fadeout(fadein(#336699, 10%), 5%)')).toBe('rgba(51, 102, 153, 0.95)');
  });

  it('leaves a colour given channels as well as a colour to the function mode', () => {
    expect(value('alpha(rgb(#f00, 0.5, 0.5))')).toBe('alpha(rgb(#f00, 0.5, 0.5))');
    expect(value('rgb(#f00, 0.5, 0.5)')).toBe('rgb(#f00, 0.5, 0.5)');
  });

  it('prints the form over an alpha only the browser knows', () => {
    expect(value('fade(#336699, var(--a))')).toBe('rgb(from #336699 r g b / var(--a))');
    expect(value('fade(var(--c), var(--a))')).toBe('rgb(from var(--c) r g b / var(--a))');
  });

  it('prints hsv() over what only the browser knows', () => {
    expect(value('hsv(var(--h), 50%, 50%)')).toBe('hwb(var(--h) 25% 50%)');
    expect(value('hsv(var(--h), 50%, 75%)')).toBe('hwb(var(--h) 37.5% 25%)');
    expect(value('hsva(var(--h), 50%, 50%, 0.5)')).toBe('hwb(var(--h) 25% 50% / 0.5)');
    expect(value('hsv(var(--h), 33.3%, 66.6%)')).toBe('hwb(var(--h) 44.4222% 33.4%)');
    expect(value('hsv(90, var(--s), 50%)')).toBe('hwb(90 calc((1 - var(--s) / 100%) * 50%) 50%)');
    expect(value('hsva(90, 50%, 50%, var(--a))')).toBe('hwb(90 25% 50% / var(--a))');
  });

  it('reads a known origin by its channels, whatever its spelling', () => {
    for (const color of ['#0a141e', 'rgb(10, 20, 30)', 'rgb(10 20 30)', 'rgba(10 20 30 / 1)', 'rgb(from #0a141e r g b)']) {
      expect(value(`red(${color})`)).toBe('10');
      expect(value(`srgb(fade(${color}, 50%))`)).toBe('0.039216 0.078431 0.117647 / 0.5');
    }
    expect(value('srgb(fade(hsl(210, 50%, 40%), 50%))')).toBe(value('srgb(fade(hsl(210 50% 40%), 50%))'));
    expect(value('srgb(fade(rebeccapurple, 50%))')).toBe(value('srgb(fade(#663399, 50%))'));
  });

  it('computes rgb() outside 0–255 in either spelling: it clamps, as Chrome 152 does', () => {
    expect(value('darken(rgb(300, 0, 0), 10%)')).toBe('rgb(204, 0, 0)');
    expect(value('darken(rgb(300 0 0), 10%)')).toBe('rgb(204, 0, 0)');
    expect(value('darken(rgb(150%, 0%, 0%), 10%)')).toBe('rgb(204, 0, 0)');
    expect(value('darken(rgb(150% 0% 0%), 10%)')).toBe('rgb(204, 0, 0)');
    expect(value('srgb(fade(rgb(-10 20 30), 50%))')).toBe(value('srgb(fade(rgb(-10, 20, 30), 50%))'));
  });

  it('leaves a relative rgb() outside the sRGB gamut to the browser, and clamps its alpha', () => {
    expect(value('srgb(rgb(from #336699 calc(r + 300) g b))')).toBe('-');
    expect(value('srgb(rgb(from #336699 r g b / 1.5))')).toBe('0.200000 0.400000 0.600000 / 1');
    expect(value('srgb(rgb(from #336699 r g b / -1))')).toBe('0.200000 0.400000 0.600000 / 0');
    expect(value('srgb(rgb(from #336699 calc(r + 10) g b))')).toBe('0.239216 0.400000 0.600000 / 1');
  });

  it('leaves a space-separated hsl() outside its range to the alpha family\'s form', () => {
    expect(value('fade(hsl(120 150% 50%), 50%)')).toBe('rgb(from hsl(120 150% 50%) r g b / 0.5)');
    expect(value('fade(hsl(120, 150%, 50%), 50%)')).toBe('rgba(0, 255, 0, 0.5)');
  });

  it('keeps a colour that is not CSS written out', () => {
    expect(value('srgb(rgb(from #336699 h s l))')).toBe('-');
    expect(value('srgb(hsl(from #336699 r g b))')).toBe('-');
    expect(value('srgb(rgb(10 20 30 40))')).toBe('-');
  });

  it.each([
    ['fade(rgb(tick() 2 3), 50%)', 'rgb(10 2 3 / 0.5)'],
    ['fade(rgb(tick() 2 3 / 0.5), 50%)', 'rgb(10 2 3 / 0.5)'],
    ['fade(rgb(1 2 3 / tick()), 50%)', 'rgb(1 2 3 / 0.5)'],
    ['fade(hsl(tick() 50% 50%), 50%)', 'rgb(191 85 64 / 0.5)'],
    ['fade(hsl(tick() 50% 50% / 0.5), 50%)', 'rgb(191 85 64 / 0.5)']
  ])('evaluates the channels of %s once', (source, printed) => {
    let calls = 0;
    const counting = makeLessRegistry();
    counting.register(defineFunction('tick', { params: [], body: () => makeDimension(++calls * 10) }));
    const out = css(serialize(parseLess(`.a { x: ${source}; }`), { evaluator: buildEvaluator(counting) }));
    expect(out).toContain(`x: ${printed};`);
    expect(calls).toBe(1);
  });

  it('does not evaluate a known channel again, where it could fail', () => {
    let calls = 0;
    const counting = makeLessRegistry();
    counting.register(defineFunction('boom', { params: [], body: () => {
      if (++calls > 1) {
        throw new Error('evaluated again');
      }
      return makeDimension(5);
    } }));
    expect(css(serialize(parseLess('.a { x: fade(rgb(boom() 2 3), 50%); }'), { evaluator: buildEvaluator(counting) }))).toContain('x: rgb(5 2 3 / 0.5);');
    expect(calls).toBe(1);
  });

  it('evaluates a relative channel again, with the origin\'s keywords bound', () => {
    expect(value('fade(rgb(from #336699 calc(r + 1) g b), 50%)')).toBe('rgb(52 102 153 / 0.5)');
  });

  it('evaluates a comma rgb()\'s computed arguments once', () => {
    let calls = 0;
    const counting = makeLessRegistry();
    counting.register(defineFunction('next-red', { params: [], body: () => makeDimension(++calls * 100) }));
    const out = css(serialize(parseLess('.a { x: red(rgb(next-red(), calc(10 + 10), 30)); }'), { evaluator: buildEvaluator(counting) }));
    expect(out).toContain('x: 100;');
    expect(calls).toBe(1);
  });

  it('computes an origin that is a colour call of its own', () => {
    expect(value('fade(hsl(from hsl(120 50% 50%) h s l), 50%)')).toBe('rgb(64 191 64 / 0.5)');
    expect(value('fade(rgb(from rgb(1 2 3) r g b), 50%)')).toBe('rgb(1 2 3 / 0.5)');
  });

  it('computes math in a group in a channel', () => {
    expect(value('srgb(hsl(from #336699 h s calc((l - 10) * 2)))')).toBe('0.400000 0.600000 0.800000 / 1');
    expect(value('srgb(rgb(from #336699 calc((r + 10) * 2) g b))')).toBe('0.478431 0.400000 0.600000 / 1');
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

  it('reads an amount only the browser knows as a percentage (Q2)', () => {
    expect(value('darken(#336699, var(--a))')).toBe('hsl(from #336699 h s clamp(0, l - var(--a) / 1%, 100))');
    expect(value('darken(var(--c), var(--a))')).toBe('hsl(from var(--c) h s clamp(0, l - var(--a) / 1%, 100))');
    expect(value('darken(var(--c), var(--a), relative)')).toBe('hsl(from var(--c) h s clamp(0, l - l * var(--a) / 1% / 100, 100))');
    expect(value('saturate(var(--c), var(--a))')).toBe('hsl(from var(--c) h clamp(0, s + var(--a) / 1%, 100) l)');
    expect(value('spin(var(--c), var(--a))')).toBe('hsl(from var(--c) calc(h + var(--a)) s l)');
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
