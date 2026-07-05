import { Node } from '../node-base.js';

/**
 * Collapsing a selector/container to a single surviving source child must not
 * inherit container metadata onto the canonical child. Own that child first;
 * evaluated replacement children may inherit directly because they are already
 * placement-local output.
 *
 * Copy-on-write: whether owning that child CLONES the source-free leaf or REUSES
 * it in place depends on whether the collapsing owner is a SHARED template. A
 * parentless owner is a re-readable root selector eval'd as a template — its
 * source children must survive the collapse, so clone (canonical-survivor). An
 * owner attached to a live parent is an interior selector whose collapse output
 * flows upward and is consumed once (e.g. extend materialization), so reuse the
 * leaf in place (no source-leaf clones).
 */
export function ownCollapsedSourceChild(
  node: Node,
  sourceValue: readonly unknown[],
  owner: Node
): Node {
  const shared = owner.parent === undefined;
  const owned = sourceValue.includes(node)
    ? node.cloneForPlacement({ reuseLeaves: !shared })
    : node;
  return owned.inherit(owner);
}
