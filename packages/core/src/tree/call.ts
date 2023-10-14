import { Node, defineType } from './node'
import { type List } from './list'
import { type Context } from '../context'
import { isNode } from './util'
import { cast } from './util/cast'

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin or variable lookup
   *   e.g. #mixin > .class() is [Call (#mixin ())] -> [Call (class ())]
   */
  name: string | Node
  args?: List
}

/**
 * @note In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export class Call<T extends CallValue = CallValue> extends Node<T> {
  get name() {
    return this.data.get('name')
  }

  set name(v: string | Node) {
    this.data.set('name', v)
  }

  get args() {
    return this.data.get('args')
  }

  set args(v: List | undefined) {
    this.data.set('args', v)
  }

  toTrimmedString() {
    let { name, args } = this
    return `${name}(${args ?? ''})`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let canOperate = context.canOperate
      /** Reset parentheses "state" */
      context.canOperate = false
      let { name, args } = this
      if (name instanceof Node) {
        name = await name.eval(context)
      }

      if (isNode(name, 'FunctionValue')) {
        // try {
        const func = name.value
        let result: any
        if (func.evalArgs !== false) {
          args = await args?.eval(context)
        }
        if (args) {
          result = await name.value.call(context, ...args)
        } else {
          result = await name.value.call(context)
        }
        return cast(result)
        // } catch (e) {
        /** Do something with JS errors */
        // console.log(e)
        // }
      } else {
        args = await args?.eval(context)
      }
      context.canOperate = canOperate
      let node = this.clone()
      node.name = name
      node.args = args
      return node
    })
  }
}

Call.prototype.requiredSemi = true

export const call = defineType<CallValue>(Call, 'Call')