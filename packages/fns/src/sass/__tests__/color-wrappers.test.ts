/**
 * The Sass colour functions that are NOT aliases of a Less function, even though
 * an earlier `NAME_ALIASES.md` claimed they were.
 *
 * Each claim below is disproven by an executed reference result, and re-exporting
 * the Less body under the Sass name would have shipped the wrong behaviour:
 *
 *   - `fade-in`/`opacify`/`fade-out`/`transparentize` take a 0-1 FRACTION and
 *     REJECT a percentage; Less's `fadein`/`fadeout` require a percentage.
 *   - `ie-hex-str` emits UPPER-case hex; Less's `argb` emits lower case.
 *   - `grayscale`/`adjust-hue` do compute what `greyscale`/`spin` compute, but a
 *     fn IS its dispatch name, so they are Sass-owned definitions.
 *
 * Value-level conformance for all of these lives in `color-sass-spec.test.ts`;
 * this file pins the NON-ALIAS relationships specifically.
 */
import { describe, expect, it } from 'vitest';
import { makeColorRgb, makeDimension, makeList, isValueGroupArray, HEX, RGB } from '@jesscss/core/value';
import type { Color, Fn, FnCtx, ValueGroup, ValueObj } from '@jesscss/core/value';
import { fadeIn } from '../color/fade-in.js';
import { fadeOut } from '../color/fade-out.js';
import { opacify } from '../color/opacify.js';
import { transparentize } from '../color/transparentize.js';
import { adjustHue } from '../color/adjust-hue.js';
import { grayscale } from '../color/grayscale.js';
import { ieHexStr } from '../color/ie-hex-str.js';
import { ieHexString } from '../color/kernels.js';
import { fadein as lessFadein } from '../../less/fadein.js';
import { fadeout as lessFadeout } from '../../less/fadeout.js';
import { greyscale as lessGreyscale } from '../../less/greyscale.js';
import { spin as lessSpin } from '../../less/spin.js';
import { argb as lessArgb } from '../../less/argb.js';

const ctx: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: v => (isValueGroupArray(v) ? '' : v.bytes)
};

function call(fn: Fn, ...args: ValueObj[]): ValueObj {
  const result = fn(makeList(args as readonly ValueGroup[], ','), ctx);
  if (result instanceof Promise || isValueGroupArray(result)) {
    throw new TypeError('Expected a single value result.');
  }
  return result;
}

function color(value: ValueObj): Color {
  if (value.type !== 'Color') {
    throw new TypeError('Expected a Color result.');
  }
  return value;
}

const half = makeColorRgb([255, 0, 0], 0.5, RGB);
const pct = (n: number): ValueObj => makeDimension(n, '%');
const num = (n: number): ValueObj => makeDimension(n);

describe('Sass alpha functions are NOT Less’s fadein/fadeout', () => {
  it('take a 0-1 fraction where Less takes a percentage', () => {
    // dart-sass: fade-in(rgba(255,0,0,0.5), 0.1) → rgba(255, 0, 0, 0.6)
    expect(color(call(fadeIn, half, num(0.1))).alpha).toBeCloseTo(0.6);
    expect(color(call(opacify, half, num(0.1))).alpha).toBeCloseTo(0.6);
    expect(color(call(fadeOut, half, num(0.1))).alpha).toBeCloseTo(0.4);
    expect(color(call(transparentize, half, num(0.1))).alpha).toBeCloseTo(0.4);

    // Less reads the SAME numeral as a percentage — 0.1% — so the two scales
    // cannot share one body.
    expect(color(call(lessFadein, half, num(0.1))).alpha).toBeCloseTo(0.501);
  });

  it('REJECT a percentage, which is exactly what Less requires', () => {
    // dart-sass: `$amount: Expected 10% to be within 0 and 1`.
    expect(() => call(fadeIn, half, pct(10))).toThrow();
    expect(() => call(opacify, half, pct(10))).toThrow();
    expect(() => call(fadeOut, half, pct(10))).toThrow();
    expect(() => call(transparentize, half, pct(10))).toThrow();

    // Less's namesakes accept it and mean +0.1 alpha.
    expect(color(call(lessFadein, half, pct(10))).alpha).toBeCloseTo(0.6);
    expect(color(call(lessFadeout, half, pct(10))).alpha).toBeCloseTo(0.4);
  });

  it('clamp the resulting alpha into 0-1', () => {
    expect(color(call(opacify, half, num(0.9))).alpha).toBe(1);
    expect(color(call(transparentize, half, num(0.9))).alpha).toBe(0);
  });

  it('are distinct callables carrying their Sass dispatch names', () => {
    expect([fadeIn.name, fadeOut.name, opacify.name, transparentize.name])
      .toEqual(['fade-in', 'fade-out', 'opacify', 'transparentize']);
    for (const fn of [fadeIn, fadeOut, opacify, transparentize]) {
      expect(fn).not.toBe(lessFadein);
      expect(fn).not.toBe(lessFadeout);
    }
  });
});

describe('ie-hex-str is NOT Less’s argb', () => {
  it('differs from argb by CASE, so the Less body cannot be reused', () => {
    // dart-sass: ie-hex-str(rgba(255,0,0,0.5)) → #80FF0000
    expect(ieHexString(half)).toBe('#80FF0000');
    // lessc 4.8: argb(rgba(255,0,0,0.5)) → #80ff0000
    expect(color(call(lessArgb, half)).node).toBe('#80ff0000');
    expect(ieHexStr).not.toBe(lessArgb);
    expect(ieHexStr.name).toBe('ie-hex-str');
  });

  it('emits the colour carrying that exact hex spelling', () => {
    const out = color(call(ieHexStr, half));
    expect(out.format).toBe(HEX);
    expect(out.node).toBe('#80FF0000');
  });
});

describe('grayscale / adjust-hue are pure renames — but still Sass-owned', () => {
  it('compute what greyscale / spin compute', () => {
    const maroon = makeColorRgb([136, 0, 0], 1, HEX, { node: '#800' });
    expect(color(call(grayscale, maroon)).bytes).toBe(color(call(lessGreyscale, maroon)).bytes);
    expect(color(call(adjustHue, maroon, num(45))).bytes)
      .toBe(color(call(lessSpin, maroon, num(45))).bytes);
  });

  it('are nonetheless separate callables under the Sass names', () => {
    expect(grayscale).not.toBe(lessGreyscale);
    expect(adjustHue).not.toBe(lessSpin);
    expect([grayscale.name, adjustHue.name]).toEqual(['grayscale', 'adjust-hue']);
  });

  it('adjust-hue converts a true angle unit, where Less’s spin reads the raw number', () => {
    const red = makeColorRgb([255, 0, 0], 1, RGB);
    // dart-sass: adjust-hue(red, 60rad) → rgb(0, 179.576224164, 255)
    const sassHue = color(call(adjustHue, red, makeDimension(60, 'rad')));
    expect(sassHue.hsl?.[0]).toBeCloseTo(197.7467707849, 6);
    const lessHueResult = color(call(lessSpin, red, makeDimension(60, 'rad')));
    expect(lessHueResult.hsl?.[0]).toBe(60);
  });
});
