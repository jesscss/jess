import { Call, Node } from '@jesscss/core';
import { createFromAdapter, childrenAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformCallToLess = createFromAdapter<Call>({
  fields: {
    name: c => c.name,
    args: (c, cache) => {
      const args = c.args;
      if (!args) {
        return [];
      }
      return args.value.map((arg: any) =>
        arg instanceof Node ? toLessNode(arg, { cache }) : arg
      );
    },
    index: (c) => {
      const loc = c.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }
  },
  accept: childrenAccept((c) => {
    const args = c.args;
    return args?.value?.length
      ? args.value.filter((a: any) => a instanceof Node) as Node[]
      : [];
  })
});
