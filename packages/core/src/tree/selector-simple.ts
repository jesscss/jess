import { type Context } from '../context'
import { type Node, type NodeTypeMap } from './node'
import { Selector } from './selector'

export abstract class SimpleSelector<
  T extends Node | NodeTypeMap | string = Node | string | NodeTypeMap
> extends Selector<T> {
  async eval(context: Context): Promise<Node> {
    return this
  }
}