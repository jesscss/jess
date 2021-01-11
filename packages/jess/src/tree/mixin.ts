import { Node, JsNode, List, Anonymous, Declaration } from '.'
import type { ILocationInfo, NodeMap } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

export type MixinValue = NodeMap & {
  name: string
  args: List<Anonymous | Declaration>
  value: (JsNode | Declaration)[]
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
  value: (JsNode | Declaration)[]

  constructor(
    value: MixinValue,
    location?: ILocationInfo
  ) {
    super(value, location)
  }

  toModule(context: Context, out: OutputCollector) {
    const name = this.name
    context.exports.add(name)
    if (context.isRoot) {
      out.add('export ', this.location)
    }
    out.add(`let ${name} = (`)
    const backupName = `__bk_${name}`
    const length = this.args.value.length - 1
    this.args.value.forEach((node, i) => {
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
    out.add(') => ')
    if (context.isRoot) {
      context.indent++
      const pre = context.pre
      
      out.add('{\n')
      out.add(`${pre}const __OUT = {}\n`)

      this.value.forEach((node, i) => { 
        out.add(pre)
        if (node instanceof JsNode) {
          node.toModule(context, out)
          out.add('\n')
        } else {
          out.add(`__OUT.`)
          node.toModule(context, out)
          out.add(`)\n`)
        }
      })

      out.add('}\n')
      context.indent--
    } else {
      out.add(`${backupName}(`)
      this.args.value.forEach((node, i) => {
        if (node instanceof Anonymous) {
          out.add(node.value)
        } else {
          out.add(node.name.toString())
        }
        if (i < length) {
          out.add(', ')
        }
      })
      out.add(`)`)
    }
  }
}

export const mixin =
  (...args: ConstructorParameters<typeof Mixin>) =>
    new Mixin(...args)
