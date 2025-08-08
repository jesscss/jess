import { isNode } from './is-node';
import isObject from 'lodash-es/isObject';

export function compare(a: any, b: any) {
  if (a === b) {
    return 0;
  }
  if (!isObject(a) && !isObject(b)) {
    return a > b ? 1 : -1;
  }
  if (isNode(a) && isNode(b)) {
    return a.compare(b);
  }
  /** Do comparison without strict equality */
  if (a == b) {
    return 0;
  }
  return undefined;
}

export function compareNodeArray(a: any[], b: any[]): 0 | 1 | -1 | undefined {
  let output: 0 | 1 | -1 | undefined;

  if (a.length !== b.length) {
    return undefined;
  }

  /**
   * All values must be equal, or less than, or greater than.
   * Anything else is undefined.
   */
  for (let i = 0; i < a.length; i++) {
    let result = compare(a[i]!, b[i]!);
    if (result === undefined) {
      return undefined;
    }
    if (output === undefined) {
      output = result;
    } else if (result !== output) {
      return undefined;
    }
  }
  return output;
}