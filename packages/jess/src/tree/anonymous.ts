import { Node, LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A generic value that needs to
 * be escaped for module output 
 */
export class Anonymous extends Node {
  value: string

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.anon(${JSON.stringify(this.value)})`, this.location)
  }
}
Anonymous.prototype.type = 'Anonymous'

export const anon =
  (value: string, location?: LocationInfo) =>
    new Anonymous(value, location)