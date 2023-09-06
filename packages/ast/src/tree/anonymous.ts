import { Node, defineType } from './node'

/**
 * Any generic or unknown value
 */
export class Anonymous extends Node<string> {
  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.anon(${JSON.stringify(this.value)})`, this.location)
  // }
}

export const anon = defineType<string>(Anonymous, 'Anonymous', 'anon')