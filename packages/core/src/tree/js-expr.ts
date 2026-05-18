import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { cast } from './util/cast.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderedOutput
} from './util/render-buffer.js';

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
  override evalNode(_context: Context): Promise<Node> {
    return (async () => {
      const result = await eval(this.value);
      return cast(result);
    })();
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      const writeEvaluated = (node: Node): string => {
        return writeRenderedOutput(bufferOrOptions, node, context, options);
      };
      const evaluated = this.evalNode(context);
      return isThenable(evaluated)
        ? evaluated.then(writeEvaluated)
        : writeEvaluated(evaluated);
    }
    return super.render(context, bufferOrOptions);
  }
}
export const jsexpr = defineType(JsExpression, 'JsExpression', 'jsexpr');
