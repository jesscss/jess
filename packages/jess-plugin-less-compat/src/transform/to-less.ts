import { Node, Rules } from '@jesscss/core';
import { createLessProxy } from './proxy.js';
import { getTransformer } from '../nodes/index.js';
import { mapJessTypeToLessType } from './type-map.js';
import { fromLessNode } from './from-less.js';

// Less.js types - we'll need to import these from the less package
// For now, using any to avoid dependency issues during development
export type LessNode = any;

export interface ToLessOptions {
  /** Cache conversions to avoid repeated work */
  cache?: WeakMap<Node, any>;
  /** Preserve original Jess node reference */
  preserveOriginal?: boolean;
}

// typeIndex handling is now in proxy.ts - plugins don't need to know about it

/**
 * Convert a Jess node to a Less-compatible proxy
 *
 * @param jessNode - The Jess node to convert
 * @param options - Conversion options
 * @returns A Less-compatible proxy node
 */
import { IS_PROXYING_SYMBOL } from './proxy.js';

export function toLessNode(
  jessNode: Node,
  options?: ToLessOptions
): LessNode {
  if (!jessNode) {
    return jessNode;
  }

  const cache = options?.cache || new WeakMap();

  // Check cache first - if we have a cached proxy, return it even if IS_PROXYING_SYMBOL is set
  if (cache.has(jessNode)) {
    return cache.get(jessNode);
  }

  // Check if already being proxied (prevent recursion)
  // Only return node as-is if there's no cached proxy
  if ((jessNode as unknown as Record<symbol, unknown>)[IS_PROXYING_SYMBOL]) {
    return jessNode;
  }

  // Get transformer for this node type
  const transformer = getTransformer(jessNode.type);

  if (transformer) {
    // Use specific transformer
    return transformer(jessNode, cache);
  }

  // Fallback: create a basic proxy with type mapping
  return createLessProxy(jessNode, cache, (prop, target) => {
    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(target.type);
    }

    // typeIndex is handled automatically by the base proxy handler

    // For child nodes, convert them lazily
    // Use instance field `.value` (the canonical accessor for leaf nodes)
    if (prop === 'value' && 'value' in target && target.value !== undefined) {
      const nodeValue = target.value;
      // If value is a Node, convert it
      if (nodeValue instanceof Node) {
        return toLessNode(nodeValue, options);
      }
      // If value is an array, convert each element
      if (Array.isArray(nodeValue)) {
        return nodeValue.map((item: any) => {
          if (item instanceof Node) {
            return toLessNode(item, options);
          }
          return item;
        });
      }
      // If value is an object, convert nested nodes
      if (typeof nodeValue === 'object' && nodeValue !== null) {
        const converted: any = {};
        for (const [key, val] of Object.entries(nodeValue)) {
          if (val instanceof Node) {
            converted[key] = toLessNode(val, options);
          } else if (Array.isArray(val)) {
            converted[key] = val.map((item: any) => {
              if (item instanceof Node) {
                return toLessNode(item, options);
              }
              return item;
            });
          } else {
            converted[key] = val;
          }
        }
        return converted;
      }
    }

    // Map 'accept' method for visitor traversal
    // This is called by Less visitors when they want to traverse the tree
    // Note: Less visitors should NOT call node.accept() in their visit() methods
    // as this causes infinite recursion. The less-compat plugin handles traversal.
    if (prop === 'accept') {
      return function(visitor: any) {
        // Check if the visitor is a Less visitor (has visitRuleset, visitDeclaration, etc.)
        // vs the less-compat visitor (has a visit method that converts to Less)
        const isLessVisitor = visitor && (
          typeof visitor.visitRuleset === 'function'
          || typeof visitor.visitDeclaration === 'function'
          || typeof visitor.visitVariable === 'function'
          || typeof visitor.visitAtRule === 'function'
          || (typeof visitor.visit === 'function' && !visitor.atRule && !visitor.ruleset && !visitor.visit)
        );

        if (!isLessVisitor) {
          // This is likely the less-compat visitor or a Jess visitor
          // Just return the node without processing to avoid recursion
          return target;
        }

        // This is a Less visitor - but we should NOT call visitor.visit here
        // because the Less visitor's visit() method might call node.accept() again,
        // causing infinite recursion. Instead, we just return the node.
        // The less-compat plugin's visit() method handles calling Less visitors.
        // If a Less visitor needs to traverse children, it should do so through
        // the less-compat plugin's traversal, not by calling node.accept().
        return target;
      };
    }

    return undefined;
  });
}

/**
 * Convert an entire Jess Rules tree to Less-compatible format
 *
 * @param jessRules - The Jess Rules tree to convert
 * @param options - Conversion options
 * @returns A Less-compatible tree
 */
export function toLessTree(
  jessRules: Rules | Node,
  options?: ToLessOptions
): LessNode {
  // If it's a Rules container, convert the root node
  if (jessRules instanceof Rules) {
    // Rules is a container - we need to find the root ruleset
    // For now, create a synthetic root ruleset
    // TODO: Handle this properly based on how Less structures its root
    return toLessNode(jessRules, options);
  }

  // Otherwise, convert the node directly
  return toLessNode(jessRules, options);
}
