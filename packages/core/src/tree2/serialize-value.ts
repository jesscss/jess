/**
 * Boundary-clean, byte-faithful VALUE serializer over the tree2 value domain
 * (`ValueObj`). Emit bytes are produced by FREE FUNCTIONS over pure data — NO
 * legacy `../tree` node is constructed, NO `render()` walk, no intermediate node
 * objects. Emit straight to a string (the caller appends to its buffer).
 *
 * HARD MODULE BOUNDARY: imports ONLY the value-domain types and a locally-inlined
 * lean `round` (byte-identical to `tree/util/round.ts`). Ported byte-for-byte
 * from the legacy `Color.serializeScalarSyntax` / `Color.toHex` /
 * `Dimension.serializeSyntax` / `Quoted` render so native output is identical to
 * the adapter's `render()`-derived bytes.
 */
import type { Color, Dimension, Quoted, ValueObj } from './value-eval.js';

/* color-format enum, mirrored from tree/color.ts ColorFormat (opaque `number`). */
export const HEX = 0;
export const RGB = 1;
export const HSL = 2;

/**
 * Output style for value emit. A future COMPRESSED mode (dart-sass `compressed`
 * PARITY — leading-zero strip `0.5`→`.5`, hex-shorten `#ffffff`→`#fff`, etc.) is
 * committed; it is a MODE-BRANCH here, not a rewrite. Only `Expanded` is
 * implemented now — the minified branches are marked hooks (see `serializeColor`
 * / `serializeDimension`). `mode` threads through emit so nothing hard-codes
 * expanded-only formatting. Statement-level compress (whitespace/newlines/comment
 * strip / final `;` drop) is `serialize.ts`'s concern, not the value serializer's.
 */
export enum OutputMode { Expanded = 0, Compressed = 1 }

/**
 * Lean number rounding, byte-identical to `tree/util/round.ts` (inlined to stay
 * boundary-clean). Replicates lodash's exponential-shift algorithm exactly.
 */
export function round(number: number, precision?: number): number {
  if (precision === undefined) return Math.round(number);
  const p = precision < 0 ? 0 : precision > 292 ? 292 : Math.trunc(precision);
  if (p !== 0 && Number.isFinite(number)) {
    if (Number.isInteger(number)) return number;
    let pair = (`${number}e`).split('e');
    const value = Math.round(Number(`${pair[0]}e${+pair[1]! + p}`));
    pair = (`${value}e`).split('e');
    return Number(`${pair[0]}e${+pair[1]! - p}`);
  }
  return Math.round(number);
}

const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max);

/* ---------------------------------------------------- color math (ported) */

