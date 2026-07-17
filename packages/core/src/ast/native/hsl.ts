import type { Color, Dimension, List } from '../value-eval.js';
import { colorHsl, colorRgbRounded, makeColorHsl, makeColorRgb } from '../value-factory.js';
import { HSL } from '../serialize-value.js';
import { clamp01, isColor, isModern, normalizeHue, percentOf } from './color-ctor-helper.js';
import type { NativeFn } from './types.js';

/**
 * `hsl` / `hsla` (alias) — CONSTRUCT an HSL-format color, or REFORMAT a color to
 * hsl. Byte-faithful to `less/hsl`: hue via `normalizeHue` (wrapped 0-360), s/l via
 * `percentOf(1)` clamped 0-1, optional alpha via `percentOf(1)`.
 *
 * The GREY canonical branch (`s === 0 || l === 0 || l === 1`) mirrors the legacy
 * impl: it rebuilds from the ROUNDED rgb (format still HSL), so the serialized hue
 * collapses to `0` and s/l reflect the rounded channel — e.g. `hsl(120, 0%, 50%)`
 * emits `hsl(0, 0%, 50.19607843%)` (the rounded 128/255). This DIVERGES from Less
 * 4.x (which emits `hsl(0, 0%, 50%)`); it is the jess-fns v5 adapter's behavior and
 * the differential holds native ≡ adapter here (flagged in-test).
 */
export function makeHsl(list: List): Color {
  const items = list.items;
  const modernSyntax = isModern(list);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    const h = normalizeHue(items[0] as Dimension);
    const s = clamp01(percentOf(items[1] as Dimension, 1));
    const l = clamp01(percentOf(items[2] as Dimension, 1));
    const a = items[3] !== undefined ? percentOf(items[3] as Dimension, 1) : 1;
    // SOURCE-FORMAT preservation (verbatim rule): keep the authored hue unit
    // (`0deg` → `deg`) + a `%` alpha spelling; an operated result drops them.
    const hueUnit = (items[0] as Dimension).unit || undefined;
    const alphaD = items[3] as Dimension | undefined;
    const alphaPct = alphaD !== undefined && alphaD.unit === '%' ? alphaD.number : undefined;
    const fmtOpts = { ...(hueUnit ? { hueUnit } : {}), ...(alphaPct !== undefined ? { alphaPct } : {}) };
    const hueColor = makeColorHsl([h, s, l], a, HSL, modernSyntax, fmtOpts);
    if (s === 0 || l === 0 || l === 1) {
      return makeColorRgb(colorRgbRounded(hueColor), a, HSL, { modernSyntax, ...(alphaPct !== undefined ? { alphaPct } : {}) });
    }
    return hueColor;
  }
  if (isColor(first)) {
    const c = first as Color;
    const a = items[1] !== undefined ? clamp01(percentOf(items[1] as Dimension, 1)) : c.alpha;
    return makeColorHsl(colorHsl(c), a, HSL, modernSyntax);
  }
  throw new Error('Invalid arguments for hsl function');
}

export const hsl: NativeFn = {
  name: 'hsl',
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list) => makeHsl(list),
};
