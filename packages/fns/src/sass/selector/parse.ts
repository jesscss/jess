import type { FnCtx, ValueGroup } from '@jesscss/core/value';
import { isValueGroupArray, selectorValue, define, checkAny } from '@jesscss/core/value';
import { selectorBranchComponents, selectorBranchHasAmpersand, type SelectorBranch } from '@jesscss/core/ast';

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
    case 'Arithmetic':
    case 'FunctionCall': return value.bytes;
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
 * A `$selector` argument read as Sass's selector functions read one: the
 * selector text it holds ({@link selectorText}) read by the stylesheet dialect's
 * own selector-list production, which its plugin hands over as
 * `ctx.parseSelector`. Throws with Dart Sass's message, after `prefix` (the
 * argument's name, where Dart Sass names it), for a value that holds no selector
 * text, a string that is not a selector list, or, unless `parents` is set, a `&`.
 */
export function readSelector(selector: ValueGroup | undefined, ctx: FnCtx, prefix = '', parents = false): readonly SelectorBranch[] {
  const text = selector === undefined ? null : selectorText(selector);
  if (text === null) {
    const written = selector === undefined ? 'nothing' : !isValueGroupArray(selector) && selector.type === 'Null' ? 'null' : ctx.stringify(selector);
    throw new TypeError(`${prefix}${written} is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.`);
  }
  if (ctx.parseSelector === undefined) {
    throw new TypeError('Sass selector functions need a selector parser, which this stylesheet dialect does not provide.');
  }
  const branches = ctx.parseSelector(text);
  if (branches === null) {
    throw new TypeError(`${prefix}expected selector.`);
  }
  if (!parents && branches.some(selectorBranchHasAmpersand)) {
    throw new TypeError(`${prefix}Parent selectors aren't allowed here.`);
  }
  return branches;
}

/**
 * Sass `selector.parse($selector)` / the global `selector-parse()`: the
 * selector a string holds, as the value `&` is (a comma list of space lists of
 * compound selectors and combinators).
 */
export function parseSelectorValue(items: readonly ValueGroup[], ctx: FnCtx): ValueGroup {
  if (items.length > 1) {
    throw new TypeError(`Only 1 argument allowed, but ${items.length} were passed.`);
  }
  return selectorValue(readSelector(items[0], ctx, '$selector: ').map(selectorBranchComponents));
}

const parse = define('parse', {
  params: [{ name: 'selector', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: parseSelectorValue
});

export default parse;
