import { type Context } from '../context'
import { defineType, Node } from './node'
import { compareNodeArray } from './util/compare'
import { type Operator } from './util/calculate'

export type ListOptions = {
  /**
   * Lists can be separated by comma, semi-colon,
   * or slash, depending on the type of list.
   *
   * @todo - Is there a more CSS-y way to define this?
   */
  sep?: ',' | ';' | '/'
}

export interface List<T extends Node = Node> extends Node<T[], ListOptions> {
  value: T[]
}
/**
 * A list of expressions
 *
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 * or one / two / three
 */
export class List<T extends Node = Node> extends Node<T[], ListOptions> {
  type = 'List'
  shortType = 'list'

  override toTrimmedString() {
    let { sep = ',' } = this.options ?? {}
    return this.value.map(v => v.toString()).join(`${sep}`)
  }

  override compare(other: Node) {
    if (other instanceof List) {
      return compareNodeArray(this.value, other.value)
    }
    return super.compare(other)
  }

  override operate(b: Node, op: Operator, context: Context): List<T> {
    if (op !== '+') {
      throw new Error(`List operation "${op}" not supported`)
    }
    let newList = this.maybeClone(context)
    if (b instanceof List) {
      newList.value.push(...b.value)
    } else {
      /** @todo - do we need to verify the list type? */
      newList.value.push(b as T)
    }
    return newList
  }

  /** @todo? Lists should collapse nested lists? */
  // override async evalNode(context: Context): Promise<List<T>>

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

type Params = ConstructorParameters<typeof List>

export const list = defineType(List, 'List') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => List