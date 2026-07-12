import { AtRule, Node } from '@jesscss/core';
import { createFromAdapter, childrenAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformAtRuleToLess = createFromAdapter<AtRule>({
  fields: {
    name: a => a.get('name'),
    value: (a, cache) => {
      const prelude = a.get('prelude');
      return prelude instanceof Node ? toLessNode(prelude, { cache }) : prelude;
    },
    rules: (a, cache) => {
      const rules = a.get('rules');
      return rules ? rules.value.map((r: Node) => toLessNode(r, { cache })) : [];
    }
  },
  accept: childrenAccept((a) => {
    const rules = a.get('rules');
    return rules?.value?.length ? [...rules.value] : [];
  })
});
