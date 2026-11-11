import type { Color, ValueGroup, Fn } from '@jesscss/core/value';
import { colorHsl, defineFunction, groupItems, makeColorHsl, HSL } from '@jesscss/core/value';
import { clamp01, fitsAny, isColor, isModern, normalizeHue, percentOf } from './color-ctor-helper.js';
import { ALPHA_ARG, channelSlot, declineSlots, hueSlot, isDeferredSlot, percentSlot } from './color-form.js';
import { requireDimension } from '../shared/math/math-helper.js';

/** A slot of `hsl()` as CSS holds it; the comma syntax has no number for saturation and lightness (css-color-4 §7). */
const hslSlot = (value: ValueGroup, index: number): ValueGroup =>
  index === 0 ? hueSlot(value) : index === 3 ? channelSlot(value) : percentSlot(value);

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
    /* `hsl(var(--h), 50%, 50%)` is CSS as written. */
    if (items.some(isDeferredSlot)) {
      declineSlots(items, hslSlot);
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

/** S or L, which after a colour (`hsl(#c00, @a)`) is an alpha the call reformats it with, with no form. */
const fitsAfterHue = (value: ValueGroup, vals: readonly ValueGroup[]): boolean => fitsAny(value) && !isColor(vals[0]);

/** The slots of `hsl()` and `hsla()`, by what an export in each means over its `var()`: a colour there has no form. */
export const HSL_PARAMS = [
  { type: 'any', fits: (value: ValueGroup): boolean => fitsAny(value) && !isColor(value) },
  { type: 'any', optional: true, fits: fitsAfterHue },
  { type: 'any', optional: true, fits: fitsAfterHue },
  { type: 'any', optional: true, fits: ALPHA_ARG.fits }
] as const;

export const hsl: Fn = /* @__PURE__ */ defineFunction('hsl', {
  params: HSL_PARAMS,
  variadic: true,
  body: list => makeHsl(list)
});
