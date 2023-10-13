import { Node, defineType } from './node'

/**
 * Custom identifiers
 *   .e.g. --ident or [ident]
 */
export class Custom extends Node<string> {}
export const custom = defineType(Custom, 'Custom')