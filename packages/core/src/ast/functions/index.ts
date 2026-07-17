/**
 * Built-in Tier-A function registry — the single ASSEMBLY point.
 *
 * Each fn lives in its OWN module (`./ceil.js`, `./pow.js`, …) and exports a
 * self-describing `Fn` (name + param spec + body). This file gathers them
 * into `FN_LIST`, which `value-dispatch.ts` turns into the dispatch Map.
 * Per-fn modules keep the set tree-shakeable (a bundle only pulls the fns it
 * references) and this list keeps registration additive (minimal shared-file
 * churn between conversion batches).
 *
 * ┌─ HOW TO ADD A FN (the 3-line recipe) ─────────────────────────────────────┐
 * │ 1. Create `functions/<fn>.ts` exporting `export const <fn>: Fn = {…}`.  │
 * │ 2. `import { <fn> } from './<fn>.js';` below.                              │
 * │ 3. Add `<fn>` to `FN_LIST`.                                         │
 * │ Then extend the differential test with a case per fn (adapter = oracle).   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Fn } from './types.js';

// --- math: rounding / sign / roots / powers ---
import { round } from './round.js';
import { ceil } from './ceil.js';
import { floor } from './floor.js';
import { abs } from './abs.js';
import { sqrt } from './sqrt.js';
import { pow } from './pow.js';
import { mod } from './mod.js';
// --- math: constants / percentage / unit ---
import { pi } from './pi.js';
import { percentage } from './percentage.js';
import { unit } from './unit.js';
import { convert } from './convert.js';
// --- math: trigonometry (angle-normalized) ---
import { sin } from './sin.js';
import { cos } from './cos.js';
import { tan } from './tan.js';
import { asin } from './asin.js';
import { acos } from './acos.js';
import { atan } from './atan.js';
// --- list (Tier-A: pure value→value, constructs its own list; no eval context) ---
import { range } from './range.js';
// --- list / variadic (materialize flattened list structure; oracle = Less 4.x) ---
import { length } from './length.js';
import { extract } from './extract.js';
import { min } from './min.js';
import { max } from './max.js';
// --- color: hsl adjusters (lighten = proof; darken/saturate/… = this batch) ---
import { lighten } from './lighten.js';
import { darken } from './darken.js';
import { saturate } from './saturate.js';
import { desaturate } from './desaturate.js';
import { spin } from './spin.js';
import { greyscale } from './greyscale.js';
// --- color: alpha adjusters ---
import { fade } from './fade.js';
import { fadein } from './fadein.js';
import { fadeout } from './fadeout.js';
// --- color: mixers ---
import { mix } from './mix.js';
import { tint } from './tint.js';
import { shade } from './shade.js';
// --- color: channel getters (rgb / alpha) ---
import { red } from './red.js';
import { green } from './green.js';
import { blue } from './blue.js';
import { alpha } from './alpha.js';
// --- color: hsl / hsv / luma readers ---
import { hue } from './hue.js';
import { saturation } from './saturation.js';
import { lightness } from './lightness.js';
import { luma } from './luma.js';
import { luminance } from './luminance.js';
import { hsvhue } from './hsvhue.js';
import { hsvsaturation } from './hsvsaturation.js';
import { hsvvalue } from './hsvvalue.js';
// --- color: luma-threshold pick ---
import { contrast } from './contrast.js';
// --- color: blend modes (two colors → color; per-channel over color-helper's
//     `colorBlend` kernel). overlay reuses multiply+screen; hardlight reuses overlay. ---
import { multiply } from './multiply.js';
import { screen } from './screen.js';
import { overlay } from './overlay.js';
import { softlight } from './softlight.js';
import { hardlight } from './hardlight.js';
import { difference } from './difference.js';
import { exclusion } from './exclusion.js';
import { average } from './average.js';
import { negation } from './negation.js';
// --- color: constructors / string producers (Tier-B — need modern-syntax /
//     serialize context; overloaded arity → variadic) ---
import { rgb } from './rgb.js';
import { rgba } from './rgba.js';
import { hsl } from './hsl.js';
import { hsla } from './hsla.js';
import { hsv } from './hsv.js';
import { hsva } from './hsva.js';
import { argb } from './argb.js';
import { color } from './color.js';
// --- string producers (Tier-B — need the value→string serialize hook) ---
import { replace } from './replace.js';
import { format } from './format.js';
import { escape } from './escape.js';
// --- misc ---
import { e } from './e.js';

/** Every built-in Tier-A fn, in registration order. */
export const FN_LIST: readonly Fn[] = [
  round, ceil, floor, abs, sqrt, pow, mod,
  pi, percentage, unit, convert,
  sin, cos, tan, asin, acos, atan,
  range, length, extract, min, max,
  lighten, darken, saturate, desaturate, spin, greyscale,
  fade, fadein, fadeout,
  mix, tint, shade,
  red, green, blue, alpha,
  hue, saturation, lightness, luma, luminance,
  hsvhue, hsvsaturation, hsvvalue,
  contrast,
  multiply, screen, overlay, softlight, hardlight, difference, exclusion, average, negation,
  rgb, rgba, hsl, hsla, hsv, hsva, argb, color,
  replace, format, escape,
  e,
];

export type { FnSpec, Fn, ParamSpec, Kind } from './types.js';
