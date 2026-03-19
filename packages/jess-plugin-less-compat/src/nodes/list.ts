import { List, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess List to a Less-compatible Value
 */
export function transformListToLess(
  jessList: List,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessList, cache, (prop, target) => {
    const list = target as List;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(list.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Get filtered, converted value array (used by multiple properties)
    const getFilteredValue = () => {
      const data = list.value;
      if (Array.isArray(data)) {
        return data
          .map((item: any) => {
            if (!item) {
              return null; // Mark null/undefined for filtering
            }
            if (item instanceof Node) {
              const lessItem = toLessNode(item, { cache });
              // If toLessNode returns undefined, skip it
              return lessItem || null;
            }
            return item;
          })
          .filter((item: any) => item !== undefined && item !== null); // Filter out undefined/null
      }
      // Single value - wrap in array (if not undefined/null)
      if (data !== undefined && data !== null) {
        if (data && typeof data === 'object' && 'type' in data) {
          // Check if it's a Node-like object
          const lessValue = toLessNode(data as unknown as Node, { cache });
          return lessValue ? [lessValue] : [];
        }
        return [data];
      }
      return [];
    };

    // Map 'value' property (Less Value expects array)
    if (prop === 'value') {
      return getFilteredValue();
    }

    // Intercept 'length' property to return filtered array length
    // Less visitor checks node.length to determine if it's array-like
    if (prop === 'length') {
      return getFilteredValue().length;
    }

    // Intercept numeric indices (array access like node[0], node[1])
    // Less visitor may access node[i] directly when node.length exists
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      const filtered = getFilteredValue();
      const index = parseInt(prop, 10);
      return filtered[index];
    }

    // Map 'children' method to return filtered, converted items
    // This prevents undefined items from being accessed when Jess core's accept() calls children()
    // children() is a generator function that yields Node instances
    // CRITICAL: When Jess core's accept() calls children(), it uses getValues(this.data)
    // We need to ensure the value property returns clean items, and children() filters them
    if (prop === 'children') {
      return function* (deep?: boolean, reverse?: boolean, includePrePost?: boolean) {
        // Use the filtered value from our value property getter
        // This ensures we get the same filtered array that the value property returns
        const filteredValue = list.value
          .filter((item: any) => item !== undefined && item !== null)
          .map((item: any) => {
            if (item instanceof Node) {
              const lessItem = toLessNode(item, { cache });
              return lessItem || null;
            }
            return item;
          })
          .filter((item: any) => item !== undefined && item !== null);

        // Handle reverse order if needed
        const itemsToIterate = reverse ? [...filteredValue].reverse() : filteredValue;

        for (const item of itemsToIterate) {
          if (item === undefined || item === null) {
            continue; // Skip undefined/null items (shouldn't happen after filtering, but be safe)
          }
          if (item instanceof Node || (item && typeof item === 'object' && 'type' in item)) {
            // It's a node (either Jess node or Less proxy)
            if (includePrePost) {
              // For now, just yield the item (pre/post handling can be added later if needed)
              yield item;
            } else {
              yield item;
            }
            if (deep && item instanceof Node) {
              // Recursively yield children if deep is true
              if (item.children) {
                yield* item.children(deep, reverse, includePrePost);
              }
            }
          } else {
            yield item;
          }
        }
      };
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        // Less List's accept() should traverse value items if they exist
        // But we don't call visitor.visit() here to avoid infinite loops
        // The visitor's visit() method will handle traversal
        // If value exists, we should traverse items using visitArray
        const value = list.value;
        if (Array.isArray(value) && value.length > 0) {
          const lessItems = value
            .map((item: any) => {
              if (item instanceof Node) {
                return toLessNode(item, { cache });
              }
              return item;
            })
            .filter((item: any) => item !== undefined && item !== null); // Filter out undefined/null
          if (lessItems.length > 0) {
            if (visitor.visitArray) {
              visitor.visitArray(lessItems);
            } else {
              // Fallback: call accept on each item if visitArray not available
              for (const lessItem of lessItems) {
                if (lessItem && lessItem.accept) {
                  lessItem.accept(visitor);
                }
              }
            }
          }
        }
        // Return the proxy, not the underlying node, to prevent Less visitor from accessing raw Jess node
        // Get the proxy from cache or create it
        return cache && cache.has(list) ? cache.get(list) : transformListToLess(list, cache);
      };
    }

    return undefined;
  });
}
