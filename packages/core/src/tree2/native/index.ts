/**
 * NATIVE Tier-A function registry — the single ASSEMBLY point.
 *
 * Each fn lives in its OWN module (`./ceil.js`, `./pow.js`, …) and exports a
 * self-describing `NativeFn` (name + param spec + body). This file gathers them
 * into `NATIVE_FN_LIST`, which `value-dispatch.ts` turns into the dispatch Map.
 * Per-fn modules keep the set tree-shakeable (a bundle only pulls the fns it
 * references) and this list keeps registration additive (minimal shared-file
 * churn between conversion batches).
 *
 * ┌─ HOW TO ADD A FN (the 3-line recipe) ─────────────────────────────────────┐
 * │ 1. Create `native/<fn>.ts` exporting `export const <fn>: NativeFn = {…}`.  │
 * │ 2. `import { <fn> } from './<fn>.js';` below.                              │
 * │ 3. Add `<fn>` to `NATIVE_FN_LIST`.                                         │
 * │ Then extend the differential test with a case per fn (adapter = oracle).   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { NativeFn } from './types.js';

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
// --- proof set (converted pre-batch; color = a LATER batch) ---
import { lighten } from './lighten.js';
import { e } from './e.js';

/** Every native Tier-A fn, in registration order. */
export const NATIVE_FN_LIST: readonly NativeFn[] = [
  round, ceil, floor, abs, sqrt, pow, mod,
  pi, percentage, unit, convert,
  sin, cos, tan, asin, acos, atan,
  range,
  lighten, e,
];

export type { FnSpec, NativeFn, ParamSpec, Kind } from './types.js';
