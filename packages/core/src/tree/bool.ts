import { Node, defineType } from './node'

export class Bool extends Node<boolean> {}
export const bool = defineType(Bool, 'Bool')