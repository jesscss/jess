import type { FnCtx, ValueGroup } from '@jesscss/core';
import { defineFunction, groupItems, isValueGroupArray, selectorListValue } from '@jesscss/core';

/**
 * The text Sass reads a `$selector` argument as: a string, a space list of
 * strings, or a comma list of those (an `&` value, or what `selector.parse()`
 * returned, reads back as the selector it is). Anything else is `null`.
 */
function selectorText(value: ValueGroup): string | null {
  if (isValueGroupArray(value)) {
    return joinTexts(value, ' ');
  }
  switch (value.type) {
    case 'Quoted': return value.value;
    case 'Keyword': return value.text;
    case 'List': return value.sep === '/' ? null : joinTexts(value.value, value.sep === ',' ? ', ' : ' ');
    case 'Block': return value.delimiter === 'paren' ? selectorText(value.value) : null;
    default: return null;
  }
}

function joinTexts(items: readonly ValueGroup[], separator: string): string | null {
  let text = '';
  for (const item of items) {
    const part = selectorText(item);
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
  return selectorListValue(ctx.parseSelector(text));
}

const parse = defineFunction('parse', {
  params: [{ name: 'selector', type: 'any' }] as const,
  variadic: true,
  body: parseSelectorValue
});

export default parse;
