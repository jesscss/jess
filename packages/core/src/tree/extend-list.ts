import { Node, defineType } from './node';
import { type PrintOptions, getPrintOptions } from './util/print';
import type { Extend } from './extend';
import type { Context } from '../context';

/**
 * An extend statement list with no rules
 *
 * e.g.
 *  .a:extend(.b), .c:extend(.d);
 */
export interface ExtendList extends Node<Extend[]> {
  eval(context: Context): ExtendList;
}

export class ExtendList extends Node<Extend[]> {
  type = 'ExtendList' as const;
  shortType = 'extendlist' as const;
  override allowRoot = true;
  override allowRuleRoot = true;
  override state = 0b0000; // 0b0000 means no flags are set

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const base = super.toTrimmedString(options);
    // base is already emitted to writer; but getSince captured it. Add ';'
    w.add(';');
    return w.getSince(mark);
  }
}

export const extendList = defineType(ExtendList, 'ExtendList');