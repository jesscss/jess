import { Any, VarDeclaration, Node } from '@jesscss/core';
import { createFromAdapter, singleChildAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';

export const transformVarDeclarationToLess = createFromAdapter<VarDeclaration>({
  fields: {
    name: {
      get: v => v.value.name,
      set: (v, value) => {
        v.set('name', value instanceof Any ? value : new Any(String(value), { role: 'property' }));
      }
    },
    value: {
      get: (v, cache) => {
        const value = v.value.value;
        return value instanceof Node ? toLessNode(value, { cache }) : value;
      },
      set: (v, value) => {
        v.set('value', value instanceof Node ? value : fromLessNode(value));
      }
    },
    index: (v) => {
      const loc = v.location;
      return loc.length ? loc[0] : undefined;
    }
  },
  accept: singleChildAccept((v) => {
    const value = v.value.value;
    return value instanceof Node ? value : undefined;
  })
});
