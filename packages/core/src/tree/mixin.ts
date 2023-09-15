import { defineType } from './node'
import { VariableDeclaration } from './variable-declaration'
import { type MixinBody } from './mixin-body'
import { type Ruleset } from './ruleset'
import { type Interpolated } from './interpolated'

/**
 * @mixin someMixin (arg1, arg2: 10px) {
 *   color: black;
 *   background-color: white;
 *   border-radius: $arg2;
 * }
 *
 * This extends Variable because name resolving is the same,
 * and it has similar options as variables, such as being
 * able to define a mixin if it exists.
 */
export class Mixin<T = Ruleset> extends VariableDeclaration<string | Interpolated, MixinBody<T>> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node)
  // }
  /**
   * @todo -
   * Return either a ruleset if `this` is the eval context,
   * or return ruleset.obj() if not (for React/Vue)
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

export const mixin = defineType(Mixin, 'Mixin')