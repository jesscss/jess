import { defineFunction, emitValue, groupItems, isValueGroupArray, operate, type Value, type ValueGroup } from '@jesscss/core';

const operand = (item: ValueGroup): Value => {
  if (isValueGroupArray(item)) {
    throw new TypeError(`${emitValue(item)} is not a number.`);
  }
  return item;
};

/**
 * Sass `math.div($number1, $number2)`. Less has no `div` function; its division
 * is the `/` operator.
 *
 * Dart Sass defines `math.div` as its `/` operator, so this is the same
 * division an `.scss` `/` that computes performs (`operate`), under the
 * compile's unit mode:
 *   math.div(6, 5)      → 1.2
 *   math.div(6px, 3)    → 2px
 *   math.div(6px, 3px)  → 2
 *   math.div($number2: 3, $number1: 6) → 2
 * (sass-spec `core_functions/math/div.hrx`.)
 */
const div = defineFunction('div', {
  params: [
    { name: 'number1', type: 'any' },
    { name: 'number2', type: 'any' }
  ],
  variadic: true,
  body: (args, ctx) => {
    const items = groupItems(args);
    if (items.length !== 2) {
      throw new TypeError(items.length < 2 ? `Missing argument $number${items.length + 1}.` : `Only 2 arguments allowed, but ${items.length} were passed.`);
    }
    return operate('/', operand(items[0]!), operand(items[1]!), ctx.modes);
  }
});

export { div };
export default div;
