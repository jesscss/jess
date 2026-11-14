import type { Fn } from '@jesscss/core/value';
import { define, checkAny } from '@jesscss/core/value';
import { sameStringKind } from './string-result.js';

/**
 * Less `replace()` — replace text in a string using a JavaScript `RegExp`. The
 * result is the input's kind of string ({@link sameStringKind}).
 * @param input the string to search (serialized to text)
 * @param pattern the regular-expression source
 * @param replacement the replacement string (supports `$1` group refs)
 * @param flags optional regex flags (e.g. `g`, `i`)
 * @returns the transformed string
 */
export const replace: Fn = /* @__PURE__ */ define('replace', {
  params: [
    { type: 'any', check: checkAny },
    { type: 'any', check: checkAny },
    { type: 'any', check: checkAny },
    { type: 'any', check: checkAny, optional: true }
  ],
  variadic: true,
  body: (items, ctx) => {
    const input = items[0]!;
    const source = ctx.stringify(input);
    const pattern = ctx.stringify(items[1]!);
    const replacement = ctx.stringify(items[2]!);
    const flags = items[3] === undefined ? '' : ctx.stringify(items[3]!);
    return sameStringKind(input, source.replace(new RegExp(pattern, flags), replacement));
  }
});

export default replace;
