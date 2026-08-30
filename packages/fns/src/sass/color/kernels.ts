/**
 * The `sass:color` kernels — value-domain only, and deliberately Sass-local.
 *
 * These are NOT re-used from `less/color-helper.ts`: Sass and Less disagree on
 * argument scale, clamping, format preservation and rounding, so a shared kernel
 * would only be shared by coincidence. Every rule below is pinned to an executed
 * case in the `sass-spec` conformance corpus (see `color-sass-spec.test.ts`).
 *
 * Precision rule (owner ruling): channels carry FULL precision internally and are
 * quantized only at the output boundary. dart-sass's legacy fns round channels
 * because its legacy colour model is 8-bit; that rounding is NOT copied here.
 *
 * HARD MODULE BOUNDARY: value domain only (no `../../tree`, no legacy node).
 */
import type { Color, Dimension, ValueGroup, Value } from '@jesscss/core';
import { HEX, HSL, RGB, colorHsl, colorRawRgb, colorRgbRounded, groupSeparator, isValueGroupArray, makeColorHsl, makeColorRgb } from '@jesscss/core';

export function requireColor(value: Value): Color {
  if (value.type !== 'Color') {
    throw new TypeError('Expected a color value.');
  }
  return value;
}

export function requireDimension(value: Value): Dimension {
  if (value.type !== 'Dimension') {
    throw new TypeError('Expected a number value.');
  }
  return value;
}

/**
 * Sass arity is EXACT — `color.hue(red, green)` is `Only 1 argument allowed, but
 * 2 were passed`, and every `error/too_many_args` case in the corpus asserts it.
 * The evaluator route binds declared slots positionally and drops the rest, so
 * each fn declares one trailing `excess` slot and rejects it here; that turns a
 * mis-arity Sass call into a verbatim re-emission instead of a silent answer.
 */
export function noExcess(extra: ValueGroup | undefined, allowed: number): void {
  if (extra !== undefined) {
    throw new TypeError(`Only ${allowed} argument${allowed === 1 ? '' : 's'} allowed, but ${allowed + 1} were passed.`);
  }
}

/** Clamp to 0-1 (alpha, and the hsl channels the adjusters write back). */
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * A Sass `$amount` on the PERCENTAGE scale (`lighten`/`darken`/`saturate`/
 * `desaturate`/`mix`/`invert`): `10%` and a bare `10` both mean 0.1. dart-sass
 * restricts these to 0-100% (`desaturate(#f00, 200%)` → `$amount: Expected 200%
 * to be within 0% and 100%`), and `lighten(hsl(0,0%,90%), 0.2)` → `hsl(0, 0%,
 * 90.2%)` proves the unitless form is the same percentage scale, not a fraction.
 */
export function percentAmount(value: Value, max = 100): number {
  const d = requireDimension(value);

  /*
   * A foreign unit is TOLERATED, not rejected: `invert/legacy.hrx` has
   * `color.invert(turquoise, 10px)` → `rgb(76.7, 204.7, 191.9)`, i.e. `10px`
   * read as 10%, emitting a `function-units` deprecation rather than an error.
   */
  if (d.number < 0 || d.number > max) {
    throw new RangeError(`$amount: Expected ${d.bytes} to be within 0% and ${max}%.`);
  }
  return d.number / 100;
}

/**
 * `mix`'s `$weight`. Same 0-100 percentage scale as {@link percentAmount}, but a
 * foreign unit is TOLERATED rather than rejected: `sass-spec`'s
 * `mix/units.hrx` accepts `color.mix(#91e16f, #0144bf, 50px)` with the same
 * result as `50%`, emitting a `function-units` deprecation instead of an error.
 */
export function weightAmount(value: Value): number {
  const d = requireDimension(value);
  if (d.number < 0 || d.number > 100) {
    throw new RangeError(`$weight: Expected ${d.bytes} to be within 0% and 100%.`);
  }
  return d.number / 100;
}

/**
 * A Sass `$amount` on the 0-1 FRACTION scale (`opacify`/`fade-in`/
 * `transparentize`/`fade-out`). This is the proven non-alias: dart-sass rejects a
 * percentage outright (`fade-in(rgba(255,0,0,.5), 10%)` → `$amount: Expected 10%
 * to be within 0 and 1`) where Less's `fadein` takes `10%` to mean +0.1 alpha.
 */
