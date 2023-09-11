import { Node, defineType } from './node'

/**
 * A comment node
 */
export class Comment extends Node<string> {}

export const comment = defineType(Comment, 'Comment')
