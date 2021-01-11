import { Node } from '.'
import type { ILocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * References a string value that needs to
 * be escaped for module output 
 */
export class Str extends Node {
  value: string

  toModule(context: Context, out: OutputCollector) {
    out.add(JSON.stringify(this.value), this.location)
  }
}

export const str =
  (value: string, location?: ILocationInfo) =>
    new Str(value, location)