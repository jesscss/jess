import { Node, Nil } from '.'
import { LocationInfo, NodeMap } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * The '&' selector element
 */
export class Ampersand extends Node {
  value: string

  constructor(
    value?: string | NodeMap,
    location?: LocationInfo
  ) {
    value = value || '&'
    super(value, location)
  }

  /** Return the parent selector from context */
  eval(context: Context) {
    const frame = context.frames[0]
    if (frame) {
      return frame.clone()
    }
    return new Nil()
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.amp()`, this.location)
  }
}

export const amp =
  (value?: string | NodeMap, location?: LocationInfo) =>
    new Ampersand(value, location)