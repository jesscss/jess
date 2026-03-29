import { Operation, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformOperationToLess = createFromAdapter<Operation>({
  fields: {
    op: o => o.get('operator') || '',
    operands: (o, cache) => {
      const operands: Node[] = [];
      const left = o.get('left');
      const right = o.get('right');
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
