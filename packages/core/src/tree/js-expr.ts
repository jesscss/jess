import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { cast } from './util/cast.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';

/**
 * Deprecated Less feature
 *
 * @deprecated - use `@-use` instead
 */
export interface JsExpression extends Node<string> {
  eval(context: Context): Promise<Node>;
}

export class JsExpression extends Node<string> {
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
   * @todo - Figure out pipe / MaybePromise when this is actually evaluating JS
   */
  override evalNode(context: Context): Promise<Node> {
    return (async () => {
      const result = await eval(this.value);
      return cast(result);
    })();
  }
}
export const jsexpr = defineType(JsExpression, 'JsExpression', 'jsexpr');