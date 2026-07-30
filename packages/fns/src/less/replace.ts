import type { Fn } from '@jesscss/core';
import {
  defineFunction,
  groupItems,
  isValueGroupArray,
  makeKeyword,
  makeQuoted
} from '@jesscss/core';

/**
 * Less `replace()` — replace text in a string using a JavaScript `RegExp`. The
 * result keeps the input's quoting when it is a non-escaped `Quoted`; otherwise it
 * is returned as an unquoted keyword value.
 * @param input the string to search (serialized to text)
 * @param pattern the regular-expression source
 * @param replacement the replacement string (supports `$1` group refs)
 * @param flags optional regex flags (e.g. `g`, `i`)
 * @returns the transformed string
 */
export const replace: Fn = defineFunction('replace', {
  params: [
    { type: 'any' },
    { type: 'any' },
    { type: 'any' },
    { type: 'any', optional: true }
  ],
  variadic: true,
  body: (list, ctx) => {
    const items = groupItems(list);
    const input = items[0]!;
    const source = ctx.stringify(input);
    const pattern = ctx.stringify(items[1]!);
    const replacement = ctx.stringify(items[2]!);
    const flags = items[3] === undefined ? '' : ctx.stringify(items[3]!);
    const result = source.replace(new RegExp(pattern, flags), replacement);

    if (!isValueGroupArray(input) && input.type === 'Quoted' && !input.escaped) {
      return makeQuoted(result, input.quote, false);
    }
    return makeKeyword(result);
  }
});

export default replace;
