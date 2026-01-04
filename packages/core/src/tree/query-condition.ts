import type { PrintOptions } from '..';
import { getPrintOptions } from './util/print';
import { defineType } from './node';
import { Sequence } from './sequence';

/**
 * Used by `@media`, `@supports`, and `@container`
 *
 * This just helps identify conditions if we need to
 * merge them later.
 *
 * @todo - add more structure?
 */
export class QueryCondition extends Sequence {
  override type = 'QueryCondition';
  override shortType = 'query';

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { value } = this;
    let length = value.length;

    if (length === 0) {
      return '';
    }

    // Print first node as-is
    let node = value[0]!;
    let out = w.capture(() => node.toString(options));
    w.add(out.replace(/^\s*|\s*$/g, ''), node);

    // Space out sub-nodes
    for (let i = 1; i < length; i++) {
      let node = value[i]!;
      w.add(' ');
      let out = w.capture(() => node.toString(options));
      w.add(out.replace(/^\s*|\s*$/g, ''), node);
    }
    return w.getSince(mark);
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');