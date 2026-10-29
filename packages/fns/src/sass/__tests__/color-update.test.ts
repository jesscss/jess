/**
 * `color.adjust` / `color.scale` / `color.change` and their globals
 * `adjust-color` / `scale-color` / `change-color`, called directly with named
 * records (the keyword spelling).
 *
 * Oracle: Dart Sass 1.101.7 (`sass --no-source-map`). Where Dart Sass writes a
 * fractional channel as `rgb(…%)`, the expected bytes here are that colour
 * quantized at the output boundary, as every jess colour is: Dart Sass's
 * `color.adjust(#0d6efd, $saturation: -20%)` is `rgb(14.6666666667%,
 * 44.9712418301%, 89.6470588235%)`, which is `#2573e5`.
 */
import { describe, expect, it } from 'vitest';
import { HEX, HSL, coerceNamedColorKeyword, makeColorHsl, makeColorRgb, makeDimension, makeKeyword, makeQuoted } from '@jesscss/core';
import type { Color, PartialFnRecord, ValueGroup } from '@jesscss/core';
import { adjust, adjustColor } from '../color/adjust.js';
import { scale, scaleColor } from '../color/scale.js';
import { change, changeColor } from '../color/change.js';

const primary = makeColorRgb([13, 110, 253], 1, HEX);
const pct = (n: number): ValueGroup => makeDimension(n, '%');
const num = (n: number, unit = ''): ValueGroup => makeDimension(n, unit);

type ColorUpdate = typeof adjust;

function named(name: string): Color {
  const color = coerceNamedColorKeyword(makeKeyword(name));
  if (color.type !== 'Color') {
    throw new TypeError(`${name} is not a named colour.`);
  }
  return color;
}

function bytes(fn: ColorUpdate, color: Color, keywords: PartialFnRecord<ColorUpdate['params']>): string {
  const result = fn({ ...keywords, color });
  if (result instanceof Promise || Array.isArray(result) || !('bytes' in result)) {
    throw new TypeError('Expected a single value result.');
  }
  return result.bytes;
}

describe('color.adjust adds to each channel', () => {
  it.each([
    ['red', num(-20), '#006efd'],
    ['green', num(15), '#0d7dfd'],
    ['blue', num(-40), '#0d6ed5'],
    ['hue', num(30, 'deg'), '#240dfd'],
    ['saturation', pct(-20), '#2573e5'],
    ['lightness', pct(-10), '#0257d5'],
    ['whiteness', pct(10), '#277dfd'],
    ['blackness', pct(15), '#0d5fd7']
  ] as const)('$%s', (channel, amount, expected) => {
    expect(bytes(adjust, primary, { [channel]: amount })).toBe(expected);
  });

  it('adds to alpha, on a hex and on a named colour', () => {
    expect(bytes(adjust, primary, { alpha: num(-0.25) })).toBe('rgba(13, 110, 253, 0.75)');
    expect(bytes(adjust, named('white'), { alpha: num(-0.85) })).toBe('rgba(255, 255, 255, 0.15)');
  });

  it('clamps rgb at 0-255 and saturation at 0, and keeps an hsl colour hsl', () => {
    // dart-sass: color.adjust(#abcdef, $red: 500) → #ffcdef
    expect(bytes(adjust, makeColorRgb([171, 205, 239], 1, HEX), { red: num(500) })).toBe('#ffcdef');

    // dart-sass: color.adjust(hsl(210, 50%, 50%), $saturation: -80%) → hsl(210, 0%, 50%)
    expect(bytes(adjust, makeColorHsl([210, 0.5, 0.5], 1, HSL), { saturation: pct(-80) })).toBe('hsl(210, 0%, 50%)');

    // dart-sass: color.adjust(hsl(210, 50%, 50%), $lightness: 10%) → hsl(210, 50%, 60%)
    expect(bytes(adjust, makeColorHsl([210, 0.5, 0.5], 1, HSL), { lightness: pct(10) })).toBe('hsl(210, 50%, 60%)');
  });

  it('reads the hue through its angle unit and the hsl channels whatever their unit', () => {
    // dart-sass: color.adjust(red, $hue: 60rad) → rgb(0%, 70.4220486918%, 100%)
    expect(bytes(adjust, named('red'), { hue: num(60, 'rad') })).toBe('#00b4ff');

    // dart-sass: color.adjust(red, $lightness: 10) → #ff3333
    expect(bytes(adjust, named('red'), { lightness: num(10) })).toBe('#ff3333');
  });
});

describe('color.scale moves each channel toward its bound', () => {
  it.each([
    ['red', 20, '#3d6efd'],
    ['green', -30, '#0d4dfd'],
    ['blue', -50, '#0d6e7f'],
    ['saturation', -30, '#3175d9'],
    ['lightness', 40, '#6ea8fe'],
    ['whiteness', 20, '#3d8bfd'],
    ['blackness', 30, '#0d4fb1']
  ] as const)('$%s', (channel, amount, expected) => {
    expect(bytes(scale, primary, { [channel]: pct(amount) })).toBe(expected);
  });

  it('scales alpha, on a hex and on a named colour', () => {
    expect(bytes(scale, primary, { alpha: pct(-40) })).toBe('rgba(13, 110, 253, 0.6)');
    expect(bytes(scale, named('black'), { alpha: pct(-87.5) })).toBe('rgba(0, 0, 0, 0.125)');
  });
});

