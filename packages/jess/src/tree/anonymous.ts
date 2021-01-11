import { Node } from '.'
import type { ILocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A generic value that needs to
 * be escaped for module output 
 */
export class Anonymous extends Node {
  value: string

  toModule(context: Context, out: OutputCollector) {
    out.add(JSON.stringify(this.value), this.location)
  }
}

export const anon =
  (value: string, location?: ILocationInfo) =>
    new Anonymous(value, location)