import type { Cursor, Node, NodeEdge, RenderKey } from '../node.js';

export function lookupEdge<T>(
  edges: NodeEdge<T> | undefined,
  key: RenderKey
): T | undefined {
  return edges?.get(key);
}

export function getParentEdge(cursor: Cursor): Cursor | undefined {
  const overridden = lookupEdge(cursor.node.parentEdges, cursor.key);
  if (overridden !== undefined) {
    return overridden ? { node: overridden, key: cursor.key } : undefined;
  }

  return cursor.node.parent
    ? { node: cursor.node.parent, key: cursor.key }
    : undefined;
}

export function getEdge(cursor: Cursor, key: string): Cursor | undefined {
  const entry = cursor.node.childEdges?.get(key);
  if (entry instanceof Map) {
    const overridden = lookupEdge(entry, cursor.key);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, key: cursor.key } : undefined;
    }
  }

  const canonicalChild = (cursor.node as Record<string, unknown>)[key] as Node | undefined;
  return canonicalChild ? { node: canonicalChild, key: cursor.key } : undefined;
}

export function getEdgeAt(cursor: Cursor, key: string, index: number): Cursor | undefined {
  const entry = cursor.node.childEdges?.get(key);
  if (Array.isArray(entry)) {
    const overridden = lookupEdge(entry[index], cursor.key);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, key: cursor.key } : undefined;
    }
  }

  const canonicalList = (cursor.node as Record<string, unknown>)[key] as Node[] | undefined;
  const canonicalChild = canonicalList?.[index];
  return canonicalChild ? { node: canonicalChild, key: cursor.key } : undefined;
}

export function addEdge(
  node: Node,
  key: string,
  renderKey: RenderKey,
  child: Node
): void {
  node.childEdges ??= new Map<string, NodeEdge<Node> | Array<NodeEdge<Node> | undefined>>();
  const entry = node.childEdges.get(key);
  if (Array.isArray(entry)) {
    throw new TypeError(`Cannot assign singular child edge for indexed field '${key}'`);
  }
  const edge = entry ?? new Map<RenderKey, Node>();
  edge.set(renderKey, child);
  node.childEdges.set(key, edge);
}

export function addEdgeAt(
  node: Node,
  key: string,
  index: number,
  renderKey: RenderKey,
  child: Node
): void {
  node.childEdges ??= new Map<string, NodeEdge<Node> | Array<NodeEdge<Node> | undefined>>();
  const existing = node.childEdges.get(key);
  if (existing instanceof Map) {
    throw new TypeError(`Cannot assign indexed child edge for singular field '${key}'`);
  }
  const indexedEdges = existing ?? [];
  const edge = indexedEdges[index] ?? new Map<RenderKey, Node>();
  edge.set(renderKey, child);
  indexedEdges[index] = edge;
  node.childEdges.set(key, indexedEdges);
}
