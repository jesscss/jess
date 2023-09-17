import { Node, defineType } from './node'

/**
 * Any generic or unknown value
 */
export class Anonymous extends Node<string> {
  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.any(${JSON.stringify(this.value)})`, this.location)
  // }
}

export const any = defineType(Anonymous, 'Anonymous', 'any')