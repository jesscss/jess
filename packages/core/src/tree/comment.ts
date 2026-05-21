import { type Context } from '../context.js';
import { Node, F_VISIBLE, F_STATIC, defineType, type LocationInfo, type TreeContext } from './node.js';
import type { PrintOptions } from './util/print.js';
import {
  renderSourceOutput,
  type RenderBuffer
} from './util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export type CommentOptions = {
  lineComment?: boolean;
};

export interface Comment extends Node<string, CommentOptions> {
  eval(context: Context): Comment;
}

/**
 * A comment node
 */
export class Comment extends Node<string, CommentOptions> {
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: string, options?: CommentOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlag(F_STATIC);
    if (options?.lineComment || value.startsWith('//')) {
      this.removeFlag(F_VISIBLE);
    }
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    return renderSourceOutput(context, this, bufferOrOptions, options);
  }

  override resolve(_context: Context): this {
    return this;
  }
}
export const comment = defineType(Comment, 'Comment');
