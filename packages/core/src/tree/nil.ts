import {
  Node,
  defineType,
  type LocationInfo,
  type NodeOptions
} from './node'
import type { TreeContext } from '../context'

export interface Nil extends Node<''> {
  valueOf(): ''
}

/**
 * A Node type that outputs nothing.
 *
 * We need this for things like rulesets,
 * which need dynamically-linked nodes
 */
export class Nil extends Node<''> {
  _evaluated: true = true

  constructor(
    value?: any,
    options?: NodeOptions,
    location?: LocationInfo | 0,
    treeContext?: TreeContext) {
    super('', options, location, treeContext)
  }

  async eval() { return this }
  toTrimmedString() { return '' }
}
Nil.prototype.allowRoot = true
Nil.prototype.allowRuleRoot = true

export const nil = defineType(Nil, 'Nil')