import type { FnCtx, ValueGroup } from '@jesscss/core';
import { defineFunction, groupItems, isValueGroupArray, selectorValue } from '@jesscss/core';

/**
 * The text Sass reads a `$selector` argument as: a string, a space list of
 * strings, or a comma list of those (an `&` value, or what `selector.parse()`
 * returned, reads back as the selector it is). Anything else, a list nested
 * deeper included (`((c,),)`), is `null`. `level` is where the value sits: the
 * argument (0), a comma list's item (1), a space list's item (2, a string).
 */
function selectorText(value: ValueGroup, level = 0): string | null {
  if (isValueGroupArray(value)) {
    return level < 2 ? joinTexts(value, ' ', 2) : null;
  }
  switch (value.type) {
    case 'Quoted': return value.value;
    case 'Keyword': return value.text;
    case 'List':
      if (value.sep === '/' || level === 2 || (level === 1 && value.sep === ',')) {
        return null;
      }
      return value.sep === ',' ? joinTexts(value.value, ', ', 1) : joinTexts(value.value, ' ', 2);
    case 'Block': return value.delimiter === 'paren' ? selectorText(value.value, level) : null;
    default: return null;
  }
}

function joinTexts(items: readonly ValueGroup[], separator: string, level: number): string | null {
  let text = '';
  for (const item of items) {
    const part = selectorText(item, level);
    if (part === null) {
      return null;
    }
    text += text === '' ? part : separator + part;
  }
  return text;
}

/**
 * Sass `selector.parse($selector)` / the global `selector-parse()`: the
 * selector a string holds, as the value `&` is (a comma list of space lists of
 * compound selectors and combinators). The string is read by the stylesheet
 * dialect's own selector-list production, which its plugin hands over as
 * `ctx.parseSelector`; a string that is not a selector list throws with Dart
 * Sass's message.
 */
export function parseSelectorValue(args: ValueGroup, ctx: FnCtx): ValueGroup {
  const items = groupItems(args);
  if (items.length > 1) {
    throw new TypeError(`Only 1 argument allowed, but ${items.length} were passed.`);
  }
  const selector = items[0];
  const text = selector === undefined ? null : selectorText(selector);
  if (text === null) {
    const written = selector === undefined ? 'nothing' : ctx.stringify(selector);
    throw new TypeError(`$selector: ${written} is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.`);
  }
  if (ctx.parseSelector === undefined) {
    throw new TypeError('selector.parse() needs a selector parser, which this stylesheet dialect does not provide.');
  }
  return selectorValue(ctx.parseSelector(text));
}

const parse = defineFunction('parse', {
  params: [{ name: 'selector', type: 'any' }] as const,
  variadic: true,
  body: parseSelectorValue
});

export default parse;
