import { Sequence, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';

export const transformSequenceToLess = createFromAdapter<Sequence>({
  fields: {
    value: (seq, cache) =>
      (seq.get('value') ?? [])
        .map((item: any) => item instanceof Node ? toLessNode(item, { cache }) : item)
        .filter((item: any) => item != null),
    length: seq =>
      (seq.get('value') ?? []).filter((v: any) => v != null).length
  },
  dynamicField: (prop, seq, cache) => {
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      const idx = Number(prop);
      const arr = (seq.get('value') ?? []).filter((v: any) => v != null);
      const item = arr[idx];
      return item instanceof Node ? toLessNode(item, { cache }) : item;
    }
    return undefined;
  },
  accept: (seq, visitor, cache) => {
    const raw = seq.get('value') ?? [];
    if (!Array.isArray(raw) || raw.length === 0) {
      return seq;
    }

    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (item == null) {
        continue;
      }
      const lessItem = item instanceof Node ? toLessNode(item, { cache }) : item;
      if (!lessItem || typeof visitor?.visit !== 'function') {
        continue;
      }

      const visited = visitor.visit(lessItem);
      if (visited && visited !== lessItem && typeof visited === 'object' && 'type' in visited) {
        try {
          const jessReplacement = fromLessNode(visited, { cache: new WeakMap() });
          if (item instanceof Node) {
            jessReplacement.pre = item.pre;
            jessReplacement.post = item.post;
          }
          seq.adopt(jessReplacement);
          const seqArr = seq.get('value') as Node[];
          seqArr[i] = jessReplacement;
          seq.setData('value', seqArr);
        } catch {
          // If we can't convert it back, ignore
        }
      }
    }
    return seq;
  }
});
