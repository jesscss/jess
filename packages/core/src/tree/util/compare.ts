import { isNode } from './is-node.js';
import isObject from 'lodash-es/isObject.js';
import { type Node } from '../node.js';
import type { EqualityMode } from '../../types/modes.js';

export function compare(a: any, b: any, mode: EqualityMode = 'coerce') {
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
  if (mode === 'coerce' && a == b) {
    return 0;
  }
  return undefined;
}

/**
 * Find the actual source order of two nodes, by comparing
 * their position in their lowest common ancestor in the tree.
 */
export function comparePosition(a: Node, b: Node) {
  if (a === b) {
    return 0;
  }

  const pathToRoot = (node: Node): Node[] => {
    const path: Node[] = [];
    let current: Node | undefined = node;
    let guard = 0;
    while (current && guard < 1024) {
      path.push(current);
      current = current.parent;
      guard++;
    }
    return path;
  };

  const aPath = pathToRoot(a);
  const bPath = pathToRoot(b);
  let ai = aPath.length - 1;
  let bi = bPath.length - 1;
  let commonAncestor: Node | undefined;

  while (ai >= 0 && bi >= 0 && aPath[ai] === bPath[bi]) {
    commonAncestor = aPath[ai];
    ai--;
    bi--;
  }

  if (!commonAncestor) {
    return 0;
  }

  const aChild = ai >= 0 ? aPath[ai] : a;
  const bChild = bi >= 0 ? bPath[bi] : b;
  const aIndex = Number.isFinite(aChild.index) ? aChild.index : 0;
  const bIndex = Number.isFinite(bChild.index) ? bChild.index : 0;
  return aIndex - bIndex;
}

export function compareNodeArray(a: any[], b: any[], mode: EqualityMode = 'coerce'): 0 | 1 | -1 | undefined {
  let output: 0 | 1 | -1 | undefined;

  if (a.length !== b.length) {
    return undefined;
  }

  /**
   * All values must be equal, or less than, or greater than.
   * Anything else is undefined.
   */
  for (let i = 0; i < a.length; i++) {
    let result = compare(a[i]!, b[i]!, mode);
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
