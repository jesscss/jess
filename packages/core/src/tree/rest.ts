import { defineType, Node } from './node.js';
import type { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';

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

  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('...$');
    const value = this.value;
    if (value) {
      if (isNode(value)) {
        value.writeSyntax(options);
      } else {
        w.add(`$${value}`, this);
      }
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export const rest = defineType(Rest, 'Rest');
