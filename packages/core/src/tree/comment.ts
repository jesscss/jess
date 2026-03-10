import { type Context } from '../context.js';
import { Node, F_VISIBLE, F_STATIC, defineType, type LocationInfo, type TreeContext } from './node.js';

export type CommentOptions = {
  lineComment?: boolean;
};

export interface Comment extends Node<string, CommentOptions> {
  type: 'Comment';
  shortType: 'comment';
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
    if (this.options.lineComment || value.startsWith('//')) {
      this.removeFlag(F_VISIBLE);
    }
  }
}
export const comment = defineType(Comment, 'Comment');
