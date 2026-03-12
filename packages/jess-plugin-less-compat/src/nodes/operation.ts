import { Operation, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Operation to a Less-compatible Operation
 */
export function transformOperationToLess(
  jessOperation: Operation,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessOperation, cache, (prop, target) => {
    const op = target as Operation;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(op.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'op' property (operator)
    if (prop === 'op') {
      // Jess stores as [left, op, right], extract op
      const value = op.data;
      if (Array.isArray(value) && value.length >= 2) {
        return value[1]; // Operator is in the middle
      }
      return '';
    }

    // Map 'operands' property
    if (prop === 'operands') {
      const value = op.data;
      if (Array.isArray(value)) {
        // Extract left and right operands, skip operator
        const operands: Node[] = [];
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (item instanceof Node) {
            operands.push(item);
          } else if (typeof item === 'string' && i === 1) {
            // Skip operator
            continue;
          }
        }
        return operands.map(o => toLessNode(o, { cache }));
      }
      return [];
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessOp = transformOperationToLess(op, cache);
        const result = visitor.visit(lessOp);
        if (result !== lessOp) {
          return fromLessNode(result, { cache });
        }
        return op;
      };
    }

    return undefined;
  });
}
