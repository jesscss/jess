import { F_NON_STATIC, Node } from '../node-base.js';

/** Cloning functions */
export function freezeChildren(node: Node) {
  let n = node.clone(true);
  n.frozen = true;
  return n;
};

export function hasNodeChild(value: unknown): boolean {
  if (value instanceof Node) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(item => hasNodeChild(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(item => hasNodeChild(item));
  }
  return false;
}

/**
 * A source-free childless node can be shared as an inert value leaf.
 * Containers still need an owned surface so eval can safely re-parent or replace
 * their children for a particular placement.
 */
export function canReuseLeaf(node: Node): boolean {
  return node.location.length === 0
    && !node.hasFlag(F_NON_STATIC)
    && !hasNodeChild(node.value);
}

export function reuseLeaf(node: Node): Node {
  node.frozen = true;
  return node;
}
