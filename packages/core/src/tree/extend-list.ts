import { Node, F_VISIBLE, defineType, type NodeOptions } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Extend } from './extend.js';
import type { Context } from '../context.js';

export type ExtendListChildData = { value: Extend[] };

/**
 * An extend statement list with no rules
 *
 * e.g.
 *  .a:extend(.b), .c:extend(.d);
 */
export interface ExtendList extends Node<Extend[], NodeOptions, ExtendListChildData> {
  type: 'ExtendList';
  shortType: 'extendlist';
  eval(context: Context): ExtendList;
}

export class ExtendList extends Node<Extend[], NodeOptions, ExtendListChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ readonly _value!: Extend[];

  constructor(value: Extend[], options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this._value = value;
    for (const child of value) {
      if (child instanceof Node) {
        this.adopt(child);
      }
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.removeFlag(F_VISIBLE);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    for (const child of this.get('value', options.context)) {
      child.toTrimmedString(options);
    }
    // toTrimmedString side effect is already emitted to writer; getSince captures it. Add ';'
    w.add(';');
    return w.getSince(mark);
  }
}

export const extendList = defineType(ExtendList, 'ExtendList');
