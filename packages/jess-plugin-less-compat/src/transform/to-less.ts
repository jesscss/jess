import { Node, Rules } from '@jesscss/core';
import { createLessProxy } from './proxy';
import { getTransformer } from '../nodes';
import { mapJessTypeToLessType } from './type-map';

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
import { IS_PROXYING_SYMBOL } from './proxy';

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
  if ((jessNode as any)[IS_PROXYING_SYMBOL]) {
    // Return the node as-is to prevent recursion
    // This should only happen if cache doesn't have it (checked above)
    return jessNode as any;
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
    if (prop === 'value' && target.value) {
      // If value is a Node, convert it
      if (target.value instanceof Node) {
        return toLessNode(target.value, options);
      }
      // If value is an array, convert each element
      if (Array.isArray(target.value)) {
        return target.value.map((item: any) => {
          if (item instanceof Node) {
            return toLessNode(item, options);
          }
          return item;
        });
      }
      // If value is an object, convert nested nodes
      if (typeof target.value === 'object' && target.value !== null) {
        const converted: any = {};
        for (const [key, val] of Object.entries(target.value)) {
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
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessNode = toLessNode(target, options);
        const result = visitor.visit(lessNode);
        // If visitor returned a new node, convert back to Jess
        if (result !== lessNode) {
          const { fromLessNode } = require('./from-less');
          return fromLessNode(result, options);
        }
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
    return toLessNode(jessRules as any, options);
  }

  // Otherwise, convert the node directly
  return toLessNode(jessRules, options);
}
