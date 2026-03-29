import { Paren, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformParenToLess = createFromAdapter<Paren>({
  fields: {
    value: (p, cache) => {
      const value = p.get('value');
      return value instanceof Node ? toLessNode(value, { cache }) : value;
    }
  },
  accept: selfVisitAccept()
});
