import { isNode } from './is-node';
import isObject from 'lodash-es/isObject';
import { type Node } from '../node';

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

/**
 * Find the actual source order of two nodes, by comparing
 * their position in their lowest common ancestor in the tree.
 */
export function comparePosition(a: Node, b: Node) {
  let a0 = a;
  let b0 = b;

  // align depths
  while (a.depth > b.depth) {
    a = a.parent!;
  }
  while (b.depth > a.depth) {
    b = b.parent!;
  }

  // ancestor case
  if (a === b) {
    return a0.depth - b0.depth;
  }

  // climb until they become siblings (share a parent)
  while (a.parent !== b.parent) {
    a = a.parent!;
    b = b.parent!;
  }

  // siblings: lower index first
  return a.index - b.index;
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