export function fractionAmount(value: Value): number {
  const d = requireDimension(value);
  if (d.unit !== '' || d.number < 0 || d.number > 1) {
    throw new RangeError(`$amount: Expected ${d.bytes} to be within 0 and 1.`);
  }
  return d.number;
}

/**
 * Rebuild `color` at `newAlpha`, preserving the source format EXCEPT that a hex
 * literal turning translucent becomes rgb — dart-sass: `transparentize(#ff0, .5)`
 * → `rgba(255, 255, 0, 0.5)` and `opacify(#ff000080, .1)` →
 * `rgba(255, 0, 0, 0.6019607843)` (so an 8-digit hex is NOT preserved the way
 * Less's `withAlpha` preserves it), while `transparentize(hsl(120,50%,50%), .5)`
 * → `hsla(120, 50%, 50%, 0.5)` keeps hsl. No 8-decimal rounding: the emit policy
 * (`formatNumber` + 1e-10 tolerance trim) owns numeric presentation.
 */
export function withAlpha(color: Color, newAlpha: number): Color {
  const alpha = clamp01(newAlpha);
  const format = color.format === HEX && alpha < 1 ? RGB : color.format;
  return color.hsl
    ? makeColorHsl(colorHsl(color), alpha, format)
    : makeColorRgb(colorRawRgb(color), alpha, format);
}

/**
 * The four HSL single-channel adjusters (`lighten`/`darken` on `l`,
 * `saturate`/`desaturate` on `s`). `channel` indexes `[h, s, l]`; `sign` adds or
 * subtracts. The written-back channel is clamped to 0-1 (dart-sass:
 * `lighten(#fff, 50%)` → `white`, `lighten(hsl(0,0%,90%), 20%)` →
 * `hsl(0, 0%, 100%)`).
 *
 * Sass takes exactly two arguments — Less's third `relative`/`absolute` method
 * argument is an arity error there (`lighten(#800, 10%, relative)` → `Only 2
 * arguments allowed, but 3 were passed`), so a supplied third slot throws and the
 * call is left verbatim rather than silently answering the two-argument result.
 */
export function hslAdjust(channel: 1 | 2, sign: 1 | -1): (...args: Value[]) => Value {
  return (c, amt, extra) => {
    if (extra !== undefined) {
      throw new TypeError('Only 2 arguments allowed, but 3 were passed.');
    }
    const color = requireColor(c);
    const hsl = colorHsl(color);
    const out: [number, number, number] = [hsl[0], hsl[1], hsl[2]];
    out[channel] = clamp01(out[channel] + sign * percentAmount(amt));
    return makeColorHsl(out, color.alpha, color.format);
  };
}

/**
 * Rotate hue by `degrees`, wrapped to 0-360, preserving alpha + format. The
 * kernel behind `adjust-hue` and `complement` (`complement` is a fixed 180).
 * dart-sass: `adjust-hue(#800, 45)` → `#886600`, `adjust-hue(#800, -45)` →
 * `#880066`, `complement(hsl(10,90%,50%))` → `hsl(190, 90%, 50%)`.
 */
export function rotateHue(color: Color, degrees: number): Color {
  const [h, s, l] = colorHsl(color);
  const hue = (h + degrees) % 360;
  return makeColorHsl([hue < 0 ? hue + 360 : hue, s, l], color.alpha, color.format);
}

/**
 * Sass `mix`'s weighted blend. Identical alpha-aware weighting to Less's, but
 * over the RAW (unrounded) channels and always emitted in rgb format — dart-sass
 * `mix(#f00, #00f)` → `rgb(127.5, 0, 127.5)` (not Less's hex-quantized
 * `#800080`) and `mix(hsl(120,50%,50%), #00f)` → `rgb(31.875, 95.625, 159.375)`.
 */
export function mixColors(c1: Color, c2: Color, weight: number): Color {
  const p = weight;
  const w = p * 2 - 1;
  const a1 = clamp01(c1.alpha);
  const a2 = clamp01(c2.alpha);
  const a = a1 - a2;
  const w1 = ((w * a === -1 ? w : (w + a) / (1 + w * a)) + 1) / 2;
  const w2 = 1 - w1;
  const r1 = colorRawRgb(c1);
  const r2 = colorRawRgb(c2);
  return makeColorRgb(
    [r1[0] * w1 + r2[0] * w2, r1[1] * w1 + r2[1] * w2, r1[2] * w1 + r2[2] * w2],
    a1 * p + a2 * (1 - p),
    RGB
  );
}

