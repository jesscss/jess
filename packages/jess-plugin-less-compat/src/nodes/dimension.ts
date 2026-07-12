import { Dimension, Num } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Dimension or Num to a Less-compatible Dimension
 */
export function transformDimensionToLess(
  jessDimension: Dimension | Num,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessDimension, cache, (prop, target) => {
    const dim = target as Dimension | Num;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(dim.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      if (dim instanceof Num) {
        return dim.value;
      }
      return dim.value.number;
    }

    // Map 'unit' property
    if (prop === 'unit') {
      if (dim instanceof Num) {
        // Num has no unit, return empty string or undefined
        return '';
      }
      // Dimension has unit as string, Less expects Unit node
      // For now, return the string and let Less handle conversion
      return dim.value.unit || '';
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        // Less Dimension has no children, so accept() should just return the dimension
        // The visitor's visit() method will handle traversal
        // We don't call visitor.visit() here to avoid infinite loops
        return dim;
      };
    }

    return undefined;
  });
}
