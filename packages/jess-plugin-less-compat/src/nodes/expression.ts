import { Expression, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformExpressionToLess = createFromAdapter<Expression>({
  fields: {
    value: (e, cache) => {
      const value = e.value;
      if (value instanceof Node) {
        return [toLessNode(value, { cache })];
      }
      return [value];
    }
  },
  accept: selfVisitAccept()
});
