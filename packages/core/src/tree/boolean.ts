import { Node, defineType } from './node'

export class Boolean extends Node<boolean> {}
export const bool = defineType(Boolean, 'Boolean', 'bool')