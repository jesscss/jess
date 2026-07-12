import { Quoted, Any, Interpolated } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Quoted to a Less-compatible Quoted
 */
export function transformQuotedToLess(
  jessQuoted: Quoted,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessQuoted, cache, (prop, target) => {
    const quoted = target as Quoted;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(quoted.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = quoted.value;
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Any) {
        return value.value;
      }
      if (value instanceof Interpolated) {
        // Convert interpolated to string representation
        // Less handles interpolation differently, so we convert to string
        return String(value.value);
      }
      return String(value);
    }

    // Map 'quote' property
    if (prop === 'quote') {
      return quoted.options?.quote || '"';
    }

    // Map 'escaped' property
    if (prop === 'escaped') {
      return quoted.options?.escaped === true;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessQuoted = transformQuotedToLess(quoted, cache);
        const result = visitor.visit(lessQuoted);
        if (result !== lessQuoted) {
          return fromLessNode(result, { cache });
        }
        return quoted;
      };
    }

    return undefined;
  });
}
