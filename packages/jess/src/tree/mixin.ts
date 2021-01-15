import { JsNode, List, Anonymous, Declaration, Ruleset } from '.'
import type { ILocationInfo, NodeMap } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

export type MixinValue = NodeMap & {
  name: string
  args?: List<Anonymous | Declaration>
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
  name: string
  args: List<Anonymous | Declaration>
  value: Ruleset

  constructor(
    value: MixinValue,
    location?: ILocationInfo
  ) {
    const name = value.name
    /** @todo - disallow JS reserved words */
    if (!name) {
      throw { message: 'Identifier required' }
    }
    super(value, location)
  }

  toModule(context: Context, out: OutputCollector) {
    const { name, args, value } = this
    context.exports.add(name)
    if (context.rootLevel === 0) {
      out.add('export ', this.location)
    }
    out.add(`let ${name} = (`)
    const backupName = `$BK_${name}`
    if (args) {
      const length = args.value.length - 1
      args.value.forEach((node, i) => {
        if (node instanceof Anonymous) {
          out.add(node.value)
        } else {
          out.add(node.name.toString())
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
          if (node instanceof Anonymous) {
            out.add(node.value)
          } else {
            out.add(node.name.toString())
          }
          if (i < length) {
            out.add(', ')
          }
        })
      }
      out.add(`)`)
    }
    if (context.rootLevel === 0) {
      out.add(`\nlet $BK_${name} = ${name}`)
    }
  }
}

export const mixin =
  (...args: ConstructorParameters<typeof Mixin>) =>
    new Mixin(...args)
