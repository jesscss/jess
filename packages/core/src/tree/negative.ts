import { Node, defineType, F_VISIBLE, F_NON_STATIC } from './node.js';
import type { Context } from '../context.js';
import { Dimension } from './dimension.js';
import { type MaybePromise, pipe, tryStep } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  renderNodeToBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

export class Negative extends Node<Node> {
  private renderNegativeSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('-');
    this.value.toString(options);
    return w.getSince(mark);
  }

  constructor(value: Node, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Negative operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderNegativeSyntax(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return renderNodeToBuffer(this, context, bufferOrOptions, options);
    }
    return super.render(context, bufferOrOptions);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.value.eval(context),
      tryStep((value: Node) => {
        if (!value.operate) {
          throw new TypeError(`Cannot operate on ${value.type}`);
        }
        return value.operate(new Dimension({ number: -1 }), '*', context);
      }, { rethrow: true })
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

export const negative = defineType(Negative, 'Negative');
