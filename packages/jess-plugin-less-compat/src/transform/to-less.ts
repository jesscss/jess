import { Node, Rules } from '@jesscss/core';
import { createLessAdapter } from './less-adapter.js';
import { getTransformer } from '../nodes/index.js';
import { mapJessTypeToLessType } from './type-map.js';

// Less.js types - we'll need to import these from the less package
// For now, using any to avoid dependency issues during development
export type LessNode = any;

export interface ToLessOptions {
  /** Cache conversions to avoid repeated work */
  cache?: WeakMap<Node, any>;
  /** Preserve original Jess node reference */
  preserveOriginal?: boolean;
}

// typeIndex handling is now in the adapter layer - plugins don't need to know about it

/**
 * Convert a Jess node to a Less-compatible adapter
 *
 * @param jessNode - The Jess node to convert
 * @param options - Conversion options
 * @returns A Less-compatible adapter node
 */
import { isAdaptingNode } from './less-adapter.js';

export function toLessNode(
  jessNode: Node,
  options?: ToLessOptions
): LessNode {
  if (!jessNode) {
    return jessNode;
  }

  const cache = options?.cache || new WeakMap();

  // Check cache first so repeated conversions reuse the same adapter instance.
  if (cache.has(jessNode)) {
    return cache.get(jessNode);
  }

  // Check if already being adapted (prevent recursion).
  // Only return node as-is if there's no cached adapter.
  if (isAdaptingNode(jessNode)) {
    return jessNode;
  }

  // Get transformer for this node type
  const transformer = getTransformer(jessNode.type);

  if (transformer) {
    // Use specific transformer
    return transformer(jessNode, cache);
  }

  return createLessAdapter(jessNode, {
    lessType: mapJessTypeToLessType(jessNode.type),
    fields: {
      value: (target) => {
        if (!('value' in target) || target.value === undefined) {
          return undefined;
        }
        const nodeValue = target.value;
        if (nodeValue instanceof Node) {
          return toLessNode(nodeValue, options);
        }
        if (Array.isArray(nodeValue)) {
          return nodeValue.map(item => item instanceof Node ? toLessNode(item, options) : item);
        }
        if (typeof nodeValue === 'object' && nodeValue !== null) {
          const converted: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(nodeValue)) {
            if (val instanceof Node) {
              converted[key] = toLessNode(val, options);
            } else if (Array.isArray(val)) {
              converted[key] = val.map(item => item instanceof Node ? toLessNode(item, options) : item);
            } else {
              converted[key] = val;
            }
          }
          return converted;
        }
        return nodeValue;
      }
    },
    accept: target => target
  }, cache);
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
