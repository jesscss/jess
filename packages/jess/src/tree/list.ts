import { Node } from '.'
import type { NodeMap, ILocationInfo, Primitive } from './node'

/**
 * A list of expressions
 * 
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 */
export class List extends Node {
  value: Primitive[]
  
  toString() {
    return this.value.join(', ')
  }

  toModule() { return '' }
}

export const list =
  (value: Primitive[] | NodeMap, location?: ILocationInfo) =>
    new List(value, location)