import type { Node } from '../node-base';

/** Cloning functions */
export function freezeChildren(node: Node) {
  let n = node.clone(true);
  n.frozen = true;
  return n;
};