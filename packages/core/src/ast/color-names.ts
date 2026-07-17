/**
 * Shared CSS named-color table for the tree2 VALUE domain — the boundary-clean
 * twin of `tree/util/color-names.ts`. Maps a CSS color keyword (`red`,
 * `cornflowerblue`, …) plus `transparent` to `[r, g, b]` + `alpha`, so a
 * `LIT_COLOR_NAMED` literal can MATERIALIZE to a `Color` value when it is
 * operated on (`lighten(red, 10%)`, `iscolor(blue)`, …). Un-operated named
 * literals never reach here — they emit their verbatim `Word` bytes.
 *
 * The 148 named colors come from the `color-name` data package (also used by the
 * legacy table + `@jesscss/fns`), so the data is not duplicated. Case-insensitive.
 *
 * HARD MODULE BOUNDARY: no `../tree` import — only the `color-name` data dep.
 */
import colors from 'color-name';

const NAMED_RGB = colors as Record<string, [number, number, number]>;

export interface NamedColor {
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
}

/**
 * Resolve a CSS color keyword to rgb + alpha, or `undefined` for a non-color
 * identifier (so callers fall through to a plain keyword). `transparent` is the
 * one keyword with alpha 0. Byte-identical to `tree/util/color-names.ts`.
 */
export function namedColor(name: string): NamedColor | undefined {
  const key = name.toLowerCase();
  if (key === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const rgb = NAMED_RGB[key];
  return rgb ? { rgb: [rgb[0], rgb[1], rgb[2]], alpha: 1 } : undefined;
}
