import { Node, defineType } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A generic value that needs to
 * be escaped for module output
 */
export class Anonymous extends Node<string> {
  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.anon(${JSON.stringify(this.value)})`, this.location)
  }
}

export const anon = defineType(Anonymous, 'Anonymous', 'anon')