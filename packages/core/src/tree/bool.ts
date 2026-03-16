import type { Context } from '../context.js';
import { Node, F_STATIC, defineType, type LocationInfo, type NodeOptions, type TreeContext } from './node.js';
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
  static override childKeys = null as null;

  value!: boolean;

  declare readonly data: Readonly<boolean>;

  constructor(
    value: boolean,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value as any, options, location, treeContext);
    this.value = value;
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

/** Compat: synthesize .data from instance fields */
Object.defineProperty(Bool.prototype, 'data', {
  get(this: Bool) { return this.value; },
  configurable: true,
  enumerable: true
});

export const bool = defineType(Bool, 'Bool');
