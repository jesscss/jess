import { type Context } from '../context';
import { Node, defineType } from './node';
import { cast } from './util/cast';
import { type PrintOptions, getPrintOptions } from './util/print';

/**
 * Deprecated Less feature
 *
 * @deprecated - use `@-use` instead
 */
export class JsExpression extends Node<string> {
  type = 'JsExpression' as const;
  shortType = 'jsexpr' as const;

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('`', this);
    w.add(this.value);
    w.add('`');
    return w.getSince(mark);
  }

  /**
   * @todo - install deno-bin to run scripts securely
   */
  override async evalNode(context: Context) {
    const result = await eval(this.value);
    return cast(result);
  }
}
export const jsexpr = defineType(JsExpression, 'JsExpression', 'jsexpr');