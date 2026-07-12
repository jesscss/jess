import { Node } from '../node-base.js';

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
    ? node.cloneForPlacement({ reuseLeaves: false })
    : node;
  return owned.inherit(owner);
}
