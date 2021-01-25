import { JsNode, List, JsKeyValue, Ruleset, JsIdent } from '.'
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

  toModule(context: Context, out: OutputCollector) {
    const { name, args, value } = this
    const nm = name.value
    context.exports.add(nm)
    if (context.rootLevel === 0) {
      out.add('export ', this.location)
    }
    out.add(`let ${nm} = (`)
    const backupName = `$BK_${nm}`
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
    out.add(') => ')
    if (context.rootLevel === 0) {
      value.toModule(context, out)
    } else {
      out.add(`${backupName}(`)
      if (args) {
        const length = args.value.length - 1
        args.value.forEach((node, i) => {
          if (node instanceof JsIdent) {
            out.add(node.value)
          } else {
            out.add(node.name.value)
          }
          if (i < length) {
            out.add(', ')
          }
        })
      }
      out.add(`)`)
    }
    if (context.rootLevel === 0) {
      out.add(`\nlet $BK_${nm} = ${nm}`)
    }
  }
}

export const mixin =
  (value: MixinValue, location?: LocationInfo) =>
    new Mixin(value, location)
