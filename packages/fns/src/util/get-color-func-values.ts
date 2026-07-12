import {
  type Node,
  Operation,
  type Dimension,
  type Color,
  Sequence
} from '@jesscss/core';
import { getNumber } from './number.js';

/**
 * Allows for comma-less syntax
 */
export function getColorFunctionValues(one: Sequence | Dimension, two: Dimension, three: Dimension) {
  /**
   * Comma-less syntax
   *   e.g. rgb(0 128 255 / 50%)
  */
  let alpha: Node | number = 1;
  if (one instanceof Sequence) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const val = one.value as Dimension[];
    one = val[0]!;
    two = val[1]!;
    three = val[2]!;
    /**
     * @todo - should this be normalized in
     *   function caller? Or parsed differently?
     */
    if (three instanceof Operation) {
      const op = three;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      three = op.left as Dimension;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      alpha = op.right as Dimension;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return ([one, two, three, alpha].map(v => getNumber(v, true)) as [number, number, number, number]);
}
