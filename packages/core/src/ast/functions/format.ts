import type { Quoted, ValueObj } from '../value-eval.js';
import { makeKeyword, makeQuoted } from '../value-factory.js';
import type { FnCtx, Fn } from './types.js';

/**
 * The value a `%[sda]` token substitutes, byte-faithful to Less 4.x `%`:
 *  - `s`/`S`: STRING form — a Quoted's inner text, else the value's bytes.
 *  - `d`/`a` (+ upper): CSS form — the value's bytes (a Quoted keeps its quotes).
 *  - an UPPER token URL-encodes the result (`encodeURIComponent`).
 */
function tokenValue(token: string, arg: ValueObj, ctx: FnCtx): string {
  const value = /s/i.test(token) ? ctx.stringify(arg) : arg.bytes;
  return /[A-Z]$/.test(token) ? encodeURIComponent(value) : value;
}

/**
 * `%(template, ...args)` (the `format` fn) — substitute each `%s`/`%d`/`%a`
 * directive (case-insensitive; upper = URL-encode) with the next arg, then unescape
 * `%%`. A non-escaped Quoted template re-wraps; else emits bare. Validated against
 * Less 4.x (the adapter mishandles reconstructed Quoted args).
 */
export const format: Fn = {
  name: '%',
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list, ctx) => {
    const items = list.items;
    const template = items[0]!;
    const args = items.slice(1);
    let result = ctx.stringify(template);
    for (const arg of args) {
      const m = /%[sda]/i.exec(result);
      if (!m) break;
      result = result.slice(0, m.index) + tokenValue(m[0], arg, ctx) + result.slice(m.index + m[0].length);
    }
    result = result.replace(/%%/g, '%');
    if (template.type === 'Quoted' && !(template as Quoted).escaped) {
      return makeQuoted(result, (template as Quoted).quote, false);
    }
    return makeKeyword(result);
  },
};
