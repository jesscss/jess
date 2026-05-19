import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { Bool } from './bool.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderText
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
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(bufferOrOptions, context.isDefault ? 'true' : 'false');
    }
    const printOptions = getPrintOptions({ ...bufferOrOptions, context });
    const w = printOptions.writer!;
    const mark = w.mark();
    w.add(context.isDefault ? 'true' : 'false', this);
    return w.getSince(mark);
  }
}
export const defaultguard = defineType(DefaultGuard, 'DefaultGuard');
