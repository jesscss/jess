import { Operation, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformOperationToLess = createFromAdapter<Operation>({
  fields: {
    op: o => o.value[1] || '',
    operands: (o, cache) => {
      const operands: Node[] = [];
      const left = o.value[0];
      const right = o.value[2];
      if (left instanceof Node) {
        operands.push(left);
      }
      if (right instanceof Node) {
        operands.push(right);
      }
      return operands.map(n => toLessNode(n, { cache }));
    }
  },
  accept: selfVisitAccept()
});
