/**
 * Accessor + constructor helpers for the value domain — the ergonomic layer that
 * makes value math + fn conversion mechanical. Functions READ via typed accessors
 * and WRITE via constructors that compute canonical `bytes` up front (via the free
 * serializer), building each result object once and stamping its bytes in place.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the free serializer.
 */
import type {
  Block, Bool, Collection, CollectionEntry, Color, Dimension, Keyword, Quoted, List, ListSeparator, ValueGroup
} from './value-eval.js';
import { colorRgb, colorSourceRgb, rgbToHsl, serializeColor } from './color.js';
import { serializeDimension, serializeQuoted, serializeValue } from './serialize-value.js';

/** A writable view of a value object, so a constructor can stamp `bytes` in place. */
type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/* ----------------------------------------------------------- accessors */

/** A numeric operand's scalar (a value `Dimension` or a bare JS number). */
export const numOf = (v: Dimension | number): number => (typeof v === 'number' ? v : v.number);

/**
 * A color's hsl triple — the LAZY-HSL accessor. Returns the carried `hsl` source
 * of truth when present (exact, no drift), else derives it from rgb once. Pure.
 */
export const colorHsl = (c: Color): [number, number, number] =>
  c.hsl ? [c.hsl[0], c.hsl[1], c.hsl[2]] : rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);

export const textOf = (v: Keyword | Quoted): string => (v.type === 'Quoted' ? v.value : v.text);

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
 * hsv reader fns consume this.
 */
export const colorRawRgb = colorSourceRgb;

/* -------------------------------------------------------- constructors */

export function makeDimension(number: number, unit = ''): Dimension {
  const n: Mutable<Dimension> = { type: 'Dimension', number, unit, bytes: '' };
  n.bytes = serializeDimension(n);
  return n;
}

/**
 * A dimension carrying an explicit compound-unit multiset (an arithmetic result).
 * `unit` is the collapsed DISPLAY unit; `numerator`/`denominator`/`backupUnit`
 * survive so a later chained op can cancel (`8cats * 9dogs / 4cats` → `18dogs`).
 * Stored only when the multiset is non-trivial (not a single numerator).
 */
export function makeCompoundDimension(
  number: number,
  unit: string,
  numerator: readonly string[],
  denominator: readonly string[],
  backupUnit: string | undefined
): Dimension {
  const n: Mutable<Dimension> = { type: 'Dimension', number, unit, numerator, denominator, bytes: '' };
  if (backupUnit !== undefined) {
    n.backupUnit = backupUnit;
  }
  n.bytes = serializeDimension(n);
  return n;
}

/** Build a color from an RGB source. `node` (verbatim spelling) is optional. */
export function makeColorRgb(
  rgb: readonly [number, number, number],
  alpha: number,
  format: number,
  opts?: { modernSyntax?: boolean; node?: string; rgbPct?: readonly (number | undefined)[]; alphaPct?: number }
): Color {
  const c: Mutable<Color> = { type: 'Color', rgb, alpha, format, bytes: '' };
  if (opts?.modernSyntax) {
    c.modernSyntax = true;
  }
  if (opts?.node !== undefined) {
    c.node = opts.node;
  }
  if (opts?.rgbPct !== undefined) {
    c.rgbPct = opts.rgbPct;
  }
  if (opts?.alphaPct !== undefined) {
    c.alphaPct = opts.alphaPct;
  }
  c.bytes = serializeColor(c);
  return c;
}

/** Build a color from an HSL source (the hsl op result path). rgb stays derived. */
export function makeColorHsl(
  hsl: readonly [number, number, number],
  alpha: number,
  format: number,
  modernSyntax?: boolean,
  opts?: { hueUnit?: string; alphaPct?: number }
): Color {
  const c: Mutable<Color> = { type: 'Color', rgb: [0, 0, 0], alpha, hsl, format, bytes: '' };
  if (modernSyntax) {
    c.modernSyntax = true;
  }
  if (opts?.hueUnit) {
    c.hueUnit = opts.hueUnit;
  }
  if (opts?.alphaPct !== undefined) {
    c.alphaPct = opts.alphaPct;
  }
  c.bytes = serializeColor(c);
  return c;
}

export function makeQuoted(value: string, quote: string, escaped: boolean): Quoted {
  const q: Mutable<Quoted> = { type: 'Quoted', value, quote, escaped, bytes: '' };
  q.bytes = serializeQuoted(q);
  return q;
}

export const makeKeyword = (text: string): Keyword => ({ type: 'Keyword', text, bytes: text });

/** A boolean value result (`true`/`false` — the shape guards and `is*` predicates emit). */
export const makeBool = (value: boolean): Bool => ({ type: 'Bool', value, bytes: value ? 'true' : 'false' });

export function makeList(
  value: readonly ValueGroup[],
  sep: ListSeparator = ','
): List {
  const l: Mutable<List> = { type: 'List', value, sep, bytes: '' };
  l.bytes = serializeValue(l);
  return l;
}

/**
 * Build a value-domain map. `entries` keep their AUTHORED order — Sass maps are
 * ordered, and a key-rewriting function (`map.set`) replaces in place rather than
 * appending. De-duplication is the CALLER's policy (the evaluator preserves what
 * the author wrote; `map.merge` collapses), so this never silently drops a pair.
 */
export function makeCollection(entries: readonly CollectionEntry[], base?: ValueGroup): Collection {
  const c: Mutable<Collection> = { type: 'Collection', entries, bytes: '' };
  if (base !== undefined) {
    c.base = base;
  }
  c.bytes = serializeValue(c);
  return c;
}

/** Wrap a value in an explicit paren/square delimiter fact. */
export function makeBlock(
  inner: ValueGroup,
  delimiter: Block['delimiter'],
  escaped = false
): Block {
  const block: Mutable<Block> = { type: 'Block', inner, delimiter, bytes: '' };
  if (escaped) {
    block.escaped = true;
  }
  block.bytes = serializeValue(block);
  return block;
}
