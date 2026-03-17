import { VarDeclaration, Node } from '@jesscss/core';
import { createFromAdapter, singleChildAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformVarDeclarationToLess = createFromAdapter<VarDeclaration>({
  fields: {
    name: v => v.name,
    value: (v, cache) => {
      const value = v.value;
      return value instanceof Node ? toLessNode(value, { cache }) : value;
    },
    index: (v) => {
      const loc = v.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }
  },
  accept: singleChildAccept(v => v.value instanceof Node ? v.value as Node : undefined)
});
