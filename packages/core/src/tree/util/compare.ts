import { isNode } from './is-node';
import isObject from 'lodash-es/isObject';
import { type Node } from '../node';
import { type Rules } from '../rules';

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
  /** Find the lowest common ancestor rules */
  let a0 = a;
  let b0 = b;
  let min = Math.min(a.depth, b.depth);
  let commonAncestor: Rules | undefined;

  if (a.depth !== min) {
    while (a.depth >= min) {
      a = a.rulesParent!;
    }
    commonAncestor = a as Rules;
  } else {
    while (b.depth >= min) {
      b = b.rulesParent!;
    }
    commonAncestor = b as Rules;
  }
  /** Now find the relative position of each */
  let aParent = a0;
  while (true) {
    aParent = aParent.parent!;
    if (!aParent || aParent === commonAncestor) {
      break;
    }
    a0 = aParent;
  }
  let bParent = b0;
  while (true) {
    bParent = bParent.parent!;
    if (!bParent || bParent === commonAncestor) {
      break;
    }
    b0 = bParent;
  }

  // siblings: lower index first
  return a0.index - b0.index;
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