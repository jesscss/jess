import { type ExtendedFn } from '../util'
import { Node, Condition, Bool } from '@jesscss/core'
import { type, instance, union, assert, optional } from 'superstruct'

const Struct = type({
  condition: union([instance(Condition), instance(Bool)]),
  trueValue: instance(Node),
  falseValue: optional(instance(Node))
})

/**
 * if condition, return ifValue, else return elseValue
 */
const iif: ExtendedFn = async function iif(condition: Condition | Bool, trueValue: Node, falseValue?: Node) {
  assert({ condition, trueValue, falseValue }, Struct)
  const bool = typeof condition === 'boolean' ? condition : (await condition.eval(this)).value
  if (bool) {
    return await trueValue.eval(this)
  }
  if (falseValue) {
    return await falseValue.eval(this)
  }
}

export default iif