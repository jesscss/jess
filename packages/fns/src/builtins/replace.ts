import type { Fn } from '@jesscss/core/value';
import { groupItems, isValueGroupArray, makeKeyword, makeQuoted, defineFunction } from '@jesscss/core/value';

/**
 * `replace(input, pattern, replacement, flags?)` — regex replace over the string
 * form of each arg (the `ctx.stringify` host hook = legacy `serializeNodeValue`).
 * A non-escaped Quoted input re-wraps in the same quote; anything else (an escaped
 * `~"…"` arrives as a Keyword) emits bare. Validated against Less 4.x — the legacy
 * `@jesscss/fns` adapter mishandles the reconstructed Quoted (doubles quotes), so
 * the differential asserts built-in = Less 4.x here, not built-in = adapter.
 */
export const replace: Fn = defineFunction('replace', {
  params: [{ kinds: 'any' }, { kinds: 'any' }, { kinds: 'any' }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list, ctx) => {
    const items = groupItems(list);
    const input = items[0]!;
    const source = ctx.stringify(input);
    const pattern = ctx.stringify(items[1]!);
    const replacement = ctx.stringify(items[2]!);
    const flags = items[3] !== undefined ? ctx.stringify(items[3]!) : '';
    const result = source.replace(new RegExp(pattern, flags), replacement);
    if (!isValueGroupArray(input) && input.type === 'Quoted' && !input.escaped) {
      return makeQuoted(result, input.quote, false);
    }
    return makeKeyword(result);
  }
});
