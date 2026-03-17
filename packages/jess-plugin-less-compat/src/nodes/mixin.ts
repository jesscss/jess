import { Mixin, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformMixinToLess = createFromAdapter<Mixin>({
  fields: {
    name: (m) => m.name,
    params: (m, cache) => {
      const params = m.params;
      return params instanceof Node ? toLessNode(params, { cache }) : params;
    },
    rules: (m, cache) => {
      const rules = m.rules;
      return rules?.value ? rules.value.map((r: Node) => toLessNode(r, { cache })) : [];
    },
    condition: (m, cache) => {
      const guard = m.guard;
      return guard instanceof Node ? toLessNode(guard, { cache }) : guard;
    }
  },
  accept: selfVisitAccept()
});
