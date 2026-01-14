import { Call, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess Call to a Less-compatible Call or MixinCall
 */
export function transformCallToLess(
  jessCall: Call,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessCall, cache, (prop, target) => {
    const call = target as Call;

    // Map 'type' property
    // Less distinguishes between Call and MixinCall, but Jess uses Call for both
    // We'll default to Call, but this could be enhanced to detect mixin calls
    if (prop === 'type') {
      return mapJessTypeToLessType(call.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'name' property
    if (prop === 'name') {
      return call.value.name;
    }

    // Map 'args' property
    if (prop === 'args') {
      const args = call.value.args;
      if (args) {
        // args is a List node
        return args.value.map((arg: any) => {
          if (arg instanceof Node) {
            return toLessNode(arg, { cache });
          }
          return arg;
        });
      }
      return [];
    }

    // Map 'index' property
    if (prop === 'index') {
      const loc = call.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessCall = transformCallToLess(call, cache);
        const result = visitor.visit(lessCall);
        if (result !== lessCall) {
          const { fromLessNode } = require('../transform/from-less');
          return fromLessNode(result, { cache });
        }
        return call;
      };
    }

    return undefined;
  });
}
