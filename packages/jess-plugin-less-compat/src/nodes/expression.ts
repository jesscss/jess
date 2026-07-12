import { Expression, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Expression to a Less-compatible Expression
 */
export function transformExpressionToLess(
  jessExpression: Expression,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessExpression, cache, (prop, target) => {
    const expr = target as Expression;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(expr.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property (Less expects array)
    if (prop === 'value') {
      const value = expr.data;
      if (value instanceof Node) {
        // Single node - wrap in array
        return [toLessNode(value, { cache })];
      }
      // Expression.value is always a Node, so this shouldn't happen
      return [value];
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessExpr = transformExpressionToLess(expr, cache);
        const result = visitor.visit(lessExpr);
        if (result !== lessExpr) {
          return fromLessNode(result, { cache });
        }
        return expr;
      };
    }

    return undefined;
  });
}
