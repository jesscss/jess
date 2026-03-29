import { Mixin, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformMixinToLess = createFromAdapter<Mixin>({
  fields: {
    name: m => m.get('name'),
    params: (m, cache) => {
      const params = m.get('params');
      return params instanceof Node ? toLessNode(params, { cache }) : params;
    },
    rules: (m, cache) => {
      const rules = m.get('rules');
      return rules?._value ? rules._value.map((r: Node) => toLessNode(r, { cache })) : [];
    },
    condition: (m, cache) => {
      const guard = m.get('guard');
      return guard instanceof Node ? toLessNode(guard, { cache }) : guard;
    }
  },
  accept: selfVisitAccept()
});
