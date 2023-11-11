import { Dimension } from '@jesscss/core'
import { validate } from './_util'

import { type } from 'arktype'
const argsType = type({
  0: ['instanceof', Dimension]
})

const validateFloor = (...args: any[]) => validate(floor, ['value'], argsType(...args))

function floor(value: Dimension) {
  validateFloor(arguments)
  return new Dimension([Math.floor(value.number), value.unit])
}

export default floor
