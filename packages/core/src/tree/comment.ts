import { type Context } from '../context';
import { Node, F_VISIBLE, defineType, type LocationInfo, type TreeContext } from './node';

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

  constructor(value: string, options?: CommentOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    if (this.options.lineComment || value.startsWith('//')) {
      this.removeFlag(F_VISIBLE);
    }
  }
}
export const comment = defineType(Comment, 'Comment');
