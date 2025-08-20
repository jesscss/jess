import { type Context } from '../context';
import { Node, defineType } from './node';

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
  type = 'Comment' as const;
  shortType = 'comment' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  override evalNode(context: Context): Comment {
    this.visible = !this.options.lineComment;
    return this as Comment;
  }
}
export const comment = defineType(Comment, 'Comment');
