import type { Color, List, Fn } from '@jesscss/core/value';
import { colorHsl, defineFunction, makeColorHsl, makeColorRgb, hslToRgb, HSL } from '@jesscss/core/value';
import { clamp01, isColor, isModern, normalizeHue, percentOf } from './color-ctor-helper.js';
import { requireDimension } from './math-helper.js';

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
export function makeHsl(list: List): Color {
  const items = list.value;
  const modernSyntax = isModern(list);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    const h = normalizeHue(requireDimension(items[0]));
    const s = clamp01(percentOf(requireDimension(items[1]), 1));
    const l = clamp01(percentOf(requireDimension(items[2]), 1));
    const a = items[3] !== undefined ? percentOf(requireDimension(items[3]), 1) : 1;
    const alphaD = items[3] !== undefined ? requireDimension(items[3]) : undefined;
    const alphaPct = alphaD?.unit === '%' ? alphaD.number : undefined;
    // ACHROMATIC canonicalization (Less 4.x/v5 parity): a grey/black/white result
    // (`s === 0 || l === 0 || l === 1`) carries no meaningful hue/saturation, so it
    // round-trips through rgb — hue + saturation collapse to `0` and the authored
    // unit is dropped (`hsl(380deg, 150%, 150%)` → `hsl(0, 0%, 100%)`). The rgb is
    // kept UNROUNDED so the derived lightness is lossless (`hsl(50, 0%, 33%)` →
    // `hsl(0, 0%, 33%)`, not `33.…%`).
    if (s === 0 || l === 0 || l === 1) {
      return makeColorRgb(hslToRgb(h, s, l), a, HSL, {
        modernSyntax,
        ...(alphaPct !== undefined ? { alphaPct } : {})
      });
    }
    // SOURCE-FORMAT preservation (verbatim rule): keep the authored hue unit
    // (`0deg` → `deg`) + a `%` alpha spelling; an operated result drops them.
    const hueUnit = requireDimension(items[0]).unit || undefined;
    const fmtOpts = { ...(hueUnit ? { hueUnit } : {}), ...(alphaPct !== undefined ? { alphaPct } : {}) };
    return makeColorHsl([h, s, l], a, HSL, modernSyntax, fmtOpts);
  }
  if (isColor(first)) {
    const c = first;
    const a = items[1] !== undefined ? clamp01(percentOf(requireDimension(items[1]), 1)) : c.alpha;
    return makeColorHsl(colorHsl(c), a, HSL, modernSyntax);
  }
  throw new Error('Invalid arguments for hsl function');
}

export const hsl: Fn = defineFunction('hsl', {
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: list => makeHsl(list)
});
