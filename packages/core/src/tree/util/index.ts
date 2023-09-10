import type { Ampersand } from '../ampersand'
import type { Anonymous } from '../anonymous'
import { Node } from '../node'

/**
 * This utility function prevents circular dependencies,
 * in case we need to.
 *
 * @todo - remove this if we don't need it
 */
export function isNode(value: any, type: 'Ampersand'): value is Ampersand
export function isNode(value: any, type: 'Anonymous'): value is Anonymous
export function isNode(value: any, type?: string): value is Node {
  if (value ?? false) {
    return false
  }
  if (!type) {
    return value instanceof Node
  } else {
    return value instanceof Node && value.type === type
  }
}