import { Declaration, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess Declaration to a Less-compatible Declaration
 */
export function transformDeclarationToLess(
  jessDeclaration: Declaration,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessDeclaration, cache, (prop, target) => {
    const decl = target as Declaration;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(decl.type);
    }

    // typeIndex is handled automatically by the base proxy handler

    // Map 'name' property
    if (prop === 'name') {
      return decl.value.name;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = decl.value.value;
      if (value instanceof Node) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'important' property
    if (prop === 'important') {
      return decl.value.important || false;
    }

    // Map 'variable' property (from options.assign)
    // Jess uses AssignmentType enum, Less uses boolean
    if (prop === 'variable') {
      return decl.options?.assign !== undefined;
    }

    // Map 'merge' property (Less uses this for merging declarations)
    if (prop === 'merge') {
      return false; // Default, can be set by Less visitors
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessDecl = transformDeclarationToLess(decl, cache);
        const result = visitor.visit(lessDecl);
        if (result !== lessDecl) {
          const { fromLessNode } = require('../transform/from-less');
          return fromLessNode(result, { cache });
        }
        return decl;
      };
    }

    return undefined;
  });
}
