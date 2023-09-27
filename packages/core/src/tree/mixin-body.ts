import { Node, defineType } from './node'
import type { Ruleset } from './ruleset'
import type { Condition } from './condition'
import type { List } from './list'
import type { Declaration } from './declaration'
import type { Rest } from './rest'

export type MixinValueType = Ruleset | ((...args: any[]) => any)
export type MixinValue<T extends MixinValueType = Ruleset> = {
  params?: List<Node | Declaration | Rest>
  guard?: Condition
  value: T
}

/**
 * This is just the body of a mixin
 * (an anonymous mixin).
 *
 * Note that mixin calls are called as JavaScript functions,
 * with either only positional arguments, or a plain object
 * as the first argument, representing named arguments,
 * followed by positional arguments.
 *
 * e.g. `@ mixin foo($a, $b) { ... }`
 *   can be called from JS like:
 *     foo(1, 2) or
 *     foo({ a: 1, b: 2 }) or
 *     foo({ b: 2 }, 1)
 */
export class MixinBody<T extends MixinValueType = Ruleset> extends Node<MixinValue<T>> {
  get params(): Map<string | Node, Node | undefined> | undefined {
    return this.data.get('params')
  }

  get guard(): Condition | undefined {
    return this.data.get('guard')
  }

  toTrimmedString(depth: number = 0): string {
    let space = ''.padStart(depth * 2)
    let output = ''
    if (this.params) {
      output += '('
      let length = this.params.size - 1
      let i = 0
      this.params.forEach((value, key) => {
        output += `${key instanceof Node ? key : `$${key}`}${value ? `: ${value}` : ''}`
        if (i < length) {
          output += ', '
        }
        i++
      })
      output += ')'
    }
    if (this.guard) {
      output += ` when ${this.guard}`
    }
    output += ' {\n'
    output += this.value.toString(depth + 1)
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

type MixinConstructorParams = ConstructorParameters<typeof MixinBody>

export const mixinbody = defineType(MixinBody, 'MixinBody') as (
  value: MixinValue | MixinConstructorParams[0],
  options?: MixinConstructorParams[1],
  location?: MixinConstructorParams[2],
  fileInfo?: MixinConstructorParams[3]
) => MixinBody