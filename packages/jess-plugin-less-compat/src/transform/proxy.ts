import { Node } from '@jesscss/core';
import { mapJessTypeToLessType } from './type-map';

/**
 * Symbol to mark Less proxy objects
 */
const LESS_PROXY_SYMBOL = Symbol('less-proxy');

// Cache for Less tree module and typeIndex lookups
let lessTreeModule: any = null;
let hasIndexedTypes = false;

/**
 * Get the Less tree module and ensure typeIndex is indexed
 * Less.js Visitor constructor indexes node types on first instantiation
 */
function getLessTreeModule(): any {
  if (!lessTreeModule) {
    try {
      const lessModule = require('less');
      lessTreeModule = lessModule.tree || require('less/lib/less/tree');
      
      // Ensure Visitor is instantiated at least once to trigger typeIndex assignment
      if (!hasIndexedTypes) {
        const LessVisitor = lessModule.visitors?.Visitor || require('less/lib/less/visitors/visitor').default;
        if (LessVisitor) {
          // Create a dummy visitor to trigger typeIndex indexing
          new LessVisitor({});
          hasIndexedTypes = true;
        }
      }
    } catch (e) {
      // Less.js not available
    }
  }
  return lessTreeModule;
}

/**
 * Get typeIndex for a Less node type
 * This reads from Less's tree module where typeIndex is set on prototypes
 * Only used internally by Less's Visitor for dispatch - plugins don't need this
 */
function getLessTypeIndex(lessType: string): number | undefined {
  const tree = getLessTreeModule();
  if (!tree) {
    return undefined;
  }

  // Look up the node constructor
  const NodeConstructor = tree[lessType];
  if (NodeConstructor && NodeConstructor.prototype && NodeConstructor.prototype.typeIndex !== undefined) {
    return NodeConstructor.prototype.typeIndex;
  }

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
  // Check cache first
  if (cache && cache.has(jessNode)) {
    return cache.get(jessNode);
  }

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
        const nodeType = (target as any).type || Reflect.get(target, 'type');
        if (nodeType) {
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
  
  // Mark as proxy
  (proxy as any)[LESS_PROXY_SYMBOL] = true;
  
  // Cache if provided
  if (cache) {
    cache.set(jessNode, proxy);
  }

  return proxy;
}

/**
 * Check if an object is a Less proxy wrapper
 *
 * @param obj - The object to check
 * @returns True if the object is a Less proxy
 */
export function isLessProxy(obj: any): boolean {
  return obj && typeof obj === 'object' && LESS_PROXY_SYMBOL in obj;
}

/**
 * Get the underlying Jess node from a Less proxy
 *
 * @param proxy - The proxy object
 * @returns The underlying Jess node, or undefined if not a proxy
 */
export function getJessNodeFromProxy(proxy: any): Node | undefined {
  if (isLessProxy(proxy)) {
    // The proxy target is the original node
    return proxy as Node;
  }
  return undefined;
}
