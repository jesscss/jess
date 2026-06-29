import { F_HAS_NODE_CHILD, F_NON_STATIC, Node } from '../node-base.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

/**
 * A source-free childless node can be shared as an inert value leaf.
 * Containers still need an owned surface so eval can safely re-parent or replace
 * their children for a particular placement.
 */
export function canReuseLeaf(node: Node): boolean {
  return (node._location?.length ?? 0) === 0
    && !node.hasFlag(F_NON_STATIC)
    && !node.hasFlag(F_HAS_NODE_CHILD);
}

export function reuseLeaf<T extends Node>(node: T): T {
  node.frozen = true;
  return node;
}

function deriveAmpersand(node: Node): Node | undefined {
  if (!isNode(node, N.Ampersand)) {
    return undefined;
  }
  const derived = node.derive();
  if (derived instanceof Node) {
    return derived;
  }
  return undefined;
}

export function copyWithReusableLeaves(node: Node): Node {
  if (node.type === 'Comment') {
    const nilNode = node.nil?.();
    if (nilNode) {
      return nilNode.inherit(node);
    }
  }
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  return node.cloneForPlacement();
}

export function copyWithReusableLeavesPreservingComments(node: Node): Node {
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  return node.cloneForPlacement({ stripComments: false });
}

export function copyOwnedWithReusableLeaves(node: Node): Node {
  if (node.type === 'Comment') {
    const nilNode = node.nil?.();
    if (nilNode) {
      return nilNode.inherit(node);
    }
  }
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  return node.cloneForPlacement();
}

/**
 * Collapsing a selector/container to a single surviving source child must not
 * inherit container metadata onto the canonical child. Own that child first;
 * evaluated replacement children may inherit directly because they are already
 * placement-local output.
 */
export function ownCollapsedSourceChild(
  node: Node,
  sourceValue: readonly unknown[],
  owner: Node
): Node {
  const owned = sourceValue.includes(node)
    ? copyOwnedWithReusableLeaves(node)
    : node;
  return owned.inherit(owner);
}
