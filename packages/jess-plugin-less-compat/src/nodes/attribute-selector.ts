import { AttributeSelector, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformAttributeSelectorToLess = createFromAdapter<AttributeSelector>({
  fields: {
    key: (a, cache) => {
      const name = a.name;
      return name instanceof Node ? toLessNode(name, { cache }) : name;
    },
    op: a => a.op || '',
    value: (a, cache) => {
      const value = a.attributeValue;
      return value instanceof Node ? toLessNode(value, { cache }) : value;
    }
  },
  accept: selfVisitAccept()
});
