import { defineType, Node } from './node';
import { isNode } from './util/is-node';
import { type PrintOptions, getPrintOptions } from './util/print';

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<Node | string | undefined> {
  type = 'Rest' as const;
  shortType = 'rest' as const;

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