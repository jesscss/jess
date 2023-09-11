import { Node, defineType } from './node'
import type { List } from './list'
import type { Ruleset } from './ruleset'

export type MixinValue<T = Ruleset> = {
  params?: List
  value: T
}

/**
 * This is just the body of a mixin
 * (an anonymous mixin)
 */
export class MixinBody<T extends Node = Ruleset> extends Node<MixinValue<T>> {
  /**
   * @todo -
   * Return either a ruleset if `this` is the eval context,
   * or return ruleset.obj() if not (for React/Vue)
   *
   * @todo - move to visitors
   */
  // toModule(context: Context, out: OutputCollector) {
  //   const { name, args, value } = this
  //   const nm = name.value
  //   if (context.depth === 0) {
  //     out.add(`export let ${nm}`, this.location)
  //     context.exports.add(nm)
  //   } else {
  //     if (context.depth !== 1) {
  //       out.add('let ')
  //     }
  //     out.add(`${nm} = function(`)
  //     if (args) {
  //       const length = args.value.length - 1
  //       args.value.forEach((node, i) => {
  //         if (node instanceof JsIdent) {
  //           out.add(node.value)
  //         } else {
  //           out.add(node.name.value)
  //           out.add(' = ')
  //           node.value.toModule(context, out)
  //         }
  //         if (i < length) {
  //           out.add(', ')
  //         }
  //       })
  //     }
  //     out.add(') { return ')
  //     value.toModule(context, out)
  //     out.add('}')
  //   }
  // }
}

export const mixinbody = defineType(MixinBody, 'MixinBody')