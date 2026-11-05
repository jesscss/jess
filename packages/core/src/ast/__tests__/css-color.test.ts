import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize, type SerializeReturn } from '../serialize.js';
import { defineFunction } from '../value-dispatch.js';
import { makeKeyword } from '../value-factory.js';
import { isValueGroupArray, type ValueGroup } from '../value-eval.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';

/*
 * A modern `hsl()` a built-in consumes is the colour its CSS definition
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

describe('a modern hsl() a built-in consumes', () => {
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
    expect(value('darken(hsl(from #336699 h s calc(l / 0)), 5%)')).toBe('darken(hsl(from #336699 h s calc(l / 0)), 5%)');
  });

  it('feeds a built-in', () => {
    const channels = value('srgb(darken(hsl(from #336699 h s calc(l - 10)), 5%))')?.split(/ \/? ?/).map(Number);
    [0.125, 0.25, 0.375, 1].forEach((channel, index) => expect(channels?.[index]).toBeCloseTo(channel, 5));
    expect(value('darken(hsl(from var(--c) h s l), 5%)')).toBe('darken(hsl(from var(--c) h s l), 5%)');
    expect(value('iscolor(hsl(from #336699 h s l))')).toBe('true');
    expect(value('iscolor(hsl(from var(--c) h s l))')).toBe('false');
  });

  it('prints as written until an operation consumes it', () => {
    expect(value('hsl(from #336699 h s calc(l - 10))')).toBe('hsl(from #336699 h s calc(l - 10))');
    expect(value('hsl(120deg 50% calc(50 - 10) / 50%)')).toBe('hsl(120deg 50% calc(50 - 10) / 50%)');
    expect(css(serialize(parseLess('.m(@c) { m: @c; } .a { .m(hsl(from red h s calc(l - 10))); }'), { evaluator }))).toContain('m: hsl(from red h s calc(l - 10));');
    expect(value('darken(rgb(from hsl(from red h s l) r g b), 5%)')).toBe('darken(rgb(from hsl(from red h s l) r g b), 5%)');
  });
});
