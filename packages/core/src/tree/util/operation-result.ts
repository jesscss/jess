import type { Node } from '../node.js';

export function finalizeOperationMetadataResult<T extends Node>(source: Node, result: T): T {
  result.inherit(source);
  return result;
}

export const finalizePublicOperationResult = finalizeOperationMetadataResult;
