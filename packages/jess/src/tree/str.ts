import { Node } from '.'
import type { ILocationInfo } from './node'

/**
 * References a string value that needs to
 * be escaped for module output 
 */
export class Str extends Node {
  value: string

  toModule() {
    return JSON.stringify(this.value)
  }
}

export const str =
  (value: string, location?: ILocationInfo) =>
    new Str(value, location)