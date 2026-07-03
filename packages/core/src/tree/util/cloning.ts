import { F_HAS_NODE_CHILD, F_NON_STATIC, Node } from '../node-base.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

/**
 * A source-free childless node can be shared as an inert value leaf.
 * Containers still need an owned surface so eval can safely re-parent or replace
 * their children for a particular placement.
 */
export function canReuseLeaf(node: Node): boolean {
  return node.spanStart === undefined
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

/**
 * The single placement-copy primitive. Variants differ only in two flags:
 * - `owned`: skip the source-free leaf reuse (always copy the container).
 * - `preserveComments`: keep comment nodes (no Comment→Nil) and don't strip
 *   comments from the placement clone.
 */
function copyForPlacement(
  node: Node,
  options: { owned?: boolean; preserveComments?: boolean } = {}
): Node {
  if (!options.preserveComments && node.type === 'Comment') {
    return node.nil().inherit(node);
  }
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  if (!options.owned && canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  return node.cloneForPlacement(options.preserveComments ? { stripComments: false } : undefined);
}

export function copyWithReusableLeaves(node: Node): Node {
  return copyForPlacement(node);
}

export function copyWithReusableLeavesPreservingComments(node: Node): Node {
  return copyForPlacement(node, { preserveComments: true });
}

export function copyOwnedWithReusableLeaves(node: Node): Node {
  return copyForPlacement(node, { owned: true });
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
