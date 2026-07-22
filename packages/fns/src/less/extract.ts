import { asList, defineFunction, listValueAt } from '@jesscss/core/value';

/**
 * Less `extract()` — the item at a 1-based `index` in a list. AST-v2 values
 * are immutable canonical facts, so the selected value is intentionally shared;
 * no legacy clone/materialization is needed or permitted.
 * @param value a list or single value
 * @param index 1-based position
 * @returns the extracted item
 * @throws `RangeError` if `index` is out of range
 */
const extract = defineFunction('extract', {
  params: [{ kinds: 'any' }, { kinds: ['Dimension'] }],
  variadic: true,
  body: (list) => {
    const args = asList(list);
    if (args.value.length !== 2) {
      throw new TypeError('extract() requires exactly two arguments');
    }
    const index = args.value[1]!;
    if (index.type !== 'Dimension') {
      throw new TypeError('extract() index must be numeric');
    }
    const normalized = Math.trunc(index.number);
    const target = args.value[0];
    const itemCount = target?.type === 'List' ? target.value.length : 1;
    if (!Number.isFinite(normalized)) {
      if (itemCount === 1) {
        return listValueAt(target, 0);
      }
      throw new TypeError('extract() index must be finite');
    }
    try {
      return listValueAt(target, normalized - 1);
    } catch {
      throw new RangeError(`extract() index ${normalized} out of range for length ${itemCount}`);
    }
  }
});

export default extract;
