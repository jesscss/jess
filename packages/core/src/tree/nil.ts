import {
  Node,
  defineType,
  type LocationInfo,
  type NodeOptions,
  type FileInfo
} from './node'

/**
 * A Node type that outputs nothing.
 *
 * We need this for things like rulesets,
 * which need dynamically-linked nodes
 */
export class Nil extends Node<undefined> {
  evaluated: true = true

  constructor(
    value?: any,
    location?: LocationInfo | 0,
    options?: NodeOptions,
    fileInfo?: FileInfo) {
    super(undefined, location, options, fileInfo)
  }

  async eval() { return this }
  toTrimmedString() { return '' }
}
Nil.prototype.allowRoot = true
Nil.prototype.allowRuleRoot = true

export const nil = defineType(Nil, 'Nil')