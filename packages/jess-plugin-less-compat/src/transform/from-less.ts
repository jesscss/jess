import { Any, Node, Quoted, Rules } from '@jesscss/core';
import { getJessNodeFromProxy, isLessProxy } from './proxy.js';

// Less.js types
export type LessNode = any;

export interface FromLessOptions {
  /** Cache conversions to avoid repeated work */
  cache?: WeakMap<any, Node>;
}

/**
 * Convert a Less node back to a Jess node
 *
 * @param lessNode - The Less node to convert
 * @param options - Conversion options
 * @returns A Jess node
 */
export function fromLessNode(
  lessNode: LessNode,
  options?: FromLessOptions
): Node {
  if (!lessNode) {
    return lessNode;
  }

  const cache = options?.cache || new WeakMap();

  // Check cache first
  if (cache.has(lessNode)) {
    const cached = cache.get(lessNode);
    if (cached) {
      return cached;
    }
  }

  // If it's already a Jess node wrapped in a proxy, extract it
  if (isLessProxy(lessNode)) {
    const jessNode = getJessNodeFromProxy(lessNode);
    if (jessNode) {
      cache.set(lessNode, jessNode);
      return jessNode;
    }
  }

  // If it's a Less node that was created by a visitor, we need to reconstruct
  // For now, if we can't convert it back, return the original proxy target
  // TODO: Implement full reverse conversion for all node types

  // Check if it has a __jessNode property (we might store this during conversion)
  if (lessNode && typeof lessNode === 'object' && '__jessNode' in lessNode) {
    return lessNode.__jessNode;
  }

  // Minimal reverse conversions for Less-created nodes used in Less.js plugins
  if (lessNode && typeof lessNode === 'object' && typeof lessNode.type === 'string') {
    if (lessNode.type === 'Quoted') {
      const quote = (lessNode.quote === '\'' || lessNode.quote === '"') ? lessNode.quote : '"';
      const value = typeof lessNode.value === 'string' ? lessNode.value : String(lessNode.value);
      const escaped = !!lessNode.escaped;
      const out = new Quoted(value, { quote, escaped });
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'Anonymous') {
      const value = typeof lessNode.value === 'string' ? lessNode.value : String(lessNode.value);
      const out = new Any(value);
      cache.set(lessNode, out);
      return out;
    }
  }

  // If we can't convert it, try to return the original node
  // This is a fallback - in practice, visitors shouldn't create new nodes
  // that we can't track back to their originals
  throw new Error(
    `Cannot convert Less node back to Jess: ${lessNode?.type || 'unknown type'}. `
    + `Less visitors should not create new nodes, only modify existing ones.`
  );
}

/**
 * Convert an entire Less tree back to Jess Rules
 *
 * @param lessTree - The Less tree to convert
 * @param options - Conversion options
 * @returns A Jess Rules tree
 */
export function fromLessTree(
  lessTree: LessNode,
  _options?: FromLessOptions
): Rules {
  // TODO: Implement tree conversion
  // This will recursively convert all nodes back to Jess format
  // For now, if it's a proxy, extract the original
  if (isLessProxy(lessTree)) {
    const jessNode = getJessNodeFromProxy(lessTree);
    if (jessNode instanceof Rules) {
      return jessNode;
    }
  }

  throw new Error('Cannot convert Less tree back to Jess Rules');
}
