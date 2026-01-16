import { VarDeclaration, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess VarDeclaration to a Less-compatible Assignment
 */
export function transformVarDeclarationToLess(
  jessVarDecl: VarDeclaration,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessVarDecl, cache, (prop, target) => {
    const varDecl = target as VarDeclaration;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(varDecl.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'name' property
    if (prop === 'name') {
      return varDecl.value.name;
    }

    // Map 'value' property
    if (prop === 'value') {
      const value = varDecl.value.value;
      if (value instanceof Node) {
        return toLessNode(value, { cache });
      }
      return value;
    }

    // Map 'index' property
    if (prop === 'index') {
      const loc = varDecl.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }

    // Map 'accept' method for visitor traversal
    // Less's Visitor.visit() calls node.accept(this) to traverse children
    // VarDeclaration's accept should traverse its value
    if (prop === 'accept') {
      return function(visitor: any) {
        // VarDeclaration's accept traverses its value
        const value = varDecl.value.value;
        if (value instanceof Node) {
          const lessValue = toLessNode(value, { cache });
          if (lessValue && lessValue.accept) {
            lessValue.accept(visitor);
          } else if (lessValue && visitor.visitArray) {
            visitor.visitArray([lessValue]);
          }
        }
      };
    }

    return undefined;
  });
}
