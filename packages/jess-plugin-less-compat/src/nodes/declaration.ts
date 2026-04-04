import { Declaration, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformDeclarationToLess = createFromAdapter<Declaration>({
  fields: {
    name: d => d.get('name'),
    value: (d, cache) => {
      const value = d.get('value');
      return value instanceof Node ? toLessNode(value, { cache }) : value;
    },
    important: d => d.get('important') || false,
    variable: d => d.options?.assign !== undefined,
    merge: () => false
  },
  accept: (decl, visitor, cache) => {
    const value = decl.get('value');
    if (value instanceof Node) {
      const lessValue = toLessNode(value, { cache });
      if (lessValue?.accept) {
        lessValue.accept(visitor);
      } else if (lessValue && visitor.visitArray) {
        visitor.visitArray([lessValue]);
      } else if (lessValue && visitor.visit) {
        visitor.visit(lessValue);
      }
    } else if (value && Array.isArray(value)) {
      const lessValues = (value as any[]).map((v: any) =>
        v instanceof Node ? toLessNode(v, { cache }) : v
      );
      if (visitor.visitArray) {
        visitor.visitArray(lessValues);
      }
    }
    return decl;
  }
});
