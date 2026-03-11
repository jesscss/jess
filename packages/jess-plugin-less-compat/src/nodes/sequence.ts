import { Sequence, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { fromLessNode } from '../transform/from-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess Sequence (space-separated value list) to a Less-compatible Expression.
 *
 * This is critical for Less plugins that traverse into declaration values (e.g. preEval visitors
 * that rewrite variables inside custom properties).
 */
export function transformSequenceToLess(
  jessSequence: Sequence,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessSequence, cache, (prop, target) => {
    const seq = target as Sequence;

    if (prop === 'type') {
      return mapJessTypeToLessType(seq.type);
    }

    // Less Expression nodes expose their members via `.value` as an array.
    if (prop === 'value') {
      return (seq.data ?? [])
        .map((item: any) => item instanceof Node ? toLessNode(item, { cache }) : item)
        .filter((item: any) => item !== undefined && item !== null);
    }

    // Allow array-like access patterns some Less visitors use.
    if (prop === 'length') {
      return (seq.data ?? []).filter((v: any) => v !== undefined && v !== null).length;
    }
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      const idx = Number(prop);
      const arr = (seq.data ?? []).filter((v: any) => v !== undefined && v !== null);
      const item = arr[idx];
      return item instanceof Node ? toLessNode(item, { cache }) : item;
    }

    // Traverse children (sequence members) without re-entering Jess visitor recursion.
    if (prop === 'accept') {
      return function(visitor: any) {
        const raw = seq.data ?? [];
        if (!Array.isArray(raw) || raw.length === 0) {
          return seq;
        }

        for (let i = 0; i < raw.length; i++) {
          const item = raw[i];
          if (item === undefined || item === null) {
            continue;
          }
          const lessItem = item instanceof Node ? toLessNode(item, { cache }) : item;
          if (!lessItem || typeof visitor?.visit !== 'function') {
            continue;
          }

          const visited = visitor.visit(lessItem);
          // If a replacing visitor returned a new Less node, write it back into the Jess Sequence.
          if (visited && visited !== lessItem && typeof visited === 'object' && (visited as any).type) {
            try {
              const jessReplacement = fromLessNode(visited, { cache: new WeakMap() });
              // Preserve whitespace semantics from the original node inside the Sequence.
              // This is especially important for custom property values where spacing is significant.
              if (item instanceof Node) {
                (jessReplacement as any).pre = (item as any).pre;
                (jessReplacement as any).post = (item as any).post;
              }
              seq.adopt(jessReplacement);
              (seq.data as any[])[i] = jessReplacement;
            } catch {
              // If we can't convert it back, ignore (visitor may be creating unsupported nodes)
            }
          }
        }

        return seq;
      };
    }

    return undefined;
  });
}
