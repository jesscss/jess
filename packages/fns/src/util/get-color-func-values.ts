import {
  type Node,
  Operation,
  type Dimension,
  Sequence
} from '@jesscss/core'
import { getNumber } from './number'

/**
 * Allows for comma-less syntax
 */
export function getColorFunctionValues(one: Node, two: Node, three: Node) {
  /**
   * Comma-less syntax
   *   e.g. rgb(0 128 255 / 50%)
   */
  let alpha: Node | number = 1
  if (one instanceof Sequence) {
    const val: Dimension[] = one.value
    one = val[0]!
    two = val[1]!
    three = val[2]!
    /**
   * @todo - should this be normalized in
   *   function caller? Or parsed differently?
   */
    if (three instanceof Operation) {
      const op = three
      ;([three, ,alpha] = op.value)
    }
  }
  return ([one, two, three, alpha].map(v => getNumber(v)) as [number, number, number, number])
}