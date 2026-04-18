import { Condition, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformConditionToLess = createFromAdapter<Condition>({
  fields: {
    op: c => c.value[1] || '',
    lvalue: (c, cache) => {
      const left = c.value[0];
      return left instanceof Node ? toLessNode(left, { cache }) : left;
    },
    rvalue: (c, cache) => {
      const right = c.value[2];
      return right instanceof Node ? toLessNode(right, { cache }) : right;
    },
    negate: c => c.options?.negate === true
  },
  accept: selfVisitAccept()
});
