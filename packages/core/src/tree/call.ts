import { Node, defineType } from './node'
import { type List } from './list'
import { type Context } from '../context'
import { isNode } from './util'
import { cast } from './util/cast'

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin lookup
   *   e.g. #mixin > .class() is [Call (#mixin ())] -> [Call (class ())]
   */
  ref: string | Node
  args?: List
}

/**
 * A mixin or function call. In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export class Call extends Node<CallValue> {
  get ref() {
    return this.data.get('ref')
  }

  set ref(v: string | Node) {
    this.data.set('ref', v)
  }

  get args() {
    return this.data.get('args')
  }

  set args(v: List | undefined) {
    this.data.set('args', v)
  }

  toTrimmedString() {
    let { ref, args } = this
    return `${ref}(${args ?? ''})`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let canOperate = context.canOperate
      /** Reset parentheses "state" */
      context.canOperate = false
      let { ref, args } = this
      if (ref instanceof Node) {
        ref = await ref.eval(context)
      }

      if (isNode(ref, 'FunctionValue')) {
        // try {
        const func = ref.value
        let result: any
        if (func.evalArgs !== false) {
          args = await args?.eval(context)
        }
        if (args) {
          result = await ref.value.call(context, ...args)
        } else {
          result = await ref.value.call(context)
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
      node.ref = ref
      node.args = args
      return node
    })
  }
}

export const call = defineType<CallValue>(Call, 'Call')