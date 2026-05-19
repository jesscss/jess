import { Node, F_VISIBLE, defineType, type NodeLocation, type NodeOptions, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Extend } from './extend.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderedOutput
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

  constructor(value: Extend[], options?: NodeOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.removeFlag(F_VISIBLE);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    void super.toTrimmedString(options);
    // toTrimmedString side effect is already emitted to writer; getSince captures it. Add ';'
    w.add(';');
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderedOutput(bufferOrOptions, new Nil(), context, options);
    }
    return super.render(context, bufferOrOptions);
  }
}

export const extendList = defineType(ExtendList, 'ExtendList');
