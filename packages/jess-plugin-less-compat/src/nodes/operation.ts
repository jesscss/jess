import { Operation, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformOperationToLess = createFromAdapter<Operation>({
  fields: {
    op: (o) => o.operator || '',
    operands: (o, cache) => {
      const operands: Node[] = [];
      if (o.left instanceof Node) operands.push(o.left);
      if (o.right instanceof Node) operands.push(o.right);
      return operands.map(n => toLessNode(n, { cache }));
    }
  },
  accept: selfVisitAccept()
});
