import { Node, defineType } from './node'

/**
 * Any generic or unknown value
 */
export class Anonymous extends Node<string> {}
export const any = defineType(Anonymous, 'Anonymous', 'any')