import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { type LocationInfo, type NodeOptions } from './node-base.js';
import { Bool, createPublicBool } from './bool.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export interface DefaultGuard extends Node<string> {
  eval(context: Context): Bool;
}

export class DefaultGuard extends Node<string> {
  static override childKeys = null;

  constructor(value: string, options?: NodeOptions, location?: LocationInfo) {
    super(value, options, location);
    // Each node owns its field values (invariant 7): the base stores nothing.
    this.value = value;
  }

  override toTrimmedString(options?: PrintOptions) {
    getPrintOptions(options).writer.add('default', this);
    return 'default';
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add('default', this);
  }

  override evalNode(context: Context): Bool {
    return createPublicBool(Boolean(context.isDefault));
  }

  override resolve(context: Context): Bool {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string | MaybePromise<string> {
    const out = String(Boolean(context.isDefault));
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(bufferOrOptions, out);
    }
    getPrintOptions(bufferOrOptions).writer.add(out, this);
    return out;
  }
}
export const defaultguard = defineType(DefaultGuard, 'DefaultGuard');
