import { type Context } from '../context'
import { Node, defineType } from './node'

export type CommentOptions = {
  lineComment?: boolean
}

/**
 * A comment node
 */
export class Comment extends Node<string, CommentOptions> {
  async eval(context: Context): Promise<Comment> {
    this.evaluated = true
    this.visible = !this.options.lineComment
    return this
  }
}
export const comment = defineType(Comment, 'Comment')
