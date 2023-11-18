import {
  type Node
} from '@jesscss/core'
import { type ExtendedFn } from './util'
import rgba from './rgba'
import { getColorFunctionValues } from './util/get-color-func-values'

const rgb: ExtendedFn = function rgb(r: Node, g: Node, b: Node) {
  const values = getColorFunctionValues(r, g, b)
  return rgba.call(this, ...values)
}

rgb.allowOptional = true

export default rgb