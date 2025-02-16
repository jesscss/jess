import { Node, defineType } from './node'
import type { Condition } from './condition'
import type { List } from './list'
import type { Rest } from './rest'
import type { Name } from './general'
import { type VarDeclaration } from './var-declaration'
import type { Selector } from './selector'
import type { Nil } from './nil'
import type { Rules } from './rules'

export type MixinValue = {
  selector?: Selector | Nil
  rules: Rules
  /**
   * - A plain node is a kind of value guard.
   * - A name is just a named variable.
   * - A var declaration is a named variable with a default value.
   * - A rest is a rest parameter.
   */
  params?: List<Node | Name | VarDeclaration<string> | Rest>
  guard?: Condition
}

export type MixinOptions = {
  /** This is a flag that will set during parsing */
  hasDefault?: boolean
}

/**
 * @@ someMixin (arg1; arg2: 10px) {
 *   color: black;
 *   background-color: white;
 *   border-radius: $arg2;
 * }
 *
 *
 * Note that mixin calls are called as JavaScript functions,
 * with either only positional arguments, or a plain object
 * as the first argument, representing named arguments,
 * followed by positional arguments.
 *
 * e.g. `@@ foo($a; $b) { ... }`
 *   can be called from JS like:
 *     foo(1, 2) or
 *     foo({ a: 1, b: 2 }) or
 *     foo({ b: 2 }, 1)
 */

export class Mixin extends Node<MixinValue> {
  type = 'Mixin'
  shortType = 'mixin'

  override toTrimmedString(depth: number = 0): string {
    let { selector, rules, params, guard } = this.value
    let space = ''.padStart(depth * 2)
    let output = `@@ ${selector}`
    if (params) {
      output += '('
      output += params.toString(depth)
      output += ')'
    }
    if (guard) {
      output += ` when ${guard}`
    }
    output += ' {\n'
    output += rules.toString(depth + 1) as string
    output += `${space}}`
    return output
  }
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

/** Not sure why the Class<Node> assertion was necessary */

type MixinConstructorParams = ConstructorParameters<typeof Mixin>

export const mixin = defineType(Mixin, 'Mixin') as (
  value: MixinValue | MixinConstructorParams[0],
  options?: MixinConstructorParams[1],
  location?: MixinConstructorParams[2],
  treeContext?: MixinConstructorParams[3]
) => Mixin