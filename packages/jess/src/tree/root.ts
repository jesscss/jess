import { Node, NodeMap, ILocationInfo } from './node'

/**
 * Contains a list of rules
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