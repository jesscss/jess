import { Mixin, Node } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformMixinToLess = createFromAdapter<Mixin>({
  fields: {
    name: m => m.value.name,
    params: (m, cache) => {
      const params = m.value.params;
      return params instanceof Node ? toLessNode(params, { cache }) : params;
    },
    rules: (m, cache) => {
      const rules = m.value.rules;
      return rules?.value ? rules.value.map((r: Node) => toLessNode(r, { cache })) : [];
    },
    condition: (m, cache) => {
      const guard = m.value.guard;
      return guard instanceof Node ? toLessNode(guard, { cache }) : guard;
    }
  },
  accept: selfVisitAccept()
});
