import { List, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

function getFilteredValue(list: List, cache?: WeakMap<any, any>) {
  const data = list.get('value');
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

export const transformListToLess = createFromAdapter<List>({
  fields: {
    value: (l, cache) => getFilteredValue(l, cache),
    length: (l, cache) => getFilteredValue(l, cache).length
  },
  dynamicField: (prop, l, cache) => {
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      return getFilteredValue(l, cache)[parseInt(prop, 10)];
    }
    return undefined;
  },
  accept: (list, visitor, cache) => {
    const value = list.get('value');
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
    return cache?.has(list) ? cache.get(list) : list;
  }
});
