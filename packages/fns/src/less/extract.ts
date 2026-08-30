import { defineFunction, groupItems, isValueGroupArray, listValueAt } from '@jesscss/core';

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
  params: [{ type: 'any' }, { type: 'Dimension' }],
  variadic: true,
  body: (list) => {
    const args = groupItems(list);
    if (args.length !== 2) {
      throw new TypeError('extract() requires exactly two arguments');
    }
    const index = args[1]!;
    if (isValueGroupArray(index) || index.type !== 'Dimension') {
      throw new TypeError('extract() index must be numeric');
    }

    /*
     * No non-finite branch: ledger V7 makes a non-finite number unconstructible as
     * a value, so `index.number` is finite by the time it gets here and `Math.trunc`
     * keeps it that way. The singleton-passthrough special case this used to carry
     * was reachable only from a `Dimension` holding `Infinity`.
     */
    const normalized = Math.trunc(index.number);
    const target = args[0];
    const itemCount = groupItems(target).length;
    try {
      return listValueAt(target, normalized - 1);
    } catch {
      throw new RangeError(`extract() index ${normalized} out of range for length ${itemCount}`);
    }
  }
});

export default extract;
