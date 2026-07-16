/**
 * Native Tier-A functions rewritten on the tree2 value shape — no legacy nodes,
 * no re-parse, no `render()` walk. Ported byte-for-byte from `@jesscss/fns`
 * (`less/lighten`, `less/percentage`, `less/e`). These are the proof that the
 * kind-dispatch scaffold works end to end; the other ~50 fns are the NEXT wave.
 *
 * HARD MODULE BOUNDARY: value domain + factory only.
 */
import type { Color, Dimension, Keyword, Quoted, ValueObj } from './value-eval.js';
import { colorHsl, numOf, textOf, makeColorHsl, makeDimension, makeKeyword } from './value-factory.js';

/**
 * `lighten(color, amount, method?)`: read hsl (lazy source of truth), bump
 * lightness, preserve the original format. Byte-faithful to legacy `less/lighten`
 * (which builds the result from `{ hsl, alpha }` with only `format` preserved).
 */
export function lightenNative(color: Color, amount: Dimension, method?: Keyword | Quoted): Color {
  const [h, s, l] = colorHsl(color);
  let adjust = amount.number / 100;
  if (method !== undefined && textOf(method) === 'relative') adjust = l * adjust;
  return makeColorHsl([h, s, l + adjust], color.alpha, color.format);
}

/** `percentage(value)`: value * 100, forced to `%`. */
export function percentageNative(value: Dimension): Dimension {
  return makeDimension(numOf(value) * 100, '%');
}

/** `e(value)`: escape a quoted value (drop quotes) → bare keyword; else pass through. */
export function eNative(value: ValueObj): ValueObj {
  if (value.kind === 'quoted') return makeKeyword(value.value);
  return value;
}
