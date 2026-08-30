import { Node, NodeMap, LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A whitespace node
 */
export class WS extends Node {
  value: string

  constructor(
    value?: string | NodeMap,
    location?: LocationInfo
  ) {
    if (!value) {
      super({ value: ' ' })
      return
    }
    super(value, location)
  }

  eval(context: Context) {
    if (!context.inCustom) {
      this.value = ' '
    }
    return this
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.ws()`)
  }
}
WS.prototype.type = 'WS'

export const ws =
  (value?: string | NodeMap, location?: LocationInfo) =>
    new WS(value, location)