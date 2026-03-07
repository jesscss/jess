import { Call, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

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
        // Less Call's accept() should traverse args if they exist
        // But we don't call visitor.visit() here to avoid infinite loops
        // The visitor's visit() method will handle traversal
        // If args exist, we should traverse them using visitArray
        const args = call.value.args;
        if (args && args.value.length > 0) {
          const lessArgs = args.value
            .map((arg: any) => {
              if (arg instanceof Node) {
                return toLessNode(arg, { cache });
              }
              return arg;
            })
            .filter((arg: any) => arg !== undefined && arg !== null); // Filter out undefined/null
          if (lessArgs.length > 0) {
            if (visitor.visitArray) {
              visitor.visitArray(lessArgs);
            } else {
              // Fallback: call accept on each arg if visitArray not available
              for (const lessArg of lessArgs) {
                if (lessArg && lessArg.accept) {
                  lessArg.accept(visitor);
                }
              }
            }
          }
        }
        return call;
      };
    }

    return undefined;
  });
}
