import { Reference, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess Reference to a Less-compatible Variable, Property, or VariableCall
 *
 * Jess has unified Reference with options.type
 * Less has separate Variable, Property, and VariableCall nodes
 */
export function transformReferenceToLess(
  jessReference: Reference,
  cache?: WeakMap<any, any>
): LessNode {
  const refType = jessReference.options?.type || 'variable';

  // Determine Less node type based on Jess reference type
  let lessType: string;
  if (refType === 'property') {
    lessType = 'Property';
  } else if (refType === 'function' || refType === 'mixin') {
    lessType = 'VariableCall';
  } else {
    lessType = 'Variable'; // Default to Variable
  }

  return createLessProxy(jessReference, cache, (prop, target) => {
    const ref = target as Reference;

    // Map 'type' property
    if (prop === 'type') {
      return lessType;
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'name' property (for Variable and Property)
    if (prop === 'name') {
      // Less Variable/Property expects name as string
      // Jess Reference has value.key which might be string, number, or Node
      const key = ref.value.key;
      if (typeof key === 'string') {
        return key;
      }
      if (typeof key === 'number') {
        return String(key);
      }
      // For other types, convert to string representation
      return String(key);
    }

    // Map 'value' property (for VariableCall - it's the call expression)
    if (prop === 'value' && lessType === 'VariableCall') {
      // VariableCall has value as the call expression
      // This is complex - for now, return the reference itself
      // Less VariableCall structure might need special handling
      return ref;
    }

    // Map 'index' property
    if (prop === 'index') {
      const loc = ref.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }

    // Map 'currentFileInfo' property
    if (prop === 'currentFileInfo') {
      return ref.location || {};
    }

    // Map 'accept' method for visitor traversal
    // Less's Visitor.visit() calls node.accept(this) to traverse children
    // Reference nodes typically don't have children to traverse
    if (prop === 'accept') {
      return function(visitor: any) {
        // Reference nodes don't have children to traverse
        // The visitor.visit() was already called by our plugin wrapper
      };
    }

    return undefined;
  });
}
