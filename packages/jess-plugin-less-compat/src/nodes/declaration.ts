import { Any, Declaration, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';

export const transformDeclarationToLess = createFromAdapter<Declaration>({
  fields: {
    name: {
      get: d => d.value.name,
      set: (d, value) => {
        d.set('name', value instanceof Any ? value : new Any(String(value), { role: 'property' }));
      }
    },
    value: {
      get: (d, cache) => {
        const value = d.value.value;
        return value instanceof Node ? toLessNode(value, { cache }) : value;
      },
      set: (d, value) => {
        d.set('value', value instanceof Node ? value : fromLessNode(value));
      }
    },
    important: d => d.value.important || false,
    variable: d => d.options?.assign !== undefined,
    merge: () => false
  },
  accept: (decl, visitor, cache) => {
    const value = decl.value.value;
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