/* ------------------------------------------------ constructor kernels */

/** `percentOf(base)`: a `%` dimension → `number * base / 100`; else its number. */
const percentOf = (d: Dimension, base: number): number =>
  d.unit === '%' ? (d.number * base) / 100 : d.number;

/**
 * An angle in DEGREES. A true angle unit converts — `adjust_hue/units.hrx` has
 * `adjust-hue(red, 60rad)` → `rgb(0, 179.576224164, 255)`, i.e. 3437.7467707849deg
 * — while unitless and unknown units are read as degrees (`60`, `60in` → 60deg).
 */
export function degreesOf(d: Dimension): number {
  switch (d.unit) {
    case 'turn': return d.number * 360;
    case 'rad': return (d.number * 180) / Math.PI;
    case 'grad': return d.number * 0.9;
    default: return d.number;
  }
}

/** {@link degreesOf} wrapped into 0-360 — the constructors' `$hue` rule. */
export function normalizeHue(d: Dimension): number {
  const deg = degreesOf(d);
  return ((deg % 360) + 360) % 360;
}

/** Whether an arg-list item is a materialized color operand. */
export const isColor = (v: ValueGroup | undefined): v is Color =>
  v !== undefined && !isValueGroupArray(v) && v.type === 'Color';

/** Modern color syntax is signalled by a space / slash separated call. */
export const isModern = (value: ValueGroup): boolean => {
  const separator = groupSeparator(value);
  return separator === ' ' || separator === '/';
};

/** A structural arg-list item narrowed to a single value (a nested group is a type error). */
export function requireValue(v: ValueGroup | undefined): Value {
  if (v === undefined || isValueGroupArray(v)) {
    throw new TypeError('Expected a single value argument.');
  }
  return v;
}

/**
 * Sass `$alpha`: `%` divided by 100, unitless as-is, then clamped to 0-1. A
 * FOREIGN unit is an error — `rgb/error/four_args.hrx` asserts
 * `rgb(0, 0, 0, 0.5px)` → `$alpha: Expected 0.5px to have no units`.
 */
export function alphaOf(v: ValueGroup | undefined): number {
  const d = requireDimension(requireValue(v));
  if (d.unit !== '' && d.unit !== '%') {
    throw new TypeError(`$alpha: Expected ${d.bytes} to have no units.`);
  }
  return clamp01(percentOf(d, 1));
}

/**
 * Flatten the MODERN one-argument call forms into positional channel slots, so
 * every downstream rule reads `[c1, c2, c3, alpha?]` regardless of spelling.
 *
 * `sass-spec`'s `rgb/one_arg` + `hsl/one_arg` cover both spellings: a
 * space-separated channel group arriving as a single argument (`rgb(18 52 86)`),
 * and that group slash-separated from an alpha (`rgb(18 52 86 / 0.5)`). A legacy
 * comma call already arrives flat and passes through untouched.
 *
 * A space group must hold EXACTLY three channels: `rgb(1 2 3 0.4)` is
 * `Only 2 arguments allowed, but 4 were passed` in Sass — an alpha has to be
 * slash-separated — and `rgb(1)` / `rgb(1 2)` / `rgb(())` are likewise errors.
 */
