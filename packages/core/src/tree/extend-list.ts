import { Node, F_VISIBLE, defineType, type NodeLocation, type NodeOptions } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { Extend } from './extend.js';
import type { Context } from '../context.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
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
export interface ExtendList extends Node<Extend[], NodeOptions> {
  eval(context: Context): ExtendList;
}

export class ExtendList extends Node<Extend[], NodeOptions> {
  static override childKeys = ['value'] as const;

  readonly value: Extend[];

  constructor(value: Extend[], options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    super(value, options, location);
    // Invariant 7: each node owns its value; the base stores nothing.
    this.value = value;
    this._treeContext = treeContext;
    this.removeFlag(F_VISIBLE);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    super.writeSyntax(options);
    // writeSyntax side effect is already emitted to writer. Add ';'.
    options.writer.add(';');
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
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
    const nodes = this.value;
    for (let i = 0; i < nodes.length; i++) {
      const out = nodes[i]!.runEffect(context);
      if (isThenable(out)) {
        return this.renderRemainingExtendEffects(context, out, i + 1);
      }
    }
    return undefined;
  }

  private async renderRemainingExtendEffects(
    context: Context,
    pending: Promise<void>,
    index: number
  ): Promise<void> {
    await pending;
    const nodes = this.value;
    for (let i = index; i < nodes.length; i++) {
      await nodes[i]!.runEffect(context);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const extendList = defineType(ExtendList as any, 'ExtendList');
