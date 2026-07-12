import { Node } from '@jesscss/core';
import { mapJessTypeToLessType } from './type-map.js';

/**
 * Symbol to mark Less proxy objects
 */
const LESS_PROXY_SYMBOL = Symbol('less-proxy');

/**
 * Symbol to store reference to underlying Jess node in proxy
 */
const JESS_NODE_SYMBOL = Symbol('jess-node');

/**
 * Symbol to mark nodes that are already being proxied (to prevent recursion)
 * Exported so toLessNode can check it
 */
export const IS_PROXYING_SYMBOL = Symbol('is-proxying');

/**
 * Get typeIndex for a Less node type
 * Since we're not using the actual Less.js library, we return undefined
 * Plugins typically don't need typeIndex - it's only used internally by Less's Visitor
 * for dispatch optimization. Our proxy-based approach doesn't require it.
 */
function getLessTypeIndex(_lessType: string): number | undefined {
  // Return undefined - plugins don't need typeIndex for our compatibility layer
  return undefined;
}

/**
 * Create a Less-compatible proxy wrapper around a Jess node
 *
 * This proxy intercepts property access and method calls to provide
 * a Less.js-compatible interface while maintaining the underlying Jess node.
 *
 * @param jessNode - The Jess node to wrap
 * @param cache - Optional cache for converted nodes
 * @param propertyMap - Function to map property names and values
 * @returns A proxy object that appears as a Less node
 */
export function createLessProxy(
  jessNode: Node,
  cache?: WeakMap<Node, any>,
  propertyMap?: (prop: string | symbol, target: Node) => any
): any {
  // Check if already proxied (prevent recursion)

  if ((jessNode as unknown as Record<symbol, unknown>)[IS_PROXYING_SYMBOL]) {
    // Return the cached proxy if available
    if (cache && cache.has(jessNode)) {
      return cache.get(jessNode);
    }
    // If no cache, return the node as-is to prevent recursion
    return jessNode;
  }

  // Check cache first
  if (cache && cache.has(jessNode)) {
    return cache.get(jessNode);
  }

  (jessNode as unknown as Record<symbol, unknown>)[IS_PROXYING_SYMBOL] = true;

  // Create proxy handler
  const handler: ProxyHandler<Node> = {
    get(target, prop) {
      // Handle special symbols
      if (prop === LESS_PROXY_SYMBOL) {
        return true;
      }

      // Handle typeIndex - Less's Visitor needs this for dispatch
      // Set it automatically based on the node's type
      // Use direct property access to avoid proxy recursion
      if (prop === 'typeIndex') {
        const nodeType = target.type;
        if (nodeType && typeof nodeType === 'string') {
          const lessType = mapJessTypeToLessType(nodeType);
          return getLessTypeIndex(lessType);
        }
        return undefined;
      }

      // Allow custom property mapping
      if (propertyMap) {
        const mapped = propertyMap(prop, target);
        if (mapped !== undefined) {
          return mapped;
        }
      }

      // Default: pass through to target
      const value = Reflect.get(target, prop);

      // If it's a method, bind it to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },

    set(target, prop, value) {
      // Allow setting properties
      return Reflect.set(target, prop, value);
    },

    has(target, prop) {
      // Check if property exists
      return Reflect.has(target, prop);
    },

    ownKeys(target) {
      // Return own property keys
      return Reflect.ownKeys(target);
    },

    getOwnPropertyDescriptor(target, prop) {
      // Return property descriptor
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
  };

  const proxy = new Proxy(jessNode, handler);

  (proxy as unknown as Record<symbol, unknown>)[LESS_PROXY_SYMBOL] = true;

  (proxy as unknown as Record<symbol, unknown>)[JESS_NODE_SYMBOL] = jessNode;

  // Cache if provided
  if (cache) {
    cache.set(jessNode, proxy);
  }

  delete (jessNode as unknown as Record<symbol, unknown>)[IS_PROXYING_SYMBOL];

  return proxy;
}

/**
 * Check if an object is a Less proxy wrapper
 *
 * @param obj - The object to check
 * @returns True if the object is a Less proxy
 */
export function isLessProxy(obj: unknown): obj is Record<string | symbol, unknown> {
  return !!obj && typeof obj === 'object' && LESS_PROXY_SYMBOL in obj;
}

/**
 * Get the underlying Jess node from a Less proxy
 *
 * @param proxy - The proxy object
 * @returns The underlying Jess node, or undefined if not a proxy
 */
export function getJessNodeFromProxy(proxy: unknown): Node | undefined {
  if (isLessProxy(proxy)) {
    const stored = proxy[JESS_NODE_SYMBOL];
    return stored instanceof Node ? stored : undefined;
  }
  return undefined;
}
