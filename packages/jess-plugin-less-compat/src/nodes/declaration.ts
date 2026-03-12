import { Declaration, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

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
      return decl.data.name;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = decl.data.value;
      if (value instanceof Node) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'important' property
    if (prop === 'important') {
      return decl.data.important || false;
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
    // Less's Visitor.visit() calls node.accept(this) to traverse children
    // Declaration's accept should ONLY traverse its value, NOT call visitor methods on itself
    // The visitor's visit() method already called visitDeclaration() or visitRule() before calling accept()
    if (prop === 'accept') {
      return function(visitor: any) {
        // Declaration's accept only traverses its value (children)
        // Base Node.accept() pattern: visitor.visit(this.data)
        const value = decl.data.value;
        if (value instanceof Node) {
          const lessValue = toLessNode(value, { cache });
          if (lessValue && lessValue.accept) {
            lessValue.accept(visitor);
          } else if (lessValue && visitor.visitArray) {
            visitor.visitArray([lessValue]);
          } else if (lessValue && visitor.visit) {
            visitor.visit(lessValue);
          }
        } else if (value && Array.isArray(value)) {
          // If value is an array, use visitArray
          const lessValues = (value as any[]).map((v: any) => {
            if (v instanceof Node) {
              return toLessNode(v, { cache });
            }
            return v;
          });
          if (visitor.visitArray) {
            visitor.visitArray(lessValues);
          }
        }
        // Return the declaration (accept doesn't return a replacement node)
        return decl;
      };
    }

    return undefined;
  });
}
