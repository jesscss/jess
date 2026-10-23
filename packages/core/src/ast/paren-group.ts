import { valueLayoutOf, withValueLayout } from './provenance.js';
import { authoredSeparators, isValueSlotArray, isValueSlotValue } from './css-grammar-helpers.js';
import { list } from './nodes.js';
import type { ValueSlot } from './nodes.js';

/**
 * What a css paren group holds (css-syntax-3 §5.4.8: a simple block's content
 * is any run of component values). An empty group `()` holds the EMPTY SLOT
 * `[]`, as `[]` does, never a contentless `Any`. A comma after the group's
 * last item (`(1,)`, `(a, b,)`) is the comma list it ends, whose last item is
 * that empty slot, its authored separator kept with the list's others.
 */
export function parenGroupContent(children: readonly unknown[], fields: Parameters<typeof authoredSeparators>[0]): ValueSlot {
  const value = children.find(isValueSlotValue) ?? [];
  if (fields?.separator === undefined) {
    return value;
  }
  const items = !isValueSlotArray(value) && value.type === 'List' && value.sep === ',' ? value : list([value], ',');
  return withValueLayout(
    list([...items.value, []], ','),
    [...valueLayoutOf(items) ?? [], ...authoredSeparators(fields)]
  );
}
