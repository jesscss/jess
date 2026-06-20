import { Any, Declaration, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';

function replaceDeclarationField<K extends 'name' | 'value'>(
  declaration: Declaration,
  key: K,
  value: Declaration[K]
): void {
  Object.defineProperty(declaration, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}

export const transformDeclarationToLess = createFromAdapter<Declaration>({
  fields: {
    name: {
      get: d => d.name,
      set: (d, value) => {
        const name = value instanceof Any ? value : new Any(String(value), { role: 'property' });
        d.adopt(name);
        replaceDeclarationField(d, 'name', name);
      }
    },
    value: {
      get: (d, cache) => {
        const value = d.value;
        return value instanceof Node ? toLessNode(value, { cache }) : value;
      },
      set: (d, value) => {
        const node = value instanceof Node ? value : fromLessNode(value);
        d.adopt(node);
        replaceDeclarationField(d, 'value', node);
      }
    },
    important: d => d.important || false,
    variable: d => d.options?.assign !== undefined,
    merge: () => false
  },
  accept: (decl, visitor, cache) => {
    const value = decl.value;
    if (value instanceof Node) {
      const lessValue = toLessNode(value, { cache });
      if (lessValue?.accept) {
        lessValue.accept(visitor);
      } else if (lessValue && visitor.visitArray) {
        visitor.visitArray([lessValue]);
      } else if (lessValue && visitor.visit) {
        visitor.visit(lessValue);
      }
    }
    return decl;
  }
});
