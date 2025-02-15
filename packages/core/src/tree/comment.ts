import { type Context } from '../context'
import { Node, defineType } from './node'

export type CommentOptions = {
  lineComment?: boolean
}

/**
 * A comment node
 */
export class Comment extends Node<string, CommentOptions> {
  type = 'Comment'
  shortType = 'comment'
  override allowRoot = true
  override allowRuleRoot = true

  override async evalNode(context: Context): Promise<Comment> {
    this.visible = !this.options.lineComment
    return this
  }
}
export const comment = defineType(Comment, 'Comment')
