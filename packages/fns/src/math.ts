import { Dimension, Color } from 'jess'
/**
 * This mimics Less's operations, preserving units and types
 * as output.
 */

type Numeric = Dimension | Color | number

function opDimension(
  op: '-' | '+' | '*' | '/',
  a: Dimension,
  b: Dimension
) {

}
function normalize(val: Numeric): Dimension | Color {
  return val.constructor === Number ? new Dimension(val) : <Dimension | Color>val
}

export function multiply(a: Numeric, b: Numeric) {
  const left = normalize(a)
  const right = normalize(b)

  if (left.unit && right.unit) {
    throw { message: 'Can\'t multiply a unit by a unit.' }
  }
}

export function divide(a: Numeric, b: Numeric) {
  
}

export function subtract(a: Numeric, b: Numeric) {
  
}

export function add(a: Numeric, b: Numeric) {
  
}