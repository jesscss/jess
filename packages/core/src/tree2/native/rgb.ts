import type { Color, Dimension, List } from '../value-eval.js';
import { colorRawRgb, makeColorRgb } from '../value-factory.js';
import { RGB } from '../serialize-value.js';
import { clamp01, isColor, isModern, percentOf } from './color-ctor-helper.js';
import type { NativeFn } from './types.js';

/**
 * `rgb` / `rgba` (alias) — CONSTRUCT an RGB-format color from numeric channels, or
 * REFORMAT an existing color to rgb. Byte-faithful to `less/rgb` for the value-
 * domain-representable cases: r/g/b via `percentOf(255)`, optional alpha via
 * `percentOf(1)`, modern-syntax picked from the call separator.
 *
 * KNOWN v5 value-domain limitation (documented in `serialize-value.ts`): a raw
 * PERCENTAGE channel (`rgb(50%, 0, 0)`) is NOT preserved as `50%` in the output —
 * the value domain carries no per-channel unit source, so it canonicalizes to the
 * rounded integer channel. Un-representable overloads (relative-color `from`) are
 * out of Tier-B scope.
 */
export function makeRgb(list: List): Color {
  const items = list.items;
  const modernSyntax = isModern(list);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    const r = percentOf(items[0] as Dimension, 255);
    const g = percentOf(items[1] as Dimension, 255);
    const b = percentOf(items[2] as Dimension, 255);
    const a = items[3] !== undefined ? percentOf(items[3] as Dimension, 1) : 1;
    return makeColorRgb([r, g, b], a, RGB, { modernSyntax });
  }
  if (isColor(first)) {
    const c = first as Color;
    const a = items[1] !== undefined ? clamp01(percentOf(items[1] as Dimension, 1)) : c.alpha;
    return makeColorRgb(colorRawRgb(c), a, RGB, { modernSyntax });
  }
  throw new Error('Invalid arguments for rgb function');
}

export const rgb: NativeFn = {
  name: 'rgb',
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list) => makeRgb(list),
};
