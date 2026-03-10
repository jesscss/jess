import type { Context } from '../context.js';
import { Node, F_STATIC, defineType } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

export interface Bool extends Node<boolean> {
  type: 'Bool';
  shortType: 'bool';
  eval(context: Context): Bool;
}

/**
 * A boolean. Named `Bool` to avoid conflict with the built-in `Boolean` class.
 */
export class Bool extends Node<boolean> {
  constructor(...args: ConstructorParameters<typeof Node<boolean>>) {
    super(...args);
    this.addFlag(F_STATIC);
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other instanceof Bool) {
      return this.value === other.value ? 0 : undefined;
    }
    return undefined;
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add(this.value ? 'true' : 'false', this);
    return w.getSince(mark);
  }
}
export const bool = defineType(Bool, 'Bool');