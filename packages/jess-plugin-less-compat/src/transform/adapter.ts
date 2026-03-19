import { Node } from '@jesscss/core';
import { createLessProxy } from './proxy.js';
import { toLessNode } from './to-less.js';
import { fromLessNode } from './from-less.js';
import { mapJessTypeToLessType } from './type-map.js';
import type { LessNode } from '../types.js';

type NodeTransformer = (jessNode: Node, cache?: WeakMap<any, any>) => LessNode;

type AcceptFn<T extends Node> = (node: T, visitor: any, cache?: WeakMap<any, any>) => any;

export interface NodeAdapter<T extends Node> {
  lessType?: string | ((node: T) => string);
  fields: Record<string, (node: T, cache?: WeakMap<any, any>) => unknown>;
  /** Handle dynamic property access (e.g. numeric indices for array-like nodes) */
  dynamicField?: (prop: string | symbol, node: T, cache?: WeakMap<any, any>) => unknown;
  accept?: AcceptFn<T>;
}

/**
 * Create a NodeTransformer from a declarative adapter definition.
 *
 * - `type` and `typeIndex` are auto-mapped.
 * - If no `accept` is provided, leaf behavior (return self) is used.
 * - Field lookups are dispatched from the `fields` record.
 */
export function createFromAdapter<T extends Node>(
  adapter: NodeAdapter<T>
): NodeTransformer {
  return (jessNode: Node, cache?: WeakMap<any, any>): LessNode => {
    return createLessProxy(jessNode, cache, (prop, target) => {
      const node = target as T;

      if (prop === 'type') {
        if (typeof adapter.lessType === 'function') {
          return adapter.lessType(node);
        }
        return adapter.lessType ?? mapJessTypeToLessType(node.type);
      }

      if (prop === 'typeIndex') {
        return undefined;
      }

      if (prop === 'accept') {
        if (adapter.accept) {
          return function(visitor: any) {
            return adapter.accept!(node, visitor, cache);
          };
        }
        // Leaf default: no children to traverse
        return function() {
          return node;
        };
      }

      if (typeof prop === 'string' && prop in adapter.fields) {
        return adapter.fields[prop]!(node, cache);
      }

      if (adapter.dynamicField) {
        const result = adapter.dynamicField(prop, node, cache);
        if (result !== undefined) {
          return result;
        }
      }

      return undefined;
    });
  };
}

/**
 * Accept helper: self-visit pattern.
 * Calls visitor.visit on the cached proxy, converts replacement back via fromLessNode.
 */
export function selfVisitAccept<T extends Node>(): AcceptFn<T> {
  return (node: T, visitor: any, cache?: WeakMap<any, any>) => {
    const lessNode = toLessNode(node as Node, { cache });
    const result = visitor.visit(lessNode);
    if (result !== lessNode) {
      return fromLessNode(result, { cache });
    }
    return node;
  };
}

/**
 * Accept helper: traverse child nodes via visitor.visitArray.
 */
export function childrenAccept<T extends Node>(
  getChildren: (node: T, cache?: WeakMap<any, any>) => Node[]
): AcceptFn<T> {
  return (node: T, visitor: any, cache?: WeakMap<any, any>) => {
    const children = getChildren(node, cache);
    if (children.length > 0) {
      const lessChildren = children
        .map(c => toLessNode(c, { cache }))
        .filter((c: any) => c != null);
      if (lessChildren.length > 0) {
        if (visitor.visitArray) {
          visitor.visitArray(lessChildren);
        } else {
          for (const child of lessChildren) {
            if (child?.accept) {
              child.accept(visitor);
            }
          }
        }
      }
    }
    return node;
  };
}

/**
 * Accept helper: traverse a single child node.
 */
export function singleChildAccept<T extends Node>(
  getChild: (node: T) => Node | undefined
): AcceptFn<T> {
  return (node: T, visitor: any, cache?: WeakMap<any, any>) => {
    const child = getChild(node);
    if (child instanceof Node) {
      const lessChild = toLessNode(child, { cache });
      if (lessChild?.accept) {
        lessChild.accept(visitor);
      } else if (lessChild && visitor.visitArray) {
        visitor.visitArray([lessChild]);
      } else if (lessChild && visitor.visit) {
        visitor.visit(lessChild);
      }
    }
    return node;
  };
}
