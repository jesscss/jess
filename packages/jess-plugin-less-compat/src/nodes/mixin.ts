import { Mixin, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Mixin to a Less-compatible MixinDefinition
 */
export function transformMixinToLess(
  jessMixin: Mixin,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessMixin, cache, (prop, target) => {
    const mixin = target as Mixin;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(mixin.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'name' property
    if (prop === 'name') {
      return mixin.data.name;
    }

    // Map 'params' property
    if (prop === 'params') {
      const params = mixin.data.params;
      if (params instanceof Node) {
        return toLessNode(params, { cache });
      }
      return params;
    }

    // Map 'rules' property
    if (prop === 'rules') {
      const rules = mixin.data.rules;
      if (rules && rules.data) {
        return rules.data.map((r: Node) => toLessNode(r, { cache }));
      }
      return [];
    }

    // Map 'condition' property (from guard)
    if (prop === 'condition') {
      const guard = mixin.data.guard;
      if (guard instanceof Node) {
        return toLessNode(guard, { cache });
      }
      return guard;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessMixin = transformMixinToLess(mixin, cache);
        const result = visitor.visit(lessMixin);
        if (result !== lessMixin) {
          return fromLessNode(result, { cache });
        }
        return mixin;
      };
    }

    return undefined;
  });
}
