import { Node, NodeMap, ILocationInfo } from './node'

type RuleValue = NodeMap & {
  sels: Node
  rules: Node[]
}
/**
 * A qualified rule
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Rule extends Node {
  sels: Node
  rules: Node[]

  toModule() {
    return ''
  }
}

export const rule =
  (value: RuleValue, location?: ILocationInfo) =>
    new Rule(value, location)