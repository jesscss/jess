import { Node, type NodeTypeMap } from './node'

export abstract class SimpleSelector<T extends Node | NodeTypeMap | string = Node | string | NodeTypeMap> extends Node<T> {}