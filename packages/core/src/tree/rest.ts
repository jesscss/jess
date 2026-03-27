import type { Context } from '../context.js';
import { defineType, Node, type OptionalLocation, type TreeContext, type NodeOptions } from './node.js';
import { isNode } from './util/is-node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { getField } from './util/field-helpers.js';

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

  constructor(value?: Node | string, options?: NodeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  private _getValue(context?: Context): Node | string | undefined {
    return context
      ? getField<Node | string | undefined>(this, 'value', context)
      : this.value;
  }

  private _getName(context?: Context): string {
    const value = this._getValue(context);
    if (value) {
      if (isNode(value)) {
        return value.toString();
      }
      return `$${value}`;
    }
    return '';
  }

  get name(): string {
    return this._getName();
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('...$');
    w.add(this._getName(options.context));
    return w.getSince(mark);
  }
}

export const rest = defineType(Rest, 'Rest');
