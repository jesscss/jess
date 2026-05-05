import type { PrintOptions } from '..';
import { getPrintOptions } from './util/print.js';
import { defineType, type Node } from './node.js';
import { Sequence } from './sequence.js';

/**
 * Used by `@media`, `@supports`, and `@container`
 *
 * This just helps identify conditions if we need to
 * merge them later.
 *
 * @todo - add more structure?
 */
export class QueryCondition extends Sequence {
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { value } = this;
    let length = value.length;

    if (length === 0) {
      return '';
    }

    const emitTrimmed = (node: Node) => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        node.toString(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    };

    emitTrimmed(value[0]!);

    // Space out sub-nodes
    for (let i = 1; i < length; i++) {
      let node = value[i]!;
      w.add(' ');
      emitTrimmed(node);
    }
    return w.getSince(mark);
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');
