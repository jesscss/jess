import { Url, Quoted } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformUrlToLess = createFromAdapter<Url>({
  fields: {
    value: (u, cache) => {
      const value = u.node;
      return value instanceof Quoted ? toLessNode(value, { cache }) : value;
    }
  },
  accept: selfVisitAccept()
});
