import { Color, ColorFormat } from '@jesscss/core';

/**
 * Whether a color keeps its HEX spelling when an alpha operation makes it
 * translucent. A hex literal preserves HEX form ONLY when it already encoded an
 * alpha channel (`#rgba` / `#rrggbbaa`); an opaque hex (`#rgb` / `#rrggbb`)
 * becomes `rgba(…)` the moment it turns translucent — matching Less 4.x/v5
 * (`fadeout(#ff0, 50%)` → `rgba(255, 255, 0, 0.5)`, but `fade(#5F59, 10%)` →
 * `#55ff551a`).
 */
export function preserveHexUnderAlpha(color: Color, inputNode: string | undefined): boolean {
  if (color.options.format !== ColorFormat.HEX) return false;
  if (inputNode === undefined || !inputNode.startsWith('#')) return false;
  const hexDigits = inputNode.length - 1;
  return hexDigits === 4 || hexDigits === 8;
}