/** HSL(h deg, s 0-1, l 0-1) -> RGB 0-255, byte-identical to Color._rgb HSL branch. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = h / 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, hue + 1 / 3);
  const g = hue2rgb(p, q, hue);
  const b = hue2rgb(p, q, hue - 1 / 3);
  return [r * 255, g * 255, b * 255];
}

/** RGB 0-255 -> HSL(h deg, s 0-1, l 0-1), byte-identical to Color._hsl RGB branch. */
export function rgbToHsl(r0: number, g0: number, b0: number): [number, number, number] {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h: number, s: number;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

/**
 * The RAW (unrounded, unclamped) rgb SOURCE of a color — derived from `hsl` when
 * that is the source of truth, else the stored rgb. The single hsl-or-stored-rgb
 * selector that `colorRgb` (rounds/clamps on top) and the value factory's
 * `colorRawRgb` both consume; color arithmetic operates on this.
 */
export function colorSourceRgb(c: Color): [number, number, number] {
  return c.hsl ? hslToRgb(c.hsl[0], c.hsl[1], c.hsl[2]) : [c.rgb[0], c.rgb[1], c.rgb[2]];
}

/**
 * Concrete RGB (clamped 0-255, rounded) for a color — the value the legacy
 * `get rgb()` returns. Rounds/clamps the raw `colorSourceRgb`.
 */
export function colorRgb(c: Color): [number, number, number] {
  const [r, g, b] = colorSourceRgb(c);
  return [clamp(round(r), 255), clamp(round(g), 255), clamp(round(b), 255)];
}

/** Byte-identical port of `Color.toHex`. */
function toHex(c: Color): string {
  const values = colorRgb(c) as number[];
  const alpha = clamp(c.alpha, 1);
  if (alpha < 1) values.push(round(alpha * 255));
  let out = '#';
  for (const v of values) {
    const hex = v.toString(16);
    out += hex.length === 1 ? `0${hex}` : hex;
  }
  return out;
}

/* ---------------------------------------------------------- serializers */

/** Byte-identical port of `Dimension.serializeSyntax`. */
export function serializeDimension(n: Dimension, mode: OutputMode = OutputMode.Expanded): string {
  // COMPRESSED HOOK (not implemented): dart-sass `compressed` minifies the number
  // (leading-zero strip `0.5`→`.5`, drop trailing `.0`), unit unchanged. Branch here.
  void mode;
  const { number, unit } = n;
  const s = Number.isFinite(number)
    ? `${round(number, 8)}`
    : Number.isNaN(number) ? 'NaN' : number > 0 ? 'infinity' : '-infinity';
  return unit ? `${s}${unit}` : s;
}

/**
 * The serialized alpha text — the authored `%` spelling (`round(pct,8)%`) when the
 * alpha was written as a percent, else the decimal alpha. Byte-identical to legacy
 * `Color.getSerializedAlphaText` (non-compress path).
 */
function alphaText(c: Color, a: number): string {
  return c.alphaPct !== undefined ? `${round(c.alphaPct, 8)}%` : `${a}`;
}

/**
 * Byte-identical port of `Color.serializeScalarSyntax` (non-compress path). A
 * verbatim source literal (`c.node`) wins; else format-based emit (RGB/HSL/HEX).
 * The optional SOURCE-FORMAT state (`rgbPct`/`alphaPct`/`hueUnit`) reproduces an
 * un-operated constructor's authored spelling (`%` channels, `%` alpha, hue unit),
 * mirroring the legacy `getSerializedRgbText`/`getSerializedAlphaText`; when absent
 * the emit is the canonical no-source branch (`${rgb[idx]}` / `${alpha}`).
 */
export function serializeColor(c: Color, mode: OutputMode = OutputMode.Expanded): string {
  // COMPRESSED HOOK (not implemented): dart-sass `compressed` shortens hex
  // (`#ffffff`→`#fff`), prefers the shortest of hex/name, drops rgb/hsl spaces.
  // Verbatim `c.node` may itself be non-minimal — branch here to minify.
  void mode;
  if (c.node !== undefined) return c.node;
  const format = c.format ?? HEX;
  if (format === RGB) {
    const rgb = colorRgb(c);
    const pct = c.rgbPct;
    const chan = (idx: number): string =>
      pct?.[idx] !== undefined ? `${round(clamp(pct[idx]!, 100), 8)}%` : `${rgb[idx]}`;
    const r = chan(0), g = chan(1), b = chan(2);
    const a = clamp(c.alpha, 1);
    const modern = c.modernSyntax === true;
    if (modern) return a < 1 ? `rgb(${r} ${g} ${b} / ${alphaText(c, a)})` : `rgb(${r} ${g} ${b})`;
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${alphaText(c, a)})` : `rgb(${r}, ${g}, ${b})`;
  }
  if (format === HSL) {
    const [h, s, l] = c.hsl ?? rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);
    const a = clamp(c.alpha, 1);
    const roundedHue = round(h, 8);
    const S = round(clamp(s, 1) * 100, 8);
    const L = round(clamp(l, 1) * 100, 8);
    const modern = c.modernSyntax === true;
    // Legacy hue-unit rule: modern defaults to `deg` when unauthored; the
    // comma form preserves the authored unit (empty when unitless/derived).
    const hueUnit = modern ? (c.hueUnit || 'deg') : (c.hueUnit ?? '');
    if (modern) return a < 1 ? `hsl(${roundedHue}${hueUnit} ${S}% ${L}% / ${alphaText(c, a)})` : `hsl(${roundedHue}${hueUnit} ${S}% ${L}%)`;
    return a < 1 ? `hsla(${roundedHue}${hueUnit}, ${S}%, ${L}%, ${alphaText(c, a)})` : `hsl(${roundedHue}${hueUnit}, ${S}%, ${L}%)`;
  }
  return toHex(c);
}

/** Byte-identical port of `Quoted` render (escaping-aware). */
export function serializeQuoted(q: Quoted): string {
  const quote = q.quote || '"';
  return `${q.escaped ? '~' : ''}${quote}${q.value}${quote}`;
}

/** Serialize any `ValueObj` to its canonical bytes (mode threads through). */
export function serializeValue(v: ValueObj, mode: OutputMode = OutputMode.Expanded): string {
  switch (v.kind) {
    case 'dimension': return serializeDimension(v, mode);
    case 'color': return serializeColor(v, mode);
    case 'quoted': return serializeQuoted(v);
    case 'keyword': return v.text;
    case 'bool': return v.value ? 'true' : 'false';
    case 'nil': return v.bytes ?? '';
    case 'list': {
      // COMPRESSED HOOK: dart-sass tightens comma-list separators (`,` not `, `).
      const sep = v.sep === ',' ? ', ' : v.sep === '/' ? ' / ' : ' ';
      return v.items.map((it) => serializeValue(it, mode)).join(sep);
    }
  }
}
