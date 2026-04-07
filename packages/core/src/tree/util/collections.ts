/**
 * Originally I had custom Hashmaps and ArrayLists, in order to normalize
 * generators and iterators for each. But using non-native collections
 * adds complexity but, more importantly, performance overhead, especially
 * if you don't use those iterators.
 *
 * Even using a Map over an object for a dictionary, in theory, has faster
 * lookups, but in total evaluation time, when the file is parsed, it would
 * be passing in either a Map or an object, and converting the object
 * to a map has object creation overhead, and so does creating the map itself,
 * if you pass in an array of arrays.
 *
 * Maps are good for dynamic property additions and repeated lookups. Nodes
 * look up / evaluate properties, at most, once per node, so an object-as-map
 * will either be faster or the differences will be negligible.
 *
 * So now, data is exceedingly simple. It's all passed in as is when parsing or
 * using the API, and we just have some utility functions in this file to iterate over
 * arrays / objects / simple values and return the values or entries, in any order.
 */
import type { Node } from '../node.js';

const { isArray } = Array;

/** Fast replacement for lodash isPlainObject — checks constructor === Object */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && value.constructor === Object;

export function atIndex<T>(array: readonly T[], index: number = -1): T | undefined {
  if (index >= 0) {
    return array[index];
  }
  /** Use a negative index to access from the last element */
  return array[array.length + index];
}

export function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
