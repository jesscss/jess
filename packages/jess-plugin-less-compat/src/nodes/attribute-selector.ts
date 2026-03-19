import { AttributeSelector, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess AttributeSelector to a Less-compatible Attribute
 */
export function transformAttributeSelectorToLess(
  jessAttr: AttributeSelector,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessAttr, cache, (prop, target) => {
    const attr = target as AttributeSelector;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(attr.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'key' property (Less uses 'key', Jess uses 'name')
    if (prop === 'key') {
      const name = attr.name;
      if (name instanceof Node) {
        return toLessNode(name, { cache });
      }
      return name;
    }

    // Map 'op' property (operator)
    if (prop === 'op') {
      return attr.op || '';
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = attr.value;
      if (value instanceof Node) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessAttr = transformAttributeSelectorToLess(attr, cache);
        const result = visitor.visit(lessAttr);
        if (result !== lessAttr) {
          return fromLessNode(result, { cache });
        }
        return attr;
      };
    }

    return undefined;
  });
}
