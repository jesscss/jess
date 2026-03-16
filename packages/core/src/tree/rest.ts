import { defineType, Node, type LocationInfo, type TreeContext, type NodeOptions } from './node.js';
import { isNode } from './util/is-node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export interface Rest {
  type: 'Rest';
  shortType: 'rest';
}
export class Rest extends Node<Node | string | undefined> {
  static override childKeys = ['value'] as const;

  value: Node | string | undefined;

  declare readonly data: Readonly<Node | string | undefined>;

  constructor(value?: Node | string, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  get name(): string {
    let value = this.value;
    if (value) {
      if (isNode(value)) {
        return value.toString();
      }
      return `$${value}`;
    }
    return '';
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('...$');
    w.add(this.name);
    return w.getSince(mark);
  }
}

/** Compat: synthesize .data from instance fields */
Object.defineProperty(Rest.prototype, 'data', {
  get(this: Rest) {
    return this.value;
  },
  configurable: true,
  enumerable: true
});

export const rest = defineType(Rest, 'Rest');