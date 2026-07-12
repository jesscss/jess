import { Node } from '@jesscss/core';
import { createLessAdapter, type LessAdapterField } from './less-adapter.js';
import { toLessNode } from './to-less.js';
import { mapJessTypeToLessType } from './type-map.js';
import type { LessNode } from '../types.js';

type NodeTransformer<T extends Node> = (jessNode: T, cache?: WeakMap<Node, LessNode>) => LessNode;
type AcceptFn<T extends Node> = (
  node: T,
  visitor: {
    visitArray?: (nodes: LessNode[]) => void;
    visit?: (node: LessNode) => unknown;
  },
  cache?: WeakMap<Node, unknown>
) => T | unknown;

export interface NodeAdapter<T extends Node> {
  lessType?: string | ((node: T) => string);
  fields: Record<string, LessAdapterField<T>>;
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
): NodeTransformer<T> {
  return (jessNode: T, cache?: WeakMap<Node, LessNode>): LessNode => {
    return createLessAdapter(jessNode, {
      lessType: adapter.lessType ?? ((node: T) => mapJessTypeToLessType(node.type)),
      fields: adapter.fields,
      accept: adapter.accept
    }, cache);
  };
}

export function selfVisitAccept<T extends Node>(): AcceptFn<T> {
  return (node: T) => {
    return node;
  };
}

/**
 * Accept helper: traverse child nodes via visitor.visitArray.
 */
export function childrenAccept<T extends Node>(
  getChildren: (node: T, cache?: WeakMap<Node, unknown>) => Node[]
): AcceptFn<T> {
  return (node: T, visitor, cache?: WeakMap<Node, unknown>) => {
    const children = getChildren(node, cache);
    if (children.length > 0) {
      const lessChildren = children
        .map(child => toLessNode(child, { cache }))
        .filter((child): child is LessNode => child != null);
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
  return (node: T, visitor, cache?: WeakMap<Node, unknown>) => {
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