describe('color.change replaces each channel', () => {
  it.each([
    ['red', num(0), '#006efd'],
    ['green', num(200), '#0dc8fd'],
    ['blue', num(128), '#0d6e80'],
    ['hue', num(150), '#0dfd85'],
    ['saturation', pct(50), '#4879c2'],
    ['lightness', pct(25), '#01347e'],
    ['whiteness', pct(20), '#3385fd'],
    ['blackness', pct(10), '#0d65e6']
  ] as const)('$%s', (channel, value, expected) => {
    expect(bytes(change, primary, { [channel]: value })).toBe(expected);
  });

  it('replaces alpha, on a hex and on a named colour', () => {
    expect(bytes(change, primary, { alpha: num(0.5) })).toBe('rgba(13, 110, 253, 0.5)');
    expect(bytes(change, primary, { alpha: pct(50) })).toBe('rgba(13, 110, 253, 0.5)');
    expect(bytes(change, named('black'), { alpha: num(0.175) })).toBe('rgba(0, 0, 0, 0.175)');
  });

  it('reads an rgb channel as a number or a % of 255', () => {
    // dart-sass: color.change(#0d6efd, $red: 10%) → rgb(10%, 43.137254902%, 99.2156862745%)
    expect(bytes(change, primary, { red: pct(10) })).toBe('#1a6efd');
  });
});

describe('$space', () => {
  it('works in rgb, hsl and hwb', () => {
    // dart-sass: color.adjust(#0d6efd, $hue: 30deg, $space: hwb) → #240dfd
    expect(bytes(adjust, primary, { hue: num(30, 'deg'), space: makeKeyword('hwb') })).toBe('#240dfd');

    // dart-sass: color.scale(#0d6efd, $lightness: 20%, $space: hsl) → rgb(24.07…%, 54.50…%, 99.37…%)
    expect(bytes(scale, primary, { lightness: pct(20), space: makeKeyword('hsl') })).toBe('#3d8bfd');
  });
});

describe('the global spellings are the same functions', () => {
  it.each([
    [adjust, adjustColor, 'adjust-color', { lightness: pct(-10) }],
    [scale, scaleColor, 'scale-color', { lightness: pct(-15) }],
    [change, changeColor, 'change-color', { alpha: num(0.5) }]
  ] as const)('%#', (member, global, name, keywords) => {
    expect(global.name).toBe(name);
    expect(bytes(global, primary, keywords)).toBe(bytes(member, primary, keywords));
  });
});

describe('the errors Dart Sass raises', () => {
  it.each([
    ['rgb and hsl channels together', adjust, { red: num(10), lightness: pct(10) }, '$lightness: Color space rgb doesn\'t have a channel with this name.'],
    ['hsl and hwb channels together', scale, { saturation: pct(1), blackness: pct(1) }, '$blackness: Color space hsl doesn\'t have a channel with this name.'],
    ['rgb and hue together', change, { red: num(1), hue: num(1) }, '$hue: Color space rgb doesn\'t have a channel with this name.'],
    ['a change of alpha past 1', change, { alpha: num(1.001) }, '$alpha: Expected 1.001 to be within 0 and 1.'],
    ['a change of alpha past 100%', change, { alpha: pct(150) }, '$alpha: Expected 150% to be within 0% and 100%.'],
    ['a scale by a number without %', scale, { red: num(15) }, '$red: Expected 15 to have unit "%".'],
    ['a scale past 100%', scale, { whiteness: pct(100.001) }, '$whiteness: Expected 100.001% to be within -100% and 100%.'],
    ['a scale of the hue', scale, { hue: pct(10) }, '$hue: Channel isn\'t scalable.'],
    ['an rgb channel in a foreign unit', adjust, { green: num(10, 'px') }, '$green: Expected 10px to have unit "%" or no units.'],
    ['a channel that is not a number', adjust, { red: makeKeyword('c') }, '$red: c is not a number.'],
    ['a changed channel that is not a number', change, { red: makeKeyword('c') }, '$red: c is not a number or unquoted "none".'],
    ['a quoted $space', adjust, { space: makeQuoted('lab', '"', false) }, '$space: Expected "lab" to be an unquoted string.'],
    ['an unknown $space', adjust, { space: makeKeyword('c') }, '$space: Unknown color space "c".']
  ] as const)('%s', (_, fn, keywords, message) => {
    expect(() => bytes(fn, primary, keywords)).toThrow(message);
  });

  it('refuses a second positional argument', () => {
    expect(() => adjust(primary, num(10))).toThrow('Only one positional argument is allowed. All other arguments must be passed by name.');
  });

  it('refuses to adjust a hue $space makes powerless', () => {
    // dart-sass: color.adjust(grey, $hue: 10deg, $space: hsl) → $hue: … doesn't currently support modifying missing channels
    expect(() => bytes(adjust, named('grey'), { hue: num(10, 'deg'), space: makeKeyword('hsl') }))
      .toThrow('$hue: Because the CSS working group is still deciding on the best behavior');
  });

  it('reports the colour spaces and missing channels jess has no model for', () => {
    expect(() => bytes(adjust, primary, { lightness: pct(10), space: makeKeyword('lab') }))
      .toThrow('$space: The lab color space is not supported yet.');
    expect(() => bytes(change, primary, { red: makeKeyword('none') }))
      .toThrow('$red: a missing ("none") channel is not supported.');
  });
});
