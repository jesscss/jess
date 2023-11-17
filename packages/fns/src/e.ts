import { type ExtendedFn } from './util'
import { Node, Quoted } from '@jesscss/core'
import { type, instance, assert } from 'superstruct'

const Struct = type({
  value: instance(Node)
})

/**
 * Escape a quoted value
 */
const e: ExtendedFn = async function e(value: Node) {
  assert({ value }, Struct)
  if (value instanceof Quoted) {
    return value.value
  }
  return value
}

export default e