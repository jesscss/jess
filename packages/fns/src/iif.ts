import { type ExtendedFn, validate } from './_util'
import { Node, Condition } from '@jesscss/core'

import { type } from 'arktype'

const validateArgs = type({
  condition: ['instanceof', Condition],
  trueValue: ['instanceof', Node]
})

/**
 * if condition, return ifValue, else return elseValue
 */
const iif: ExtendedFn = async function iif(condition: Condition, trueValue: Node, falseValue?: Node) {
  validate(validateArgs({ condition, trueValue }))
  const bool = typeof condition === 'boolean' ? condition : (await condition.eval(this)).value
  if (bool) {
    return await trueValue.eval(this)
  }
  if (falseValue) {
    return await falseValue.eval(this)
  }
}

export default iif