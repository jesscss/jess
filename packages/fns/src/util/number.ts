import { Dimension, type Node } from '@jesscss/core';

export type ColorValue = Dimension | number;

export function clamp(val: number) {
  return Math.min(1, Math.max(0, val));
}

export function getNumber(n: Node | number, ignoreUnit = false) {
  if (n instanceof Dimension) {
    let unit = n.value.unit;
    if (unit === '%') {
      return n.value.number / 100;
    } else if (!unit || ignoreUnit) {
      return n.value.number;
    }
    throw new Error('color functions take numbers as parameters');
  } else if (n.constructor === Number) {
    return n;
  } else {
    throw new Error('color functions take numbers as parameters');
  }
}