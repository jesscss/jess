import type { Color, Dimension, List, Fn } from '@jesscss/core/value';
import { colorRawRgb, defineFunction, makeColorRgb, RGB } from '@jesscss/core/value';
import { clamp01, isColor, isModern, percentOf } from './color-ctor-helper.js';

/**
 * `rgb` / `rgba` (alias) — CONSTRUCT an RGB-format color from numeric channels, or
 * REFORMAT an existing color to rgb. Byte-faithful to `less/rgb` for the value-
 * domain-representable cases: r/g/b via `percentOf(255)`, optional alpha via
 * `percentOf(1)`, modern-syntax picked from the call separator.
 *
 * SOURCE-FORMAT preservation (the verbatim rule for color literals): an un-operated
 * constructor keeps its authored spelling — a `%` channel (`rgb(50%, 0, 0)`) stays
 * `50%`, a `%` alpha stays `50%`. The authored percents ride on the `Color`
 * (`rgbPct`/`alphaPct`); an OPERATED result rebuilds without them → canonical
 * channels. Un-representable overloads (relative-color `from`) are out of Tier-B scope.
 */
/** A `%` dimension's authored number (for source-format preservation), else undefined. */
const pctOf = (d: Dimension | undefined): number | undefined =>
  d?.unit === '%' ? d.number : undefined;

export function makeRgb(list: List): Color {
  const items = list.value;
  const modernSyntax = isModern(list);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    const r = percentOf(items[0] as Dimension, 255);
    const g = percentOf(items[1] as Dimension, 255);
    const b = percentOf(items[2] as Dimension, 255);
    const a = items[3] !== undefined ? percentOf(items[3] as Dimension, 1) : 1;
    const p0 = pctOf(items[0] as Dimension), p1 = pctOf(items[1] as Dimension), p2 = pctOf(items[2] as Dimension);
    const rgbPct = p0 !== undefined || p1 !== undefined || p2 !== undefined ? [p0, p1, p2] : undefined;
    const alphaPct = pctOf(items[3] as Dimension | undefined);
    return makeColorRgb([r, g, b], a, RGB, { modernSyntax, ...(rgbPct ? { rgbPct } : {}), ...(alphaPct !== undefined ? { alphaPct } : {}) });
  }
  if (isColor(first)) {
    const c = first as Color;
    const a = items[1] !== undefined ? clamp01(percentOf(items[1] as Dimension, 1)) : c.alpha;
    return makeColorRgb(colorRawRgb(c), a, RGB, { modernSyntax });
  }
  throw new Error('Invalid arguments for rgb function');
}

export const rgb: Fn = defineFunction('rgb', {
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: list => makeRgb(list)
});
