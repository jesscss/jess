import { ILocationInfo, Node } from './node'

/**
 * A Node type that outputs nothing.
 * We use this for nodes that expect other
 * nodes in the form of { value: any }
 */
export class Nil extends Node {
  value: any
  constructor(
    value?: any,
    location?: ILocationInfo
  ) {
    super('', location)
  }
  eval() { return this }
  toString() { return '' }
  toModule() { return '' }
}

export const nil =
  (value?: any, location?: ILocationInfo) =>
    new Nil(value, location)