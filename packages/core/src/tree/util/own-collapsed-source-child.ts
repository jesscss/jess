import { Node } from '../node-base.js';

/**
 * Collapsing a selector/container to a single surviving child stamps the
 * container's provenance (source span / visibility / generated / extend flags)
 * onto that child via `inherit`. `inherit` mutates its receiver in place, so the
 * receiver must be a FRESH shell — never the shared source node — or the stamp
 * would corrupt the shared tree. Route through the `shareChildren` freeze-share
 * seam: a fresh top shell whose node children are the SAME source children,
 * frozen so their reparent is skipped (no deep copy).
 *
 * Copy-on-write for source-free leaves: whether the shell REUSES the leaf in
 * place or CLONES it depends on whether the collapsing owner is a SHARED
 * template. A parentless owner is a re-readable root selector eval'd as a
 * template — its source children must survive the collapse, so clone
 * (canonical-survivor). An owner attached to a live parent is an interior
 * selector whose collapse output flows upward and is consumed once (e.g. extend
 * materialization), so reuse the inert leaf in place (no source-leaf clones).
 */
export function ownCollapsedSourceChild(
  node: Node,
  sourceValue: readonly unknown[],
  owner: Node
): Node {
  const shared = owner.parent === undefined;
  const owned = node.cloneForPlacement({ reuseLeaves: !shared, shareChildren: true });
  return owned.inherit(owner);
}
