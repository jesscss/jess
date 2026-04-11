import { defineType, Node } from './node.js';
import { isNode } from './util/is-node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<Node | string | undefined> {
  get name(): string {
    let { value } = this;
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

export const rest = defineType(Rest, 'Rest');