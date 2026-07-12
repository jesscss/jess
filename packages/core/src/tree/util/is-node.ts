import type { NToNode } from '../tree.js';
import { Node } from '../node.js';

/**
 * Fast bitmask-based node type check.
 *
 * With no type argument, checks if value is a Node (instanceof or duck-type).
 * With a bitmask argument, checks if the node's type matches via bitwise AND.
 *
 * Examples:
 *   isNode(x)                              // is it any node?
 *   isNode(x, N.Selector)                  // is it any Selector subtype? (narrows to Selector)
 *   isNode(x, N.Mixin | N.Func)           // is it a Mixin or Func? (boolean, no narrowing)
 *   isNode(x, N.BasicSelector)            // is it specifically a BasicSelector? (narrows)
 */

export function isNode(value: unknown): value is Node;

export function isNode<M extends keyof NToNode>(
  value: unknown,
  mask: M
): value is NToNode[M];

export function isNode(value: unknown, mask: number): boolean;

export function isNode(
  value: unknown,
  mask?: number
): boolean {
  if (!value) {
    return false;
  }
  if (mask === undefined) {
    /** No-arg: check if it's any Node (including types not in the bitmask table) */
    if (value instanceof Node) {
      return true;
    }
    if (typeof value !== 'object') {
      return false;
    }
    const maybeNode = value as { type?: unknown; children?: unknown };
    return typeof maybeNode.type === 'string'
      && typeof maybeNode.children === 'function';
  }
  if (typeof value !== 'object') {
    return false;
  }
  const nodeType = (value as { nodeType?: unknown }).nodeType;
  return typeof nodeType === 'number' && (nodeType & mask) !== 0;
}
