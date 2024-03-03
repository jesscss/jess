import {
  type General,
  Dimension
} from '@jesscss/core'

export default function unit(dimension: Dimension, unit?: General<'Keyword'>) {
  return new Dimension(
    unit
      ? [
          dimension.number,
          unit.value
        ]
      : [dimension.number]
  )
}