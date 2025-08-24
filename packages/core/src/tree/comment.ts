import { type Context } from '../context';
import { Node, F_VISIBLE, defineType } from './node';

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
    if (!this.options.lineComment) {
      this.addFlag(F_VISIBLE);
    } else {
      this.removeFlag(F_VISIBLE);
    }
    return this as Comment;
  }
}
export const comment = defineType(Comment, 'Comment');
