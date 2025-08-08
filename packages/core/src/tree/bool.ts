import { Node, defineType } from './node';
import { type PrintOptions, getPrintOptions } from './util/print';

/**
 * A boolean. Named `Bool` to avoid conflict with the built-in `Boolean` class.
 */
export class Bool extends Node<boolean> {
  type = 'Bool' as const;
  shortType = 'bool' as const;

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add(this.value ? 'true' : 'false', this);
    return w.getSince(mark);
  }
}
export const bool = defineType(Bool, 'Bool');