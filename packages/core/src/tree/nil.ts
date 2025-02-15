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
  type = 'Nil'
  shortType = 'nil'
  allowRoot = true
  allowRuleRoot = true

  constructor(
    value?: any,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext) {
    super('', options, location, treeContext)
  }

  override toTrimmedString() { return '' }
}

export const nil = defineType(Nil, 'Nil')