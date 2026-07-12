import { AttributeSelector, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformAttributeSelectorToLess = createFromAdapter<AttributeSelector>({
  fields: {
    key: (a, cache) => {
      const name = a.get('name');
      return name instanceof Node ? toLessNode(name, { cache }) : name;
    },
    op: a => a.get('op') || '',
    value: (a, cache) => {
      const value = a.get('value');
      return value instanceof Node ? toLessNode(value, { cache }) : value;
    }
  },
  accept: selfVisitAccept()
});
