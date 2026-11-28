import type { FnCtx, ValueGroup } from '@jesscss/core/value';
import { checkAny, define, selectorValue } from '@jesscss/core/value';
import { extendSelectorList, selectorBranchComponents } from '@jesscss/core/ast';
import { readSelector } from './parse.js';

/**
 * Sass `selector.extend($selector, $extendee, $extender)` / the global
 * `selector-extend()`: `$selector` as `$extender { @extend $extendee; }` extends
 * it. The extend is the stylesheet's own (ledger X3: a match within a compound is
 * written as an `:is()` graft), so `.a.b` extended by `.c` at `.a` is
 * `:is(.a, .c).b`, where Dart Sass writes `.a.b, .b.c`.
 */
export function extendValue(items: readonly ValueGroup[], ctx: FnCtx): ValueGroup {
  if (items.length > 3) {
    throw new TypeError(`Only 3 arguments allowed, but ${items.length} were passed.`);
  }
  if (items.length < 3) {
    throw new TypeError(`Missing argument ${items.length < 2 ? '$extendee' : '$extender'}.`);
  }
  const selector = readSelector(items[0], ctx, '$selector: ');
  const targets = readSelector(items[1], ctx, '$extendee: ');
  for (const target of targets) {
    if (target.type === 'ComplexSelector' || target.type === 'RelativeSelector') {
      throw new TypeError(`Can't extend complex selector ${selectorBranchComponents(target).join(' ')}.`);
    }
  }
  const extended = extendSelectorList(selector, targets, readSelector(items[2], ctx, '$extender: '));
  return selectorValue(extended ?? selector.map(selectorBranchComponents));
}

const extend = define('extend', {
  params: [
    { name: 'selector', type: 'any', check: checkAny },
    { name: 'extendee', type: 'any', check: checkAny },
    { name: 'extender', type: 'any', check: checkAny }
  ] as const,
  variadic: true,
  body: extendValue
});

export default extend;
