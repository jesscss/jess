import { Node, F_VISIBLE, defineType, type NodeLocation, type NodeOptions } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { Extend } from './extend.js';
import type { Context } from '../context.js';
import { serialForEach, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  type RenderBuffer,
  renderInvisibleEffect
} from './util/render-buffer.js';

/**
 * An extend statement list with no rules
 *
 * e.g.
 *  .a:extend(.b), .c:extend(.d);
 */
export interface ExtendList extends Node<Extend[]> {
  eval(context: Context): ExtendList;
}

export class ExtendList extends Node<Extend[]> {
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: Extend[], options?: NodeOptions, location?: NodeLocation) {
    super(value, options, location);
    this.removeFlag(F_VISIBLE);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    super.writeSyntax(options);
    // writeSyntax side effect is already emitted to writer. Add ';'.
    options.writer.add(';');
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    if (this.value.length === 0) {
      options.writer.add(';', this);
      return ';';
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string | MaybePromise<string> {
    return renderInvisibleEffect(this.renderExtendEffects(context), bufferOrOptions);
  }

  private renderExtendEffects(context: Context): MaybePromise<void> {
    return serialForEach(this.value, node => node.render(context));
  }
}

export const extendList = defineType(ExtendList, 'ExtendList');
