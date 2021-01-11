import { Node, Collection, Js, List, Anonymous, Declaration } from '.'
import type { ILocationInfo, NodeMap } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

export type MixinValue = NodeMap & {
  name: string
  args: List<Anonymous | Declaration>
  value: Node[]
}

/**
 * @let
 * 
 * @note
 * The lower-case API variant for this is `set()`,
 * see the note below.
 */
export class Mixin extends Js {
  name: string
  args: List<Anonymous | Declaration>
  value: Node[]

  constructor(
    value: MixinValue,
    location?: ILocationInfo
  ) {
    super(value, location)
  }

  toString() {
    const { name, value } = this
    if (value instanceof Collection) {
      return `@let ${name} ${value}`
    }
    return `@let ${name}: ${value};`
  }

  toModule(context: Context, out: OutputCollector) {
    const name = this.name
    context.exports.add(name)
    if (context.isRoot) {
      out.add('export ', this.location)
    }
    out.add(`let ${name} = (`)
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
    // this.value.toModule(context, out)
  }
}

export const mixin =
  (...args: ConstructorParameters<typeof Mixin>) =>
    new Mixin(...args)
