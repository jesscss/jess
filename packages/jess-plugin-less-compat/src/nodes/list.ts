import { List, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import type { LessNode } from '../types.js';

function getFilteredValue(list: List, cache?: WeakMap<any, any>) {
  const data = list.value;
  if (Array.isArray(data)) {
    return data
      .map((item: any) => {
        if (!item) {
          return null;
        }
        if (item instanceof Node) {
          return toLessNode(item, { cache }) || null;
        }
        return item;
      })
      .filter((item: any) => item != null);
  }
  if (data != null) {
    if (data && typeof data === 'object' && 'type' in data) {
      const lessValue = toLessNode(data as Node, { cache });
      return lessValue ? [lessValue] : [];
    }
    return [data];
  }
  return [];
}

export const transformListToLess: (
  jessNode: List,
  cache?: WeakMap<Node, LessNode>
) => LessNode = createFromAdapter<List>({
  fields: {
    value: (l, cache) => getFilteredValue(l, cache),
    length: (l, cache) => getFilteredValue(l, cache).length
  },
  accept: (list, visitor, cache) => {
    const value = list.value;
    if (Array.isArray(value) && value.length > 0) {
      const lessItems = value
        .map((item: any) => item instanceof Node ? toLessNode(item, { cache }) : item)
        .filter((item: any) => item != null);
      if (lessItems.length > 0) {
        if (visitor.visitArray) {
          visitor.visitArray(lessItems);
        } else {
          for (const li of lessItems) {
            if (li?.accept) {
              li.accept(visitor);
            }
          }
        }
      }
    }
    return list;
  }
});
