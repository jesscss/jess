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
  static override childKeys = null as null;

  value!: string;

  declare readonly data: Readonly<string>;

  constructor(value: string, options?: CommentOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlag(F_STATIC);
    if (this.options.lineComment || value.startsWith('//')) {
      this.removeFlag(F_VISIBLE);
    }
  }
}

/** Compat: synthesize .data from instance fields */
Object.defineProperty(Comment.prototype, 'data', {
  get(this: Comment) { return this.value; },
  configurable: true,
  enumerable: true
});

export const comment = defineType(Comment, 'Comment');
