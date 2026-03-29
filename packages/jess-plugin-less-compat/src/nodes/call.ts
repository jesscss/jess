import { Call, Node } from '@jesscss/core';
import { createFromAdapter, childrenAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformCallToLess = createFromAdapter<Call>({
  fields: {
    name: c => c.get('name'),
    args: (c, cache) => {
      const args = c.get('args');
      if (!args) {
        return [];
      }
      return args.get('value').map((arg: any) =>
        arg instanceof Node ? toLessNode(arg, { cache }) : arg
      );
    },
    index: (c) => {
      const loc = c.location;
      return loc.length ? loc[0] : undefined;
    }
  },
  accept: childrenAccept((c) => {
    const args = c.get('args');
    const argsValue = args?.get('value');
    return argsValue?.length
      ? argsValue.filter((a: any) => a instanceof Node) as Node[]
      : [];
  })
});
