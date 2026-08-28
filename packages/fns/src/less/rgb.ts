import type { Color, Dimension, ValueGroup, Fn } from '@jesscss/core';
import { colorRawRgb, defineFunction, groupItems, makeColorRgb, RGB } from '@jesscss/core';
import { clamp01, isColor, isModern, percentOf } from './color-ctor-helper.js';
import { requireDimension } from './math-helper.js';

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

export function makeRgb(value: ValueGroup): Color {
  const items = groupItems(value);
  const modernSyntax = isModern(value);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    const r = percentOf(requireDimension(items[0]), 255);
    const g = percentOf(requireDimension(items[1]), 255);
    const b = percentOf(requireDimension(items[2]), 255);
    const a = items[3] !== undefined ? percentOf(requireDimension(items[3]), 1) : 1;
    const p0 = pctOf(requireDimension(items[0])), p1 = pctOf(requireDimension(items[1])), p2 = pctOf(requireDimension(items[2]));
    const rgbPct = p0 !== undefined || p1 !== undefined || p2 !== undefined ? [p0, p1, p2] : undefined;
    const alphaPct = items[3] !== undefined ? pctOf(requireDimension(items[3])) : undefined;
    return makeColorRgb([r, g, b], a, RGB, { modernSyntax, ...(rgbPct ? { rgbPct } : {}), ...(alphaPct !== undefined ? { alphaPct } : {}) });
  }
  if (isColor(first)) {
    const c = first;
    const a = items[1] !== undefined ? clamp01(percentOf(requireDimension(items[1]), 1)) : c.alpha;
    return makeColorRgb(colorRawRgb(c), a, RGB, { modernSyntax });
  }
  throw new Error('Invalid arguments for rgb function');
}

export const rgb: Fn = defineFunction('rgb', {
  params: [{ type: 'any' }, { type: 'any', optional: true }, { type: 'any', optional: true }, { type: 'any', optional: true }],
  variadic: true,
  body: list => makeRgb(list)
});
