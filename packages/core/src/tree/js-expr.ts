import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { cast } from './util/cast.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderTextResult
} from './util/render-buffer.js';
import { Nil } from './nil.js';

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
    return this.evaluateJavaScript().then(result => cast(result));
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return pipe(
      () => this.evaluateJavaScript(),
      result => this.renderJavaScriptResult(context, result, bufferOrOptions, options)
    );
  }

  private async evaluateJavaScript(): Promise<unknown> {
    return eval(this.value);
  }

  private renderJavaScriptResult(
    context: Context,
    result: unknown,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (
      typeof result === 'string'
      || typeof result === 'number'
      || typeof result === 'boolean'
      || result === null
      || result === undefined
    ) {
      const out = result === null || result === undefined ? '' : String(result);
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderTextResult(bufferOrOptions, out)
        : out;
    }
    const node = cast(result);
    if (node instanceof Nil) {
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderTextResult(bufferOrOptions, '')
        : '';
    }
    return isRenderBuffer(bufferOrOptions)
      ? node.render(context, bufferOrOptions, options)
      : node.render(context, bufferOrOptions);
  }
}
export const jsexpr = defineType(JsExpression, 'JsExpression', 'jsexpr');
