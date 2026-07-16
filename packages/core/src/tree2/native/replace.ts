import type { Quoted } from '../value-eval.js';
import { makeKeyword, makeQuoted } from '../value-factory.js';
import type { NativeFn } from './types.js';

/**
 * `replace(input, pattern, replacement, flags?)` — regex replace over the string
 * form of each arg (the `ctx.stringify` host hook = legacy `serializeNodeValue`).
 * A non-escaped Quoted input re-wraps in the same quote; anything else (an escaped
 * `~"…"` arrives as a Keyword) emits bare. Validated against Less 4.x — the legacy
 * `@jesscss/fns` adapter mishandles the reconstructed Quoted (doubles quotes), so
 * the differential asserts native = Less 4.x here, not native = adapter.
 */
export const replace: NativeFn = {
  name: 'replace',
  params: [{ kinds: 'any' }, { kinds: 'any' }, { kinds: 'any' }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list, ctx) => {
    const items = list.items;
    const input = items[0]!;
    const source = ctx.stringify(input);
    const pattern = ctx.stringify(items[1]!);
    const replacement = ctx.stringify(items[2]!);
    const flags = items[3] !== undefined ? ctx.stringify(items[3]!) : '';
    const result = source.replace(new RegExp(pattern, flags), replacement);
    if (input.kind === 'quoted' && !(input as Quoted).escaped) {
      return makeQuoted(result, (input as Quoted).quote, false);
    }
    return makeKeyword(result);
  },
};
