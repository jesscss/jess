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
      return loc.length ? loc[0] : undefined;
    }
  },
  accept: childrenAccept((c) => {
    const args = c.args;
    const argsValue = args?.value;
    return argsValue?.length
      ? argsValue.filter((a): a is Node => a instanceof Node)
      : [];
  })
});
