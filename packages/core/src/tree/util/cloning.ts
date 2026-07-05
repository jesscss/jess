import { isSourceFree } from './provenance.js';
import { F_HAS_NODE_CHILD, F_NON_STATIC, Node } from '../node-base.js';
import { Selector } from '../selector.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

/**
 * A source-free childless node can be shared as an inert value leaf.
 * Containers still need an owned surface so eval can safely re-parent or replace
 * their children for a particular placement.
 */
export function canReuseLeaf(node: Node): boolean {
  return isSourceFree(node)
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
  // Copy-on-write: a Selector's ownership clone adopts (reparents) its child
  // selectors. If it shared them, adopt would reparent the SOURCE children and
  // corrupt the shared source tree, so detach non-reusable child selectors into
  // owned copies. Scalar leaves are still reused (no needless clones).
  if (node instanceof Selector) {
    return node.cloneForPlacement({
      reuseLeaves: true,
      detachChildren: true,
      ...(options.preserveComments ? { stripComments: false } : {})
    });
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
 * Copy a Node array using a specified copy function, validating that each
 * copy remains a Node. Used by Ruleset, Mixin, and AtRule to consolidate
 * their identical ownRules() implementations.
 *
 * @param nodes - Array of nodes to copy
 * @param copyFn - Copy function (e.g., copyOwnedWithReusableLeaves, copyWithReusableLeaves)
 * @returns Array of copied nodes
 * @throws TypeError if a copy doesn't remain a Node
 */
export function copyNodesForOwnership(
  nodes: readonly Node[],
  copyFn: (n: Node) => Node
): Node[] {
  const owned = new Array<Node>(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const copied = copyFn(nodes[i]!);
    if (!(copied instanceof Node)) {
      throw new TypeError('Expected node copy to remain a node');
    }
    owned[i] = copied;
  }
  return owned;
}
