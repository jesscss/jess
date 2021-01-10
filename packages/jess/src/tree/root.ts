import { Node, NodeMap, ILocationInfo } from './node'

/**
 * The root node. Contains a collection of nodes
 */
export class Root extends Node {
  value: Node[]

  toModule() {
    return ''
  }
}

export const root =
  (value: Node[] | NodeMap, location?: ILocationInfo) =>
    new Root(value, location)