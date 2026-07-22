import { makeKeyword, defineFunction } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/**
 * `escape(value)` — URL-encode the string form of `value` (`ctx.stringify` = legacy
 * `serializeNodeValue`): `encodeURI` then the extra chars less.js escapes
 * (`=`,`:`,`#`,`;`,`(`,`)`). Emits a bare keyword. Validated against Less 4.x (the
 * adapter mishandles the reconstructed Quoted and encodes its quotes).
 */
export const escape: Fn = defineFunction('escape', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list, ctx) => {
    const raw = ctx.stringify(list.value[0]!);
    const encoded = encodeURI(raw)
      .replace(/=/g, '%3D')
      .replace(/:/g, '%3A')
      .replace(/#/g, '%23')
      .replace(/;/g, '%3B')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    return makeKeyword(encoded);
  }
});
