import { type Context } from '../context'
import { defineType, Node } from './node'

export type ListOptions = {
  slash?: boolean
}

/**
 * A list of expressions
 *
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 * or one / two / three
 */
export class List<T extends Node = Node> extends Node<T[], ListOptions> {
  toArray() {
    return this.value
  }

  toTrimmedString() {
    return this.value.map(v => v.toString()).join(', ')
  }

  /** @todo? Lists should collapse nested lists? */
  async eval(context: Context) {
    return await (super.eval(context) as Promise<List<T>>)
  }

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('', this.location)
  //   const length = this.value.length - 1
  //   const pre = context.pre
  //   const cast = context.cast
  //   this.value.forEach((node, i) => {
  //     const val = cast(node)
  //     val.toCSS(context, out)

  //     if (i < length) {
  //       if (context.inSelector) {
  //         out.add(`,\n${pre}`)
  //       } else {
  //         out.add(', ')
  //       }
  //     }
  //   })
  // }

  /** @todo move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.list([\n', this.location)
  //   context.indent++
  //   let pre = context.pre
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     out.add(pre)
  //     if (node instanceof Node) {
  //       node.toModule(context, out)
  //     } else {
  //       out.add(JSON.stringify(node))
  //     }
  //     if (i < length) {
  //       out.add(',\n')
  //     }
  //   })
  //   context.indent--
  //   pre = context.pre
  //   out.add(`\n${pre}])`)
  //   return out
  // }
}

export const list = defineType(List, 'List')