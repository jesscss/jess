import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { cast } from './util/cast.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderText
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
  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('`', this);
    w.add(this.value);
    w.add('`');
  }

  override toTrimmedString(options?: PrintOptions): string {
    const out = `\`${this.value}\``;
    getPrintOptions(options).writer.add(out, this);
    return out;
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
    return this.evaluateJavaScript().then(result => this.renderJavaScriptResult(context, result, bufferOrOptions, options));
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
        ? writeRenderText(bufferOrOptions, out)
        : out;
    }
    const node = cast(result);
    if (node instanceof Nil) {
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderText(bufferOrOptions, '')
        : '';
    }
    return isRenderBuffer(bufferOrOptions)
      ? node.render(context, bufferOrOptions, options)
      : node.render(context, bufferOrOptions);
  }
}
export const jsexpr = defineType(JsExpression, 'JsExpression', 'jsexpr');
