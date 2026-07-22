import type { ValueGroup, ValueObj, FnCtx, Fn } from '@jesscss/core/value';
import { emitValue, groupItems, isValueGroupArray, makeKeyword, makeQuoted, defineFunction } from '@jesscss/core/value';

/**
 * The value a `%[sda]` token substitutes, byte-faithful to Less 4.x `%`:
 *  - `s`/`S`: STRING form — a Quoted's inner text, else the value's bytes.
 *  - `d`/`a` (+ upper): CSS form — the value's bytes (a Quoted keeps its quotes).
 *  - an UPPER token URL-encodes the result (`encodeURIComponent`).
 */
function tokenValue(token: string, arg: ValueGroup, ctx: FnCtx): string {
  const value = /s/i.test(token) ? ctx.stringify(arg) : emitValue(arg);
  return /[A-Z]$/.test(token) ? encodeURIComponent(value) : value;
}

/**
 * The string-format kernel — substitute each `%s`/`%d`/`%a` directive
 * (case-insensitive; upper = URL-encode) with the next arg, then unescape `%%`. A
 * non-escaped Quoted template re-wraps; else emits bare. Validated against Less 4.x
 * (the adapter mishandles reconstructed Quoted args).
 */
const formatKernel = (list: ValueGroup, ctx: FnCtx): ValueObj => {
  const items = groupItems(list);
  const template = items[0]!;
  const args = items.slice(1);
  let result = ctx.stringify(template);
  for (const arg of args) {
    const m = /%[sda]/i.exec(result);
    if (!m) {
      break;
    }
    result = result.slice(0, m.index) + tokenValue(m[0], arg, ctx) + result.slice(m.index + m[0].length);
  }
  result = result.replace(/%%/g, '%');
  if (!isValueGroupArray(template) && template.type === 'Quoted' && !template.escaped) {
    return makeQuoted(result, template.quote, false);
  }
  return makeKeyword(result);
};

const FORMAT_PARAMS: Fn['params'] = [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }];

/**
 * `string-format(template, ...args)` — the public Less string-format fn. The
 * `%(…)` call syntax lowers to this whole-word name at parse (owner: Less uses
 * whole-word fn names — `data-uri`, `svg-gradient` — not Sass's `str-` abbreviation).
 */
export const format: Fn = defineFunction('string-format', {
  params: FORMAT_PARAMS,
  variadic: true,
  body: formatKernel
});

/**
 * `%` — retained COMPAT alias of the `string-format` kernel. `%` is no longer the
 * internal id (that is `string-format`); this alias keeps the legacy tree's dynamic
 * `%()` fallback (`_buildFormatCall`'s non-literal `Call('%')`) resolvable.
 */
export const formatPercent: Fn = defineFunction('%', {
  params: FORMAT_PARAMS,
  variadic: true,
  body: formatKernel
});
