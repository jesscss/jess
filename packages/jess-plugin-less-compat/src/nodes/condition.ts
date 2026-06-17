import { Condition, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformConditionToLess = createFromAdapter<Condition>({
  fields: {
    op: c => c.operator || '',
    lvalue: (c, cache) => {
      const left = c.left;
      return left instanceof Node ? toLessNode(left, { cache }) : left;
    },
    rvalue: (c, cache) => {
      const right = c.right;
      return right instanceof Node ? toLessNode(right, { cache }) : right;
    },
    negate: c => c.negate
  },
  accept: selfVisitAccept()
});
