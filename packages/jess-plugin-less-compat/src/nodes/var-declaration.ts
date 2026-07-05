import { VarDeclaration, Interpolated, Node, sourceSpanOf } from '@jesscss/core';
import { createFromAdapter, singleChildAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';

export const transformVarDeclarationToLess = createFromAdapter<VarDeclaration>({
  fields: {
    name: {
      get: v => v.name,
      set: (v, value) => {
        v.name = value instanceof Interpolated ? value : String(value);
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
    index: v => sourceSpanOf(v)?.start
  },
  accept: singleChildAccept((v) => {
    const value = v.value;
    return value instanceof Node ? value : undefined;
  })
});
