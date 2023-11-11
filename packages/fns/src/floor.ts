import { Dimension, type Node } from '@jesscss/core'
import { validate } from './_util'

import { type } from 'arktype'
const validateFloor = type({
  0: ['instanceof', Dimension]
})

function floor(value: Dimension) {
  validate(floor, validateFloor(arguments))
  return new Dimension([Math.floor(value.number), value.unit])
}

export default floor
