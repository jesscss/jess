import { type Context } from '../context.js';
import { Node, F_VISIBLE, F_STATIC, defineType, type OptionalLocation, type TreeContext } from './node.js';

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
  static override childKeys = null as null;

  value!: string;
  lineComment: boolean;

  constructor(value: string, options?: CommentOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    this.lineComment = !!options?.lineComment;
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlag(F_STATIC);
    if (this.lineComment || value.startsWith('//')) {
      this.removeFlag(F_VISIBLE);
    }
  }
}

export const comment = defineType(Comment, 'Comment');
