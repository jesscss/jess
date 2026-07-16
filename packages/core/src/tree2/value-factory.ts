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
  opts?: { modernSyntax?: boolean; node?: string },
): Color {
  const base: Color = {
    kind: 'color',
    rgb,
    alpha,
    format,
    ...(opts?.modernSyntax ? { modernSyntax: true } : {}),
    ...(opts?.node !== undefined ? { node: opts.node } : {}),
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
): Color {
  const rgb: readonly [number, number, number] = [0, 0, 0]; // derived lazily by serializer
  const base: Color = {
    kind: 'color',
    rgb,
    alpha,
    hsl,
    format,
    ...(modernSyntax ? { modernSyntax: true } : {}),
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
