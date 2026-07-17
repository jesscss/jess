/**
 * Accessor + constructor helpers for the tree2 value domain — the ergonomic
 * layer that makes native value math + fn conversion mechanical. Functions READ
 * via typed accessors and WRITE via constructors that compute canonical `bytes`
 * up front (via the free serializer), so native code never touches a legacy node
 * or a `render()` walk.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the free serializer.
 */
import type { Color, Dimension, Keyword, Quoted, Bool, Nil, List, ValueObj } from './value-eval.js';
import {
  colorRgb,
  colorSourceRgb,
  rgbToHsl,
  serializeColor,
  serializeDimension,
  serializeQuoted,
  serializeValue,
} from './serialize-value.js';

/* ----------------------------------------------------------- accessors */

/** A numeric operand's scalar (a value `Dimension` or a bare JS number). */
export const numOf = (v: Dimension | number): number => (typeof v === 'number' ? v : v.number);
export const unitOf = (v: Dimension | number): string => (typeof v === 'number' ? '' : v.unit);

/**
 * A color's hsl triple — the LAZY-HSL accessor. Returns the carried `hsl` source
 * of truth when present (exact, no drift), else derives it from rgb once. Pure.
 */
export const colorHsl = (c: Color): [number, number, number] =>
  c.hsl ? [c.hsl[0], c.hsl[1], c.hsl[2]] : rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);

export const textOf = (v: Keyword | Quoted): string => (v.kind === 'quoted' ? v.value : v.text);

const clamp01 = (v: number, max: number): number => Math.min(Math.max(v, 0), max);

/**
 * A color's CLAMPED hsl triple — hue wrapped to 0-360, s/l clamped to 0-1. This
 * is the legacy `Color.get hsl()` / `toHSL()` view that the READER fns
 * (`hue`/`saturation`/`lightness`) consume, distinct from the UNCLAMPED `colorHsl`
 * the adjuster fns operate on.
 */
export const colorHslClamped = (c: Color): [number, number, number] => {
  const [h, s, l] = colorHsl(c);
  return [((h % 360) + 360) % 360, clamp01(s, 1), clamp01(l, 1)];
};

/** A color's ROUNDED + clamped concrete rgb (legacy `Color.get rgb()`). */
export const colorRgbRounded = colorRgb;

/**
 * A color's RAW (unrounded, unclamped) rgb — derived from the hsl source when that
 * is authoritative, else the stored rgb. Mirrors legacy `Color.get _rgb()`; the
 * hsv reader fns consume this. (The single selector lives in `serialize-value`.)
 */
export const colorRawRgb = colorSourceRgb;

/* -------------------------------------------------------- constructors */

export function makeDimension(number: number, unit = ''): Dimension {
  const n: Dimension = { kind: 'dimension', number, unit, bytes: '' };
  return { ...n, bytes: serializeDimension(n) };
}

/** Build a color from an RGB source. `node` (verbatim spelling) is optional. */
export function makeColorRgb(
  rgb: readonly [number, number, number],
  alpha: number,
  format: number,
  opts?: { modernSyntax?: boolean; node?: string; rgbPct?: readonly (number | undefined)[]; alphaPct?: number },
): Color {
  const base: Color = {
    kind: 'color',
    rgb,
    alpha,
    format,
    ...(opts?.modernSyntax ? { modernSyntax: true } : {}),
    ...(opts?.node !== undefined ? { node: opts.node } : {}),
    ...(opts?.rgbPct !== undefined ? { rgbPct: opts.rgbPct } : {}),
    ...(opts?.alphaPct !== undefined ? { alphaPct: opts.alphaPct } : {}),
    bytes: '',
  };
  return { ...base, bytes: serializeColor(base) };
}

/** Build a color from an HSL source (the hsl op result path). rgb stays derived. */
export function makeColorHsl(
  hsl: readonly [number, number, number],
  alpha: number,
  format: number,
  modernSyntax?: boolean,
  opts?: { hueUnit?: string; alphaPct?: number },
): Color {
  const rgb: readonly [number, number, number] = [0, 0, 0]; // derived lazily by serializer
  const base: Color = {
    kind: 'color',
    rgb,
    alpha,
    hsl,
    format,
    ...(modernSyntax ? { modernSyntax: true } : {}),
    ...(opts?.hueUnit ? { hueUnit: opts.hueUnit } : {}),
    ...(opts?.alphaPct !== undefined ? { alphaPct: opts.alphaPct } : {}),
    bytes: '',
  };
  return { ...base, bytes: serializeColor(base) };
}

export function makeQuoted(value: string, quote: string, escaped: boolean): Quoted {
  const q: Quoted = { kind: 'quoted', value, quote, escaped, bytes: '' };
  return { ...q, bytes: serializeQuoted(q) };
}

export const makeKeyword = (text: string): Keyword => ({ kind: 'keyword', text, bytes: text });

export const makeBool = (value: boolean): Bool => ({ kind: 'bool', value, bytes: value ? 'true' : 'false' });

export const makeNil = (bytes = ''): Nil => ({ kind: 'nil', bytes });

export function makeList(items: readonly ValueObj[], sep: ',' | ' ' | '/'): List {
  const l: List = { kind: 'list', items, sep, bytes: '' };
  return { ...l, bytes: serializeValue(l) };
}
