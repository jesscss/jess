import { Extend, Selector } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Extend to a Less-compatible Extend
 */
export function transformExtendToLess(
  jessExtend: Extend,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessExtend, cache, (prop, target) => {
    const extend = target as Extend;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(extend.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'selector' property
    if (prop === 'selector') {
      const selector = extend.value.selector;
      if (selector instanceof Selector) {
        return toLessNode(selector, { cache });
      }
      return selector;
    }

    // Map 'option' property (Less uses this for extend options)
    // Jess uses 'flag' (ExtendFlag), Less uses 'option' string
    if (prop === 'option') {
      const flag = extend.value.flag;
      // ExtendFlag.All = 0 (default), ExtendFlag.Exact = 1
      return flag === 1 ? 'exact' : 'all';
    }

    // Map 'index' property
    if (prop === 'index') {
      const loc = extend.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessExtend = transformExtendToLess(extend, cache);
        const result = visitor.visit(lessExtend);
        if (result !== lessExtend) {
          return fromLessNode(result, { cache });
        }
        return extend;
      };
    }

    return undefined;
  });
}
