import type { FnCtx, ValueGroup } from '@jesscss/core/value';
import { checkAny, define, makeKeyword, makeList } from '@jesscss/core/value';
import { selectorBranchHasAmpersand, simpleTokenText } from '@jesscss/core/ast';
import { readSelector } from './parse.js';

/**
 * Sass `selector.simple-selectors($selector)` / the global `simple-selectors()`:
 * the simple selectors of one compound selector, as a comma list of unquoted
 * strings. A list, a complex selector or a selector that opens with a combinator
 * is not a compound, and is reported as one before a `&` is.
 */
export function simpleSelectorsValue(items: readonly ValueGroup[], ctx: FnCtx): ValueGroup {
  if (items.length > 1) {
    throw new TypeError(`Only 1 argument allowed, but ${items.length} were passed.`);
  }
  const branches = readSelector(items[0], ctx, '$selector: ', true);
  const branch = branches[0]!;
  if (branch.type === 'RelativeSelector') {
    throw new TypeError('$selector: Expected identifier.');
  }
  if (branches.length > 1 || branch.type === 'ComplexSelector') {
    throw new TypeError('$selector: expected selector.');
  }
  if (selectorBranchHasAmpersand(branch)) {
    throw new TypeError('$selector: Parent selectors aren\'t allowed here.');
  }
  const simples = branch.type === 'CompoundSelector' ? branch.value : [branch];
  return makeList(simples.map(simple => makeKeyword(simpleTokenText(simple))), ',');
}

const simpleSelectors = define('simple-selectors', {
  params: [{ name: 'selector', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: simpleSelectorsValue
});

export default simpleSelectors;
