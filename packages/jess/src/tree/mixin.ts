import { JsNode } from './js-node'
import { JsIdent } from './js-ident'
import { List } from './list'
import type { Ruleset } from './ruleset'
import type { JsKeyValue } from './js-key-value'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { LocationInfo } from './node'

export type MixinValue = {
  name: JsIdent
  args?: List<JsIdent | JsKeyValue>
  value: Ruleset
}

/**
 * @mixin someMixin (arg1, arg2: 10px) {
 *   color: black;
 *   background-color: white;
 *   border-radius: $arg2;
 * }
 */
export class Mixin extends JsNode {
  name: JsIdent
  args: List<JsIdent | JsKeyValue>
  value: Ruleset

  /**
   * @todo -
   * Return either a ruleset if `this` is the eval context,
   * or return ruleset.obj() if not (for React/Vue)
   */
  toModule(context: Context, out: OutputCollector) {
    const { name, args, value } = this
    const nm = name.value
    if (context.depth === 0) {
      out.add(`export let ${nm}`, this.location)
      context.exports.add(nm)
    } else {
      if (context.depth !== 1) {
        out.add(`let `)
      }
      out.add(`${nm} = function(`)
      if (args) {
        const length = args.value.length - 1
        args.value.forEach((node, i) => {
          if (node instanceof JsIdent) {
            out.add(node.value)
          } else {
            out.add(node.name.value)
            out.add(' = ')
            node.value.toModule(context, out)
          }
          if (i < length) {
            out.add(', ')
          }
        })
      }
      out.add(') { return ')
      value.toModule(context, out)
      out.add('}')
    }
  }
}
Mixin.prototype.type = 'Mixin'

export const mixin =
  (value: MixinValue, location?: LocationInfo) =>
    new Mixin(value, location)
