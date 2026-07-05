import colors from 'color-name';

/**
 * The 148 CSS named colors as `[r, g, b]`, sourced from the `color-name`
 * data package (also used by `@jesscss/fns`) so the table isn't duplicated.
 */
const NAMED_RGB = colors as Record<string, [number, number, number]>;

export interface NamedColor {
  rgb: [number, number, number];
  alpha: number;
}

/**
 * Resolve a CSS color keyword (e.g. `yellow`, `transparent`) to rgb + alpha.
 * Returns `undefined` for anything that isn't a named color, so callers can
 * fall through to hex parsing. Case-insensitive.
 */
export function namedColor(name: string): NamedColor | undefined {
  const key = name.toLowerCase();
  if (key === 'transparent') {
    return { rgb: [0, 0, 0], alpha: 0 };
  }
  const rgb = NAMED_RGB[key];
  return rgb ? { rgb: [rgb[0], rgb[1], rgb[2]], alpha: 1 } : undefined;
}
