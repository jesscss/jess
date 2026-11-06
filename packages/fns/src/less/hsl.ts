import type { Color, ValueGroup, Fn } from '@jesscss/core/value';
import { colorHsl, defineFunction, FunctionDeclined, groupItems, makeColorHsl, HSL } from '@jesscss/core/value';
import { clamp01, inUnits, isColor, isModern, normalizeHue, percentOf } from './color-ctor-helper.js';
import { ALPHA_ARG, CHANNEL_UNITS, HUE_UNITS, isDeferredSlot, PERCENT_ARG } from './color-form.js';
import { requireDimension } from '../shared/math/math-helper.js';

/** What CSS takes in a slot of `hsl()`; the comma syntax has no number for saturation and lightness (css-color-4 §7). */
const slotUnits = (index: number): readonly string[] =>
  index === 0 ? HUE_UNITS : index === 3 ? CHANNEL_UNITS : ['%'];

/**
 * `hsl` / `hsla` (alias) — CONSTRUCT an HSL-format color, or REFORMAT a color to
 * hsl. hue via `normalizeHue` (wrapped 0-360), s/l via `percentOf(1)` clamped 0-1,
 * optional alpha via `percentOf(1)`.
 *
 * VERBATIM rule (A6 `V5-OUTPUT-SEMANTICS.md`, `memory:css-superset-verbatim-passthrough`):
 * an un-operated `hsl()`/`hsla()` with literal args is a BARE value — it keeps its
 * authored h/s/l EXACTLY (the twin of `rgb`'s `rgbPct` source preservation), so
 * `hsl(50, 0%, 50%)` emits `hsl(50, 0%, 50%)`. It does NOT round-trip through the
 * rounded rgb (which collapsed the hue to `0` and mangled precision, e.g. the old
 * grey-canonical `hsl(0, 0%, 50.19607843%)`). A real Less operation
 * (`lighten(hsl(...))`, arithmetic) still rebuilds the color and recomputes.
 */
export function makeHsl(value: ValueGroup): Color {
  const items = groupItems(value);
  const modernSyntax = isModern(value);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    /* `hsl(var(--h), 50%, 50%)` is CSS as written. Every other slot still has to be what CSS takes there. */
    if (items.some(isDeferredSlot)) {
      items.forEach((item, index) => {
        if (!isDeferredSlot(item) && !inUnits(requireDimension(item), slotUnits(index))) {
          throw new TypeError('hsl: a hue is a number or an angle, saturation and lightness are percentages, and an alpha is a number or a percentage');
        }
      });
      throw new FunctionDeclined();
    }
    const h = normalizeHue(requireDimension(items[0]));
    const s = clamp01(percentOf(requireDimension(items[1]), 1));
    const l = clamp01(percentOf(requireDimension(items[2]), 1));
    const a = items[3] !== undefined ? percentOf(requireDimension(items[3]), 1) : 1;
    const alphaD = items[3] !== undefined ? requireDimension(items[3]) : undefined;
    const alphaPct = alphaD?.unit === '%' ? alphaD.number : undefined;

    /*
     * The authored hue unit (`0deg` → `deg`) and a `%` alpha spelling are kept
     * (verbatim rule), a grey's, black's and white's as any other's; an operated
     * result drops them.
     */
    const hueUnit = requireDimension(items[0]).unit || undefined;
    return makeColorHsl([h, s, l], a, HSL, modernSyntax, { ...(hueUnit ? { hueUnit } : {}), ...(alphaPct !== undefined ? { alphaPct } : {}) });
  }
  if (isColor(first)) {
    const c = first;
    const a = items[1] !== undefined ? clamp01(percentOf(requireDimension(items[1]), 1)) : c.alpha;
    return makeColorHsl(colorHsl(c), a, HSL, modernSyntax);
  }
  throw new Error('Invalid arguments for hsl function');
}

/** The slots of `hsl()` and `hsla()`, by what an export in each means over its `var()`: a colour there has no form. */
export const HSL_PARAMS = [
  { type: 'any', fits: (value: ValueGroup): boolean => !isColor(value) && inUnits(value, HUE_UNITS) },
  { type: 'any', optional: true, fits: PERCENT_ARG.fits },
  { type: 'any', optional: true, fits: PERCENT_ARG.fits },
  { type: 'any', optional: true, fits: ALPHA_ARG.fits }
] as const;

export const hsl: Fn = defineFunction('hsl', {
  params: HSL_PARAMS,
  variadic: true,
  body: list => makeHsl(list)
});
