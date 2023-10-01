import { Node, defineType } from './node'

export type CommentOptions = {
  lineComment?: boolean
}

/**
 * A comment node
 */
export class Comment extends Node<string, CommentOptions> {}
export const comment = defineType(Comment, 'Comment')
