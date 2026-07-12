import { Node, defineType } from './node'

export type GeneralNodeType =
  'Name'
  | 'Keyword'
  | 'Url'
  | 'Flag'
  | 'CustomProp'
  | 'CustomIdent'
  | 'Anonymous'

export type GeneralOptions<T extends string> = {
  type: T
}
/**
 * Any general value that doesn't have a specific Jess node.
 * Has a `type` option to specify the general node type.
 */
export class General<
  T extends string = GeneralNodeType
> extends Node<string, GeneralOptions<T>> {}
defineType(General, 'General')