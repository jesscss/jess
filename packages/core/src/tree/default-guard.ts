import { type Context } from '../context';
import { Node, defineType } from './node';
import { Bool } from './bool';
import { type PrintOptions, getPrintOptions } from './util/print.js';

export interface DefaultGuard extends Node<string> {
  eval(context: Context): Bool;
}

export class DefaultGuard extends Node<string> {
  type = 'DefaultGuard' as const;
  shortType = 'defaultguard' as const;

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('default', this);
    return w.getSince(mark);
  }

  override evalNode(context: Context): Bool {
    return new Bool(Boolean(context.isDefault));
  }
}
export const defaultguard = defineType(DefaultGuard, 'DefaultGuard');