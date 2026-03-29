import { Negative, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformNegativeToLess = createFromAdapter<Negative>({
  fields: {
    value: (n, cache) => {
      const value = n.get('value');
      return value instanceof Node ? toLessNode(value, { cache }) : value;
    }
  },
  accept: selfVisitAccept()
});
