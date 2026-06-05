import { type Context } from '../context.js';
import { Node, F_VISIBLE, F_STATIC, defineType, type LocationInfo } from './node.js';

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

  constructor(value: string, options?: CommentOptions, location?: LocationInfo) {
    super(value, options, location);
    this.addFlag(F_STATIC);
    if (options?.lineComment || value.startsWith('//')) {
      this.removeFlag(F_VISIBLE);
    }
  }

  override resolve(_context: Context): this {
    return this;
  }
}
export const comment = defineType(Comment, 'Comment');
