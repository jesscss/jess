import { LocationInfo, Node } from './node'

/**
 * A Node type that outputs nothing.
 * We use this for nodes that expect other
 * nodes in the form of { value: any }
 */
export class Nil extends Node {
  value: any
  constructor(
    value?: any,
    location?: LocationInfo
  ) {
    super('', location)
  }
  eval() { return this }
  toString() { return '' }
  toCSS() { return '' }
  toModule() { return '' }
}
Nil.prototype.allowRoot = true
Nil.prototype.allowRuleRoot = true
Nil.prototype.type = 'Nil'

export const nil =
  (value?: any, location?: LocationInfo) =>
    new Nil(value, location)