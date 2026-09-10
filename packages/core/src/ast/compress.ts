/**
 * Pure, classification-driven byte folds for `output.compress`. Every function
 * here receives a value whose CLASSIFICATION is already known (a hex color, a
 * dimension's canonical bytes, a composed selector header) — none re-tokenizes
 * or re-classifies a serialized value string to decide what it is. The serializer
 * calls these only in the `Color`/`Dimension`/selector positions where the node
 * type (or typed value) has already selected the fold.
 *
 * See docs/less/advanced/compressed-output.md for the settled spec.
 */
import { parseHex } from './literal-tag.js';
import { shortestColorName } from './color-names.js';

const hx = (v: number): string => {
  const h = (v & 255).toString(16);
  return h.length === 1 ? `0${h}` : h;
};

/**
 * Fold `#rrggbb`→`#rgb` and `#rrggbbaa`→`#rgba` when EACH channel's nibble pair
 * repeats (`#ffffff`→`#fff`, `#ffffffff`→`#ffff`); any other hex is returned
 * unchanged. Case-insensitive on the pair comparison; the returned digits keep
 * the input's own casing.
 */
function foldHex(hex: string): string {
  const body = hex.slice(1);
  if (body.length !== 6 && body.length !== 8) {
    return hex;
  }
  for (let i = 0; i < body.length; i += 2) {
    if (body[i]!.toLowerCase() !== body[i + 1]!.toLowerCase()) {
      return hex;
    }
  }
  let out = '#';
  for (let i = 0; i < body.length; i += 2) {
    out += body[i];
  }
  return out;
}

/**
 * The shortest spelling of a color from rgb ints (0-255) + alpha (0-1): the
 * shorter of its folded hex and a named color (opaque only). Ties keep the hex
 * (`#ffffff`→`#fff`, not `white`); a strictly-shorter name wins (`#ff0000`→`red`).
 */
export function shortestColor(r: number, g: number, b: number, alpha: number): string {
  const hex = `#${hx(r)}${hx(g)}${hx(b)}${alpha < 1 ? hx(Math.round(alpha * 255)) : ''}`;
  const folded = foldHex(hex);
  const name = shortestColorName(r, g, b, alpha);
  return name !== undefined && name.length < folded.length ? name : folded;
}

/**
 * The shortest spelling of a `#hex` COLOR LITERAL. The hex fold works on the
 * literal's OWN digits (so `#ffffffff`→`#ffff`, preserving the alpha nibble rather
 * than collapsing an opaque `aa` away); a named color substitutes only when the
 * color is opaque and the name is strictly shorter (`#ff0000`→`red`).
 */
export function shortestColorFromHex(src: string): string {
  const folded = foldHex(src.toLowerCase());
  const { rgb, alpha } = parseHex(src);
  const name = shortestColorName(rgb[0], rgb[1], rgb[2], alpha);
  return name !== undefined && name.length < folded.length ? name : folded;
}

/**
 * Trim a dimension's leading zero (`0.5`→`.5`, `-0.5`→`-.5`) and trailing
 * fractional zeros (`1.50`→`1.5`, `10.00px`→`10px`), KEEPING the unit (`0px`
 * stays `0px`). Operates on the Dimension value's already-canonical `bytes`, so
 * it is a spelling trim, not a re-parse; a spelling it does not recognize (an
 * exponent, a non-numeric leader) is returned unchanged.
 */
export function compressDimensionBytes(bytes: string): string {
  const m = /^([+-]?)(\d*)(\.\d+)?(.*)$/u.exec(bytes);
  if (m === null || (m[2] === '' && m[3] === undefined)) {
    return bytes;
  }
  const sign = m[1]!;
  let int = m[2]!;
  let frac = m[3] ?? '';
  const unit = m[4]!;
  if (frac !== '') {
    frac = frac.replace(/0+$/u, '');
    if (frac === '.') {
      frac = '';
    }
    if (frac !== '' && int === '0') {
      int = '';
    }
  }
  return `${sign}${int}${frac}${unit}`;
}

/**
 * Collapse combinator whitespace in a COMPOSED selector header (`.a > .b`→
 * `.a>.b`, `.a + .b`→`.a+.b`, `.a ~ .b`→`.a~.b`), leaving the descendant space
 * intact. Quote- and attribute-bracket-aware so a ` > ` inside `[title="a > b"]`
 * or a quoted string is never touched; combinators inside pseudo parens
 * (`:has(.a > .b)`) DO collapse. The header is a serializer-composed string, so
 * this is a whitespace transform, not a re-classification of the selector.
 */
export function compressSelectorHeader(header: string): string {
  if (header.indexOf(' ') === -1) {
    return header;
  }
  let out = '';
  let quote = '';
  let bracket = 0;
  for (let i = 0; i < header.length; i++) {
    const c = header[i]!;
    if (quote !== '') {
      out += c;
      if (c === quote) {
        quote = '';
      }
      continue;
    }
    if (c === '"' || c === '\'') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '[') {
      bracket++;
      out += c;
      continue;
    }
    if (c === ']') {
      bracket = bracket > 0 ? bracket - 1 : 0;
      out += c;
      continue;
    }
    if (
      bracket === 0
      && c === ' '
      && (header[i + 1] === '>' || header[i + 1] === '+' || header[i + 1] === '~')
      && header[i + 2] === ' '
    ) {
      out += header[i + 1];
      i += 2; // skip combinator + trailing space
      continue;
    }
    out += c;
  }
  return out;
}
