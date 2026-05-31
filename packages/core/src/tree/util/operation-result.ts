import type { Node } from '../node.js';

export function finalizeOperationResult<T extends Node>(source: Node, result: T): T {
  result.inherit(source);
  return result;
}
