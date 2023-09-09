import type { NodeMap, LocationInfo } from './node'
import { Node } from './node'

/**
 * A whitespace node
 * @note -
 */
export class WS extends Node<{ value: string }> {}
WS.prototype.type = 'WS'

export const ws =
  (value?: string | NodeMap, location?: LocationInfo) =>
    new WS(value, location)