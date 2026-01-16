import { Mixin, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import { fromLessNode } from '../transform/from-less';
import type { LessNode } from '../types';

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
      return mixin.value.name;
    }

    // Map 'params' property
    if (prop === 'params') {
      const params = mixin.value.params;
      if (params instanceof Node) {
        return toLessNode(params, { cache });
      }
      return params;
    }

    // Map 'rules' property
    if (prop === 'rules') {
      const rules = mixin.value.rules;
      if (rules && rules.value) {
        return rules.value.map((r: Node) => toLessNode(r, { cache }));
      }
      return [];
    }

    // Map 'condition' property (from guard)
    if (prop === 'condition') {
      const guard = mixin.value.guard;
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
