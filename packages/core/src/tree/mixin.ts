import { type Node, defineType } from './node'
import type { Ruleset } from './ruleset'
import type { Condition } from './condition'
import type { List } from './list'
import type { Rest } from './rest'
import { type Name, BaseDeclaration } from './base-declaration'
import { type VarDeclarationOptions, type VarDeclaration } from './var-declaration'

export type MixinValue = {
  name?: Name
  params?: List<Node | VarDeclaration<string> | Rest>
  guard?: Condition
  value: Ruleset
}

export type MixinOptions = {
  /** This is a flag that will set during parsing */
  default?: boolean
}

/**
 * @mixin someMixin (arg1, arg2: 10px) {
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
 * e.g. `@ mixin foo($a, $b) { ... }`
 *   can be called from JS like:
 *     foo(1, 2) or
 *     foo({ a: 1, b: 2 }) or
 *     foo({ b: 2 }, 1)
 */
export class Mixin extends BaseDeclaration<Name, MixinValue, VarDeclarationOptions & MixinOptions> {
  get params(): List<Node | VarDeclaration<string> | Rest> {
    return this.data.get('params')
  }

  set params(v: List<Node | VarDeclaration<string> | Rest>) {
    this.data.set('params', v)
  }

  get guard(): Condition | undefined {
    return this.data.get('guard')
  }

  toTrimmedString(depth: number = 0): string {
    let space = ''.padStart(depth * 2)
    let output = `@mixin ${this.name}`
    if (this.params) {
      output += '('
      output += this.params.toString(depth)
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
Mixin.prototype.allowRuleRoot = false
Mixin.prototype.allowRoot = false

/** Not sure why the Class<Node> assertion was necessary */

type MixinConstructorParams = ConstructorParameters<typeof Mixin>

export const mixin = defineType(Mixin, 'Mixin') as (
  value: MixinValue | MixinConstructorParams[0],
  options?: MixinConstructorParams[1],
  location?: MixinConstructorParams[2],
  treeContext?: MixinConstructorParams[3]
) => Mixin