function channelSlots(args: readonly (ValueGroup | undefined)[]): readonly (ValueGroup | undefined)[] {
  const expandChannels = (group: readonly ValueGroup[]): readonly ValueGroup[] => {
    if (group.length !== 3) {
      throw new TypeError(`Expected 3 space-separated channels, got ${group.length}.`);
    }
    return group;
  };
  const out: (ValueGroup | undefined)[] = [];
  for (const arg of args) {
    if (arg === undefined || isValueGroupArray(arg)) {
      if (arg === undefined) {
        out.push(arg);
      } else {
        out.push(...expandChannels(arg));
      }
      continue;
    }
    if (arg.type === 'List' && arg.sep === '/') {
      const [head, alpha, ...rest] = arg.value;
      if (head === undefined || alpha === undefined || rest.length > 0) {
        throw new TypeError('Expected `<channels> / <alpha>`.');
      }
      out.push(...(isValueGroupArray(head) ? expandChannels(head) : [head]), alpha);
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** Reject a slot count Sass does not accept for a colour constructor. */
function requireArity(items: readonly unknown[], allowed: readonly number[], name: string): void {
  if (!allowed.includes(items.length)) {
    throw new TypeError(`${name}: wrong number of arguments (${items.length}).`);
  }
}

/**
 * Sass `rgb`/`rgba`. Channels are clamped to 0-255 with fractions PRESERVED
 * (`rgb(300,0,0)` → `rgb(255, 0, 0)`, `rgb(-10,0,0)` → `rgb(0, 0, 0)`,
 * `rgb(1.5,2.5,3.5)` → `rgb(1.5, 2.5, 3.5)`), a `%` channel is scaled and NOT
 * echoed back verbatim (`rgb(50%,0%,0%)` → `rgb(127.5, 0, 0)`, where Less
 * preserves the authored `50%`), and alpha is clamped to 0-1
 * (`rgb(1,2,3,150%)` → `rgb(1, 2, 3)`, `rgb(1,2,3,-0.5)` → `rgba(1, 2, 3, 0)`).
 *
 * The two-argument COLOUR form re-alphas rather than reformats: `rgb(#123, 1)` →
 * `#112233` keeps the hex, `rgb(#123, 0.5)` → `rgba(17, 34, 51, 0.5)` does not.
 */
export function makeRgb(args: readonly (ValueGroup | undefined)[], modernSyntax: boolean): Color {
  const items = channelSlots(args);
  const first = items[0];
  if (isColor(first)) {
    requireArity(items, [1, 2], 'rgb');
    return withAlpha(first, items[1] !== undefined ? alphaOf(items[1]) : first.alpha);
  }
  requireArity(items, [3, 4], 'rgb');
  const channel = (v: ValueGroup | undefined): number =>
    Math.max(0, Math.min(255, percentOf(requireDimension(requireValue(v)), 255)));
  const rgb: [number, number, number] = [channel(items[0]), channel(items[1]), channel(items[2])];
  const alpha = items[3] !== undefined ? alphaOf(items[3]) : 1;
  return makeColorRgb(rgb, alpha, RGB, { modernSyntax });
}

/**
 * Sass `hsl`/`hsla`. Hue is wrapped to 0-360 through any angle unit
 * (`hsl(-40,50%,50%)` → `hsl(320, …)`, `hsl(0.5turn,…)` → `hsl(180, …)`);
 * saturation and lightness are clamped at the LOWER bound only — dart-sass keeps
 * an over-range channel (`hsl(380deg,150%,150%)` → `hsl(20, 150%, 150%)`) where
 * Less clamps both to 1 — and there is NO achromatic canonicalization
 * (`hsl(50, 0%, 50%)` stays `hsl(50, 0%, 50%)`; Less collapses the hue to `0`).
 *
 * Unlike `rgb`, there is NO colour + alpha form: `hsl(#123, 0.5)` is
 * `Missing argument $lightness`.
 */
export function makeHsl(args: readonly (ValueGroup | undefined)[], modernSyntax: boolean): Color {
  const items = channelSlots(args);
  requireArity(items, [3, 4], 'hsl');
  const h = normalizeHue(requireDimension(requireValue(items[0])));

  /*
   * Saturation/lightness read their NUMBER as the percentage regardless of unit —
   * `hsl(0, 50, 50%)` and `hsl(0, 50in, 50%)` both give `hsl(0, 50%, 50%)`.
   */
  const s = Math.max(0, requireDimension(requireValue(items[1])).number / 100);
  const l = Math.max(0, requireDimension(requireValue(items[2])).number / 100);
  const alpha = items[3] !== undefined ? alphaOf(items[3]) : 1;
  return makeColorHsl([h, s, l], alpha, HSL, modernSyntax);
}

/** `#AARRGGBB` in UPPER case — the byte that separates `ie-hex-str` from Less's `argb`. */
export function ieHexString(color: Color): string {
  const hex2 = (v: number): string => v.toString(16).padStart(2, '0').toUpperCase();
  const [r, g, b] = colorRgbRounded(color);
  return `#${hex2(Math.round(clamp01(color.alpha) * 255))}${hex2(r)}${hex2(g)}${hex2(b)}`;
}
