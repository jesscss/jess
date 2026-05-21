import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { Bool } from './bool.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import {
  renderChosenOutput,
  type RenderBuffer
} from './util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export interface DefaultGuard extends Node<string> {
  eval(context: Context): Bool;
}

export class DefaultGuard extends Node<string> {
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

  override resolve(context: Context): Bool {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return renderChosenOutput(context, this.evalNode(context), bufferOrOptions, options);
  }
}
export const defaultguard = defineType(DefaultGuard, 'DefaultGuard');
