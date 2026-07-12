import { Url, Quoted } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Url to a Less-compatible URL
 */
export function transformUrlToLess(
  jessUrl: Url,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessUrl, cache, (prop, target) => {
    const url = target as Url;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(url.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = url.data;
      if (value instanceof Quoted) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessUrl = transformUrlToLess(url, cache);
        const result = visitor.visit(lessUrl);
        if (result !== lessUrl) {
          return fromLessNode(result, { cache });
        }
        return url;
      };
    }

    return undefined;
  });
}
