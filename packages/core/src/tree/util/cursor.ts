import type { Cursor, Node, NodeEdge, RenderKey } from '../node.js';

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
