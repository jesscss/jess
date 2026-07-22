/**
 * Built-in Less function set — the single ASSEMBLY point (AST-v2 value domain).
 *
 * Each fn lives in its OWN module (`./ceil.js`, `./pow.js`, …) and exports a
 * self-describing `Fn` (name + param spec + body). This file gathers them into
 * `builtinLessFns` (successor to core's former `FN_LIST`), which a consumer turns
 * into a dispatch registry via `createFnRegistry().registerAll(builtinLessFns)`.
 * Per-fn modules keep the set tree-shakeable (a bundle only pulls the fns it
 * references) and this list keeps registration additive.
 *
 * These bodies operate purely on `@jesscss/core/value` value objects — no legacy
 * tree nodes, no `defineFunction`, no `Context`. The single import edge is
 * `fns → core` via the narrow `@jesscss/core/value` substrate.
 *
 * ┌─ HOW TO ADD A FN (the 3-line recipe) ─────────────────────────────────────┐
 * │ 1. Create `builtins/<fn>.ts` exporting `export const <fn>: Fn = {…}`.      │
 * │ 2. `import { <fn> } from './<fn>.js';` below.                              │
 * │ 3. Add `<fn>` to `builtinLessFns`.                                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import type { Fn } from '@jesscss/core/value';

// --- math: rounding / sign / roots / powers ---
import { round } from '../less/round.js';
import { ceil } from '../less/ceil.js';
import { floor } from '../less/floor.js';
import { abs } from '../less/abs.js';
import { sqrt } from './sqrt.js';
import { pow } from './pow.js';
import { mod } from './mod.js';
// --- math: constants / percentage / unit ---
import { pi } from './pi.js';
import { percentage } from './percentage.js';
import { unit } from './unit.js';
import { getUnit } from './get-unit.js';
import { convert } from './convert.js';
// --- math: trigonometry (angle-normalized) ---
import { sin } from './sin.js';
import { cos } from './cos.js';
import { tan } from './tan.js';
import { asin } from './asin.js';
import { acos } from '../less/acos.js';
import { atan } from './atan.js';
// --- list (Tier-A: pure value→value, constructs its own list; no eval context) ---
import { range } from './range.js';
// --- list / variadic (materialize flattened list structure; oracle = Less 4.x) ---
import length from '../less/length.js';
import extract from '../less/extract.js';
import min from '../less/min.js';
import max from '../less/max.js';
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
import { format, formatPercent } from './format.js';
import { escape } from './escape.js';
// --- type-introspection predicates (is*) ---
import {
  iscolor, isnumber, isstring, iskeyword, isunit, ispixel, ispercentage, isem
} from './type-predicates.js';
// --- url producers (Tier-C — self-contained; no file IO) ---
import { svgGradient } from './svg-gradient.js';
// --- IO producers (Tier-C — read a referenced file via the injected `FnCtx.io`) ---
import { dataUri } from './data-uri.js';
import { imageSize } from './image-size.js';
import { imageWidth } from './image-width.js';
import { imageHeight } from './image-height.js';
// --- misc ---
import { e } from './e.js';

/** Every built-in Less fn, in registration order. Successor to core's `FN_LIST`. */
export const builtinLessFns: readonly Fn[] = [
  round, ceil, floor, abs, sqrt, pow, mod,
  pi, percentage, unit, getUnit, convert,
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
  replace, format, formatPercent, escape,
  iscolor, isnumber, isstring, iskeyword, isunit, ispixel, ispercentage, isem,
  svgGradient,
  dataUri, imageSize, imageWidth, imageHeight,
  e
];

export type { Fn, FnSpec, ParamSpec, Kind } from '@jesscss/core/value';
