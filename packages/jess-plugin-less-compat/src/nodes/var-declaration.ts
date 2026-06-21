import { Any, VarDeclaration, Node } from '@jesscss/core';
import { createFromAdapter, singleChildAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';

export const transformVarDeclarationToLess = createFromAdapter<VarDeclaration>({
  fields: {
    name: {
      get: v => v.name,
      set: (v, value) => {
        const name = value instanceof Any ? value : new Any(String(value), { role: 'property' });
        v.adopt(name);
        v.name = name;
      }
    },
    value: {
      get: (v, cache) => {
        const value = v.value;
        return value instanceof Node ? toLessNode(value, { cache }) : value;
      },
      set: (v, value) => {
        const node = value instanceof Node ? value : fromLessNode(value);
        v.adopt(node);
        v.value = node;
      }
    },
    index: (v) => {
      const loc = v.location;
      return loc.length ? loc[0] : undefined;
    }
  },
  accept: singleChildAccept((v) => {
    const value = v.value;
    return value instanceof Node ? value : undefined;
  })
});
