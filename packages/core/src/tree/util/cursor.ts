import { CANONICAL, type Cursor, type Node, type NodeEdge, type RenderKey } from '../node.js';

function nodeFields(node: Node): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function getSingularEdgeStore(
  node: Node,
  key: string
): NodeEdge<Node> | undefined {
  return nodeFields(node)[`${key}Edge`] as NodeEdge<Node> | undefined;
}

function getIndexedEdgeStore(
  node: Node,
  key: string
): Array<NodeEdge<Node> | undefined> | undefined {
  return nodeFields(node)[`${key}Edges`] as Array<NodeEdge<Node> | undefined> | undefined;
}

function setSingularEdgeStore(
  node: Node,
  key: string,
  edge: NodeEdge<Node>
): void {
  nodeFields(node)[`${key}Edge`] = edge;
}

function setIndexedEdgeStore(
  node: Node,
  key: string,
  edges: Array<NodeEdge<Node> | undefined>
): void {
  nodeFields(node)[`${key}Edges`] = edges;
}

export function lookupEdge<T>(
  edges: NodeEdge<T> | undefined,
  key: RenderKey
): T | undefined {
  return edges?.get(key);
}

/**
 * Resolve the primary parent cursor for a node/render-key pair.
 *
 * This mirrors `getParent(...)` at the cursor layer:
 * - prefer the active render-key parent edge
 * - fall back to canonical `node.parent`
 *
 * It deliberately does not follow secondary lanes such as `CALLER`. Traversals that
 * want caller fallback must opt into that separately so the main render path stays
 * stable and predictable.
 */
export function getParentEdge(cursor: Cursor): Cursor | undefined {
  const overridden = lookupEdge(cursor.node.parentEdges, cursor.renderKey);
  if (overridden !== undefined) {
    return overridden ? { node: overridden, renderKey: cursor.renderKey } : undefined;
  }

  return cursor.node.parent
    ? { node: cursor.node.parent, renderKey: cursor.renderKey }
    : undefined;
}

export function getEdge(cursor: Cursor, key: string): Cursor | undefined {
  const edge = getSingularEdgeStore(cursor.node, key);
  if (edge) {
    const overridden = lookupEdge(edge, cursor.renderKey);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, renderKey: cursor.renderKey } : undefined;
    }
  }

  const canonicalChild = nodeFields(cursor.node)[key] as Node | undefined;
  return canonicalChild ? { node: canonicalChild, renderKey: cursor.renderKey } : undefined;
}

export function getEdgeAt(cursor: Cursor, key: string, index: number): Cursor | undefined {
  const edges = getIndexedEdgeStore(cursor.node, key);
  if (edges) {
    const overridden = lookupEdge(edges[index], cursor.renderKey);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, renderKey: cursor.renderKey } : undefined;
    }
  }

  const canonicalList = nodeFields(cursor.node)[key] as Node[] | undefined;
  const canonicalChild = canonicalList?.[index];
  return canonicalChild ? { node: canonicalChild, renderKey: cursor.renderKey } : undefined;
}

export function addEdge(
  node: Node,
  key: string,
  renderKey: RenderKey,
  child: Node
): void {
  if (renderKey === CANONICAL) {
    const canonicalChild = nodeFields(node)[key] as Node | undefined;
    if (canonicalChild === child) {
      return;
    }
    throw new Error(`Cannot add a second CANONICAL edge for ${node.type}.${key}`);
  }
  const edge = getSingularEdgeStore(node, key) ?? new Map<RenderKey, Node>();
  edge.set(renderKey, child);
  setSingularEdgeStore(node, key, edge);
}

export function addEdgeAt(
  node: Node,
  key: string,
  index: number,
  renderKey: RenderKey,
  child: Node
): void {
  if (renderKey === CANONICAL) {
    const canonicalList = nodeFields(node)[key] as Node[] | undefined;
    const canonicalChild = canonicalList?.[index];
    if (canonicalChild === child) {
      return;
    }
    throw new Error(`Cannot add a second CANONICAL edge for ${node.type}.${key}[${index}]`);
  }
  const indexedEdges = getIndexedEdgeStore(node, key) ?? [];
  const edge = indexedEdges[index] ?? new Map<RenderKey, Node>();
  edge.set(renderKey, child);
  indexedEdges[index] = edge;
  setIndexedEdgeStore(node, key, indexedEdges);
}

export function addParentEdge(
  node: Node,
  renderKey: RenderKey,
  parent: Node
): void {
  /**
   * Parent edges represent render-placement overrides, not a second canonical parent.
   *
   * Invariants:
   * - `CANONICAL` must continue to live on `node.parent`
   * - non-canonical writes may override the active parent for a render key
   * - special keys such as `CALLER` are allowed here, but they are secondary lanes;
   *   they should not be treated as the default upward render path unless a traversal
   *   explicitly asks for them
   */
  if (renderKey === CANONICAL) {
    if (node.parent === parent) {
      return;
    }
    throw new Error(`Cannot add a second CANONICAL parent edge for ${node.type}`);
  }
  const edge = node.parentEdges ?? new Map<RenderKey, Node>();
  edge.set(renderKey, parent);
  node.parentEdges = edge;
}

export function removeParentEdge(
  node: Node,
  renderKey: RenderKey
): void {
  const edge = node.parentEdges;
  if (!edge) {
    return;
  }
  edge.delete(renderKey);
  if (edge.size === 0) {
    node.parentEdges = undefined;
  }
}
