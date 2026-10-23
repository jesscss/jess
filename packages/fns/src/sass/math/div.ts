import { defineFunction, emitValue, groupItems, isValueGroupArray, operate, type Dimension, type ValueGroup } from '@jesscss/core';

const number = (item: ValueGroup, name: string): Dimension => {
  if (isValueGroupArray(item) || item.type !== 'Dimension') {
    throw new TypeError(`$${name}: ${emitValue(item)} is not a number.`);
  }
  return item;
};

/**
 * Sass `math.div($number1, $number2)`. Less has no `div` function; its division
 * is the `/` operator.
 *
 * Dart Sass defines `math.div` as its `/` operator, so this is the same
 * division an `.scss` `/` that computes performs (`operate` with `.scss`'s unit
 * rule), under the compile's unit mode:
 *   math.div(6, 5)      → 1.2
 *   math.div(6px, 3)    → 2px
 *   math.div(6px, 3px)  → 2
 *   math.div($number2: 3, $number1: 6) → 2
 * (sass-spec `core_functions/math/div.hrx`.)
 *
 * Both arguments must be numbers. Dart Sass 1.101.7 still divides other values
 * into a slash-separated pair with a deprecation warning ("math.div() will only
 * support number arguments in a future release"), and computes nothing on a
 * colour (`math.div(red, 2)` → `Undefined operation`). Requiring numbers keeps
 * `.scss` colour math an error here as V36 has it for operators, where the
 * shared `/` would compute `red / 2`.
 *
 * Units of one conversion group cancel, as in the `.scss` `/` (ledger V32):
 * `math.div(6in, 3px)` → `192`. A division by zero fails the call (ledger V7),
 * where Dart Sass writes `calc(infinity)`.
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
    return operate('/', number(items[0]!, 'number1'), number(items[1]!, 'number2'), ctx.modes, true);
  }
});

export { div };
export default div